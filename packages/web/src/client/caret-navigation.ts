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
