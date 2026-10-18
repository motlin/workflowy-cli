import type {QueryClient} from "@tanstack/react-query";
import type {NodeResponse} from "../node-types.js";
import {readChildren, readNode} from "./node-cache.js";
import {concatHtml, plainLength, splitHtml, trimmedPlainLength} from "./rich-text.js";
import {sortByPriority} from "./tree-position.js";

/**
 * Tree-mutation planning: given the React Query cache and a node, compute the
 * payload for the corresponding create/move mutation (or null when the mutation
 * is a no-op). Each function hides the sibling-cache read and the index arithmetic
 * that the keyboard handlers and the editor would otherwise inline.
 *
 * An `index` is a slot among ALL of the target parent's children sorted by priority,
 * completed rows included (hiding them is render-time only); omitted means bottom.
 * For a move it is counted BEFORE the moved node is removed (the node lands right
 * before the row now at `index`), matching the move endpoint and `MoveToInput`.
 *
 * These are pure over `(queryClient, node)`, so they unit-test by seeding a
 * QueryClient and asserting the emitted payload — no DOM, no key events.
 */

/** Payload accepted by the create-node mutation. */
export interface CreateNodePayload {
	parent_id?: string;
	name: string;
	note?: string;
	index?: number;
}

/** Payload accepted by the move-node mutation. */
export interface MoveNodePayload {
	nodeId: string;
	parent_id: string | null;
	index?: number;
}

/** The minimal node fields the planners read. */
type PlanNode = Pick<NodeResponse, "id" | "parent_id" | "priority">;

/** `{index}` for the slot right after `id` among `parentId`'s cached children, or `{}` (bottom) when uncached. */
function indexAfter(queryClient: QueryClient, parentId: string | null, id: string): {index?: number} {
	const siblings = readChildren(queryClient, parentId);
	const index = siblings ? sortByPriority(siblings).findIndex((sibling) => sibling.id === id) : -1;
	return index === -1 ? {} : {index: index + 1};
}

/**
 * Upstream `WF.Priority.defaultIn`: where a node dropped or moved "into" `target`
 * lands — the bottom when its metadata says `defaultToBottom`, else the top.
 */
export function defaultIndexIn(target: Pick<NodeResponse, "defaultToBottom">, childCount: number): number {
	return target.defaultToBottom === true ? childCount : 0;
}

/**
 * The move index for dropping a row above or below `targetId`: the target's
 * slot among all `children` (priority order, the dragged row included), +1 for below.
 */
export function dropIndex(
	children: Pick<NodeResponse, "id" | "priority">[],
	targetId: string,
	position: "above" | "below",
): number {
	const target = sortByPriority(children).findIndex((child) => child.id === targetId);
	return target + (position === "below" ? 1 : 0);
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

/** One step of carrying out a split plan, in order. */
export type SplitMutation =
	| {type: "update"; nodeId: string; name: string}
	| {type: "create"; parent_id: string | null; index: number; name: string; layoutMode: "todo" | null}
	| {type: "edit"; target: "new" | "current"; caret: 0};

/**
 * The ordered mutations for a `create` split plan on `nodeId`: rename the current row
 * when its name differs from `savedName`, create the new row at the planner's exact
 * `index` (one create, no sibling rotation), then edit the focused row at its start.
 */
export function applySplitPlan(
	plan: Extract<SplitPlan, {kind: "create"}>,
	nodeId: string,
	savedName: string,
): SplitMutation[] {
	const rename: SplitMutation[] =
		plan.currentName === savedName ? [] : [{type: "update", nodeId, name: plan.currentName}];
	return [
		...rename,
		{type: "create", parent_id: plan.parentId, index: plan.index, name: plan.newName, layoutMode: plan.layoutMode},
		{type: "edit", target: plan.focus, caret: 0},
	];
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

/** Duplicate `node`'s name/note as a sibling immediately after it. */
export function planDuplicate(
	queryClient: QueryClient,
	node: PlanNode & Pick<NodeResponse, "name" | "note">,
): CreateNodePayload {
	return {
		parent_id: node.parent_id ?? undefined,
		name: node.name ?? "",
		note: node.note ?? undefined,
		...indexAfter(queryClient, node.parent_id, node.id),
	};
}

/** Tab plan: the move payload, plus the new parent to expand when it is collapsed (or null). */
export type IndentPlan = MoveNodePayload & {expandParentId: string | null};

/**
 * Indent `node` as the LAST child of its previous sibling (upstream `Gs1`), expanding
 * that sibling when it is not in `expandedIds`, or null if it has no previous sibling.
 * Without the sibling's children cached the index is omitted, since the server's
 * bottom is the same slot.
 */
export function planIndent(
	queryClient: QueryClient,
	node: PlanNode,
	expandedIds: ReadonlySet<string>,
): IndentPlan | null {
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
	const expandParentId = expandedIds.has(previous.id) ? null : previous.id;
	const previousChildren = readChildren(queryClient, previous.id);
	if (previousChildren !== undefined) {
		return {nodeId: node.id, parent_id: previous.id, index: previousChildren.length, expandParentId};
	}
	return previous.hasChildren === false
		? {nodeId: node.id, parent_id: previous.id, index: 0, expandParentId}
		: {nodeId: node.id, parent_id: previous.id, expandParentId};
}

/**
 * Outdent `node` to sit right after its parent among the grandparent's children.
 * Null at root, or when the parent is the zoom root (the node would leave the page).
 */
export function planOutdent(
	queryClient: QueryClient,
	node: PlanNode,
	zoomedNodeId: string | null,
): MoveNodePayload | null {
	if (node.parent_id === null || node.parent_id === zoomedNodeId) {
		return null;
	}
	const parent = readNode(queryClient, node.parent_id);
	if (parent === undefined) {
		return null;
	}
	const grandparentId = parent.parent_id;
	return {nodeId: node.id, parent_id: grandparentId, ...indexAfter(queryClient, grandparentId, node.parent_id)};
}

/** The outline as `planVerticalMove` sees it. `childrenOf` lists ALL children in priority order. */
export interface VerticalMoveTree {
	parentOf(id: string): string | null;
	childrenOf(id: string | null): string[];
	isExpanded(id: string): boolean;
	/** False for a completed row hidden while completed rows are hidden. */
	isVisible(id: string): boolean;
}

/** Move up/down plan: an exact move-endpoint `index`, plus the new parent to expand (or null). */
export interface VerticalMovePlan {
	nodeId: string;
	parentId: string | null;
	index: number;
	expandParentId: string | null;
}

/** The nearest visible sibling of `id` in `direction`, or undefined. */
function visibleSibling(tree: VerticalMoveTree, id: string, direction: "up" | "down"): string | undefined {
	const siblings = tree.childrenOf(tree.parentOf(id));
	const at = siblings.indexOf(id);
	const candidates = direction === "up" ? siblings.slice(0, at).toReversed() : siblings.slice(at + 1);
	return candidates.find((sibling) => tree.isVisible(sibling));
}

/**
 * Upstream Shift+Cmd+Up/Down. Swap with the nearest visible sibling; at the edge, leave the
 * parent for the parent's visible sibling in that direction (the "uncle"): moving up lands
 * after the uncle's last rendered child when it is open, else at its top; moving down lands
 * at its top. The uncle is expanded when it is not already. Null when there is nowhere to go,
 * and the move never leaves the zoomed page. `index` follows the move endpoint: a slot among
 * ALL of the target's children (hidden completed ones included), counted before removal.
 */
export function planVerticalMove({
	nodeId,
	direction,
	zoomRootId,
	tree,
}: {
	nodeId: string;
	direction: "up" | "down";
	zoomRootId: string | null;
	tree: VerticalMoveTree;
}): VerticalMovePlan | null {
	if (nodeId === zoomRootId) {
		return null;
	}
	const parentId = tree.parentOf(nodeId);
	const sibling = visibleSibling(tree, nodeId, direction);
	if (sibling !== undefined) {
		const siblingIndex = tree.childrenOf(parentId).indexOf(sibling);
		const index = direction === "up" ? siblingIndex : siblingIndex + 1;
		return {nodeId, parentId, index, expandParentId: null};
	}
	if (parentId === null || parentId === zoomRootId) {
		return null;
	}
	const uncle = visibleSibling(tree, parentId, direction);
	if (uncle === undefined) {
		return null;
	}
	const cousins = tree.childrenOf(uncle);
	const open = tree.isExpanded(uncle) && cousins.length > 0;
	const lastRendered = cousins.findLastIndex((cousin) => tree.isVisible(cousin));
	const index = direction === "up" && open ? lastRendered + 1 : 0;
	return {nodeId, parentId: uncle, index, expandParentId: open ? null : uncle};
}

/** A `VerticalMoveTree` over the React Query cache and the outline's expansion/visibility state. */
export function cacheMoveTree(
	queryClient: QueryClient,
	{
		expandedIds,
		showCompleted,
		animatingCompletionIds,
	}: {expandedIds: ReadonlySet<string>; showCompleted: boolean; animatingCompletionIds: ReadonlySet<string>},
): VerticalMoveTree {
	return {
		parentOf: (id) => readNode(queryClient, id)?.parent_id ?? null,
		childrenOf: (id) => sortByPriority(readChildren(queryClient, id) ?? []).map((child) => child.id),
		isExpanded: (id) => expandedIds.has(id),
		isVisible: (id) => {
			const found = readNode(queryClient, id);
			return found === undefined || isPotentiallyVisible(found, showCompleted, animatingCompletionIds);
		},
	};
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
