/**
 * Pure decisions for moving the caret between nodes with Up/Down while editing,
 * matching workflowy.com: Up on a node's first line edits the previous visible
 * node, Down on its last line edits the next one; other lines move in-text.
 */

export type VerticalDirection = "up" | "down";

interface VerticalSpan {
	top: number;
	bottom: number;
}

/**
 * Whether the caret sits on the edge line the arrow key would leave from.
 * `caret` is the collapsed caret's client rect (null when it cannot be measured,
 * e.g. in an empty node); `content` spans the edited text from first to last line.
 * A caret within half a line of the content edge is on that edge line.
 */
export function isCaretOnBoundaryLine(
	direction: VerticalDirection,
	caret: VerticalSpan | null,
	content: VerticalSpan,
): boolean {
	if (caret === null) {
		return true;
	}
	const halfLine = (caret.bottom - caret.top) / 2;
	return direction === "up" ? caret.top - content.top < halfLine : content.bottom - caret.bottom < halfLine;
}

/**
 * The nodes the caret can visit in display order: the zoom root's editable title
 * (when zoomed) followed by the visible rows.
 */
export function navigableIds(zoomedNodeId: string | null, visibleIds: readonly string[]): string[] {
	return zoomedNodeId === null ? [...visibleIds] : [zoomedNodeId, ...visibleIds];
}

/**
 * The node to edit after leaving `currentId` in `direction`, or null at the
 * first/last visible node (no wrapping) or when `currentId` is not visible.
 */
export function adjacentVisibleNode(
	visibleIds: readonly string[],
	currentId: string,
	direction: VerticalDirection,
): string | null {
	const index = visibleIds.indexOf(currentId);
	if (index === -1) {
		return null;
	}
	return visibleIds[direction === "up" ? index - 1 : index + 1] ?? null;
}

export type HorizontalDirection = "left" | "right";

/**
 * Where Left at a row's text start or Right at its text end continues editing,
 * matching workflowy.com: the end of the previous visible row, or the start of the
 * next one. Null at the first/last row (the key then stays native) or when
 * `currentId` is not visible.
 */
export function horizontalTarget(
	visibleIds: readonly string[],
	currentId: string,
	direction: HorizontalDirection,
): {nodeId: string; caretOffset: number} | null {
	const left = direction === "left";
	const nodeId = adjacentVisibleNode(visibleIds, currentId, left ? "up" : "down");
	return nodeId === null ? null : {nodeId, caretOffset: left ? Number.MAX_SAFE_INTEGER : 0};
}

/**
 * The node to edit after Backspace deletes `nodeId`, or null when Backspace should
 * not delete it: the node still has text, a note, or children, or it is the first visible
 * node and the caret would have nowhere to go.
 */
export function backspaceDeleteTarget(
	visibleIds: readonly string[],
	nodeId: string,
	node: {text: string; note: string; hasChildren: boolean},
): string | null {
	if (node.text !== "" || node.note !== "" || node.hasChildren) {
		return null;
	}
	return adjacentVisibleNode(visibleIds, nodeId, "up");
}

/**
 * Where editing continues when the edited node leaves the view (deleted, or
 * completed while completed nodes are hidden): the end of the previous visible
 * node, else the start of the next one, else nowhere (null).
 */
export function editingAfterRemoval(
	visibleIds: readonly string[],
	nodeId: string,
): {nodeId: string; caretOffset: number} | null {
	const previous = adjacentVisibleNode(visibleIds, nodeId, "up");
	if (previous !== null) {
		return {nodeId: previous, caretOffset: Number.MAX_SAFE_INTEGER};
	}
	const next = adjacentVisibleNode(visibleIds, nodeId, "down");
	return next === null ? null : {nodeId: next, caretOffset: 0};
}

export type CompleteFocus =
	| {kind: "row"; id: string; offset: 0}
	| {kind: "zoomTitle"}
	| {kind: "stay"}
	| {kind: "zoomOut"; delayMs: 500};

/**
 * Where the caret goes after Cmd+Enter toggles completion on `ids`, matching
 * workflowy.com: uncompleting leaves it in place; completing the zoom root zooms
 * out after the re-render; otherwise it moves to the start of the last item's next
 * sibling, else to the row before the first item (the zoom title when that is the
 * zoom root). With completed rows hidden both lookups skip completed rows; with
 * them shown and no next sibling, the caret stays in the first item at offset 0.
 * `visibleRows` is the navigable order before the change.
 */
export function planCompleteFocus(input: {
	ids: readonly string[];
	completing: boolean;
	showCompleted: boolean;
	zoomRootId: string | null;
	siblingsOf: (id: string) => readonly string[];
	visibleRows: readonly string[];
	completedIds: ReadonlySet<string>;
}): CompleteFocus {
	const {ids, completing, showCompleted, zoomRootId, siblingsOf, visibleRows, completedIds} = input;
	const first = ids[0];
	const last = ids.at(-1);
	if (!completing || first === undefined || last === undefined) {
		return {kind: "stay"};
	}
	if (zoomRootId !== null && ids.includes(zoomRootId)) {
		return {kind: "zoomOut", delayMs: 500};
	}
	const isCandidate = (id: string): boolean => !ids.includes(id) && (showCompleted || !completedIds.has(id));

	const siblings = siblingsOf(last);
	const nextSibling = siblings.slice(siblings.indexOf(last) + 1).find(isCandidate);
	if (nextSibling !== undefined) {
		return {kind: "row", id: nextSibling, offset: 0};
	}
	if (showCompleted) {
		return {kind: "row", id: first, offset: 0};
	}

	const firstIndex = visibleRows.indexOf(first);
	const previous = visibleRows.slice(0, Math.max(firstIndex, 0)).findLast(isCandidate);
	if (previous === undefined) {
		return {kind: "stay"};
	}
	return previous === zoomRootId ? {kind: "zoomTitle"} : {kind: "row", id: previous, offset: 0};
}

export type NoteBoundaryInput =
	| {from: "rootTitleEnd"; key: "Up" | "Down" | "Left" | "Right"; rootNoted: boolean}
	| {from: "firstChildName"; key: "Up" | "Down" | "Left" | "Right"; caret: number; rootNoted: boolean};

/**
 * Caret moves into the zoom root's note (`notes--main`), matching workflowy.com:
 * Down/Right at the end of the noted root title enter the note at its start; Up/Left
 * at the start of the first child's name enter it at its end. Null when the root has
 * no note or the key moves elsewhere.
 */
export function planNoteBoundary(input: NoteBoundaryInput): {focus: "rootNote"; caret: 0 | "end"} | null {
	if (!input.rootNoted) {
		return null;
	}
	if (input.from === "rootTitleEnd") {
		return input.key === "Down" || input.key === "Right" ? {focus: "rootNote", caret: 0} : null;
	}
	return input.caret === 0 && (input.key === "Up" || input.key === "Left") ? {focus: "rootNote", caret: "end"} : null;
}
