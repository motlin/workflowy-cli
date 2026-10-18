import type {QueryClient} from "@tanstack/react-query";
import type {NodeResponse} from "../node-types.js";
import {readChildren, readDetail} from "./node-cache.js";
import {concatHtml, plainLength, splitHtml, trimmedPlainLength} from "./rich-text.js";
import {insertAfterPriority, insertBeforePriority, sortByPriority} from "./tree-position.js";

/**
 * Tree-mutation planning: given the React Query cache and a node, compute the
 * payload for the corresponding create/move mutation (or null when the mutation
 * is a no-op). Each function hides the sibling-cache read + fractional-priority
 * arithmetic that the keyboard handlers and the editor would otherwise inline.
 *
 * These are pure over `(queryClient, node)`, so they unit-test by seeding a
 * QueryClient and asserting the emitted payload — no DOM, no key events.
 */

/** Payload accepted by the create-node mutation. */
export interface CreateNodePayload {
	parent_id?: string;
	name: string;
	note?: string;
	position?: number;
}

/** Payload accepted by the move-node mutation. */
export interface MoveNodePayload {
	nodeId: string;
	parent_id: string | null;
	position?: number;
}

/** The minimal node fields the planners read. */
type PlanNode = Pick<NodeResponse, "id" | "parent_id" | "priority">;

/** Create an empty sibling positioned immediately after `node` (Enter / new-sibling). */
export function planInsertSiblingAfter(queryClient: QueryClient, node: PlanNode): CreateNodePayload {
	const siblings = readChildren(queryClient, node.parent_id);
	const position = insertAfterPriority(siblings ? sortByPriority(siblings) : [], node.id, node.priority);
	return {parent_id: node.parent_id ?? undefined, name: "", position};
}

/**
 * Create an empty first child of `parentId` (Enter in the zoom title). The position
 * stays negative so the server prepends it, and below the current first child.
 */
export function planInsertFirstChild(queryClient: QueryClient, parentId: string): CreateNodePayload {
	const first = sortByPriority(readChildren(queryClient, parentId) ?? [])[0];
	return {parent_id: parentId, name: "", position: Math.min(first?.priority ?? 0, 0) - 100};
}

/** Payload for the add-child button: an empty last child of the zoomed item. */
export interface AddChildPlan {
	parent_id: string | undefined;
	index: number;
	name: string;
	layoutMode: "todo" | null;
}

/**
 * Plan the "+" add-child button: the new node goes in the bottom slot (`index` =
 * child count) and is shaped like the previous visible row, inheriting `todo`.
 */
export function planAddChild({
	childCount,
	zoomedId,
	prevVisibleLayout,
}: {
	childCount: number;
	zoomedId: string | null;
	prevVisibleLayout: string | null | undefined;
}): AddChildPlan {
	return {
		parent_id: zoomedId ?? undefined,
		index: childCount,
		name: "",
		layoutMode: prevVisibleLayout === "todo" ? "todo" : null,
	};
}

/** The row state `planSplit` reads. `isEmpty` = empty name AND no note AND no children. */
export interface SplitNode {
	id: string;
	parent_id: string | null;
	index: number;
	layoutMode: string | null | undefined;
	hasVisibleChildren: boolean;
	isExpanded: boolean;
	isZoomRoot: boolean;
	isEmpty: boolean;
	hasNextSibling: boolean;
	/** False when the parent is the zoom root (or the tree root). */
	canOutdent: boolean;
}

/** What Enter does: outdent the empty row, or create a row and rename the current one. */
export type SplitPlan =
	| {kind: "outdent"}
	| {
			kind: "create";
			parentId: string | null;
			index: number;
			newName: string;
			currentName: string;
			focus: "new" | "current";
			layoutMode: "todo" | null;
	  };

/**
 * Plan Enter in the editor (upstream `hK`). A caret at the trimmed end creates a row
 * after (or the first child of an expanded parent / the zoom root); a caret at the start
 * creates an empty row above; anything else moves the text before the selection into a
 * new row above, so the current row keeps its id, children, and note.
 */
export function planSplit({
	node,
	html,
	selection,
}: {
	node: SplitNode;
	html: string;
	selection: {start: number; end: number};
}): SplitPlan {
	if (node.isEmpty && !node.hasNextSibling && node.canOutdent && !node.isZoomRoot) {
		return {kind: "outdent"};
	}
	const layoutMode = node.layoutMode === "todo" ? "todo" : null;
	const create = (
		parentId: string | null,
		index: number,
		newName: string,
		currentName: string,
		focus: "new" | "current",
	): SplitPlan => ({kind: "create", parentId, index, newName, currentName, focus, layoutMode});

	if (node.isZoomRoot) {
		return create(node.id, 0, "", html, "new");
	}
	const {start, end} = selection;
	if (start === end && start >= trimmedPlainLength(html)) {
		const {before, after} = splitHtml(html, start, end);
		if (node.hasVisibleChildren && node.isExpanded) {
			return create(node.id, 0, after, before, "new");
		}
		return create(node.parent_id, node.index + 1, after, before, "new");
	}
	if (start === end && start === 0) {
		return create(node.parent_id, node.index, "", html, "new");
	}
	const {before, after} = splitHtml(html, start, end);
	return create(node.parent_id, node.index, before, after, "current");
}

/** The row state the merge planners read. */
export interface MergeRow {
	id: string;
	html: string;
	hasChildren: boolean;
	hasNote: boolean;
	completed: boolean;
	isMirror: boolean;
	layoutMode: string | null | undefined;
}

/** What Backspace at the start / Delete at the end does: merge two sibling rows, or nothing. */
export type MergePlan = {kind: "none"} | {kind: "merge"; keepId: string; deleteId: string; name: string; caret: number};

/**
 * Merge `absorbed` (deleted) into `kept`, which keeps its id, children, and note. Refused
 * unless `absorbed` is a plain leaf (no children, note, completion, mirror, or board) with
 * the same layout as `kept`.
 */
function planMerge(first: MergeRow, second: MergeRow, absorbed: MergeRow, kept: MergeRow): MergePlan {
	const refused =
		absorbed.hasChildren ||
		absorbed.hasNote ||
		absorbed.completed ||
		absorbed.isMirror ||
		absorbed.layoutMode === "board" ||
		(absorbed.layoutMode ?? null) !== (kept.layoutMode ?? null);
	if (refused) {
		return {kind: "none"};
	}
	return {
		kind: "merge",
		keepId: kept.id,
		deleteId: absorbed.id,
		name: concatHtml(first.html, second.html),
		caret: plainLength(first.html),
	};
}

/**
 * Backspace with a collapsed caret at offset 0 (upstream): the previous sibling's text
 * moves to the start of the current row, which keeps its id; the sibling is deleted.
 */
export function planBackspaceAtStart({
	current,
	previousSibling,
}: {
	current: MergeRow;
	previousSibling: MergeRow | null;
}): MergePlan {
	return previousSibling === null ? {kind: "none"} : planMerge(previousSibling, current, previousSibling, current);
}

/**
 * Delete with a collapsed caret at the text end (upstream): the mirror image of
 * Backspace — the current row's text moves to the start of the next sibling, which
 * keeps its id; the current row is deleted.
 */
export function planDeleteAtEnd({current, nextSibling}: {current: MergeRow; nextSibling: MergeRow | null}): MergePlan {
	return nextSibling === null ? {kind: "none"} : planMerge(current, nextSibling, current, nextSibling);
}

/** Duplicate `node`'s name/note as a sibling positioned immediately after it. */
export function planDuplicate(
	queryClient: QueryClient,
	node: PlanNode & Pick<NodeResponse, "name" | "note">,
): CreateNodePayload {
	const siblings = readChildren(queryClient, node.parent_id);
	const position = insertAfterPriority(siblings ? sortByPriority(siblings) : [], node.id, node.priority);
	return {parent_id: node.parent_id ?? undefined, name: node.name ?? "", note: node.note ?? undefined, position};
}

/** Indent `node` under its previous sibling, or null if it has no previous sibling. */
export function planIndent(queryClient: QueryClient, node: PlanNode): MoveNodePayload | null {
	const siblings = readChildren(queryClient, node.parent_id);
	if (!siblings) {
		return null;
	}
	const sorted = sortByPriority(siblings);
	const index = sorted.findIndex((sibling) => sibling.id === node.id);
	const previous = sorted[index - 1];
	if (index <= 0 || previous === undefined) {
		return null;
	}
	return {nodeId: node.id, parent_id: previous.id};
}

/** Outdent `node` to sit after its parent among the grandparent's children, or null if at root. */
export function planOutdent(queryClient: QueryClient, node: PlanNode): MoveNodePayload | null {
	if (node.parent_id === null) {
		return null;
	}
	const parent = readDetail(queryClient, node.parent_id);
	if (parent === undefined) {
		return null;
	}
	const grandparentId = parent.parent_id;
	const parentSiblings = readChildren(queryClient, grandparentId);
	const position = insertAfterPriority(
		parentSiblings ? sortByPriority(parentSiblings) : [],
		node.parent_id,
		parent.priority,
	);
	return {nodeId: node.id, parent_id: grandparentId, position};
}

/** Move `node` up among its siblings (before the previous one), or null if already first. */
export function planMoveUp(queryClient: QueryClient, node: PlanNode): MoveNodePayload | null {
	const siblings = readChildren(queryClient, node.parent_id);
	if (!siblings || siblings.length < 2) {
		return null;
	}
	const sorted = sortByPriority(siblings);
	const index = sorted.findIndex((sibling) => sibling.id === node.id);
	const previous = sorted[index - 1];
	if (index <= 0 || previous === undefined) {
		return null;
	}
	return {
		nodeId: node.id,
		parent_id: node.parent_id,
		position: insertBeforePriority(sorted, previous.id, previous.priority),
	};
}

/** Move `node` down among its siblings (after the next one), or null if already last. */
export function planMoveDown(queryClient: QueryClient, node: PlanNode): MoveNodePayload | null {
	const siblings = readChildren(queryClient, node.parent_id);
	if (!siblings || siblings.length < 2) {
		return null;
	}
	const sorted = sortByPriority(siblings);
	const index = sorted.findIndex((sibling) => sibling.id === node.id);
	const next = sorted[index + 1];
	if (index === -1 || next === undefined) {
		return null;
	}
	return {nodeId: node.id, parent_id: node.parent_id, position: insertAfterPriority(sorted, next.id, next.priority)};
}

export interface ToggleCompletePlan {
	action: "complete" | "uncomplete" | "none";
	ids: string[];
}

/**
 * Upstream multi-item toggle: if any item is not completed, complete them all;
 * otherwise uncomplete them all. An empty list does nothing.
 */
export function planToggleComplete(nodes: Pick<NodeResponse, "id" | "completedAt">[]): ToggleCompletePlan {
	const ids = nodes.map((node) => node.id);
	if (ids.length === 0) {
		return {action: "none", ids};
	}
	const allCompleted = nodes.every((node) => node.completedAt !== null);
	return {action: allCompleted ? "uncomplete" : "complete", ids};
}

/**
 * Upstream's hidden test inverted: a row hides only when it is completed, completed
 * rows are hidden, and its completion is not still animating. Descendants of a hidden
 * row hide with it because callers stop recursing there.
 */
export function isPotentiallyVisible(
	node: Pick<NodeResponse, "id" | "completedAt">,
	showCompleted: boolean,
	animatingCompletionIds: ReadonlySet<string>,
): boolean {
	return node.completedAt === null || showCompleted || animatingCompletionIds.has(node.id);
}
