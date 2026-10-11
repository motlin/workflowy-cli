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

/**
 * The node to edit after Backspace deletes `nodeId`, or null when Backspace should
 * not delete it: the node still has text or children, or it is the first visible
 * node and the caret would have nowhere to go.
 */
export function backspaceDeleteTarget(
	visibleIds: readonly string[],
	nodeId: string,
	node: {text: string; hasChildren: boolean},
): string | null {
	if (node.text !== "" || node.hasChildren) {
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
