/** Where a pane's caret sat: upstream's per-pane `viewState.focusedEditor` (item, name or note, offset). */
export interface PaneCaretPosition {
	nodeId: string;
	field: "name" | "note";
	offset: number;
}

/** A saved pane caret and the zoom it was taken in; upstream clears a pane's view state when the pane navigates. */
export interface PaneCaret extends PaneCaretPosition {
	zoomedId: string | null;
}

/**
 * The saved caret to restore when the pane is focused, or null to fall back to the first row (upstream's `Pu1`): the
 * pane has not zoomed elsewhere since, and the row is still shown there (the zoomed title counts).
 */
export function restorableCaret(
	saved: PaneCaret | undefined,
	view: {zoomedId: string | null; visibleIds: readonly string[]},
): PaneCaret | null {
	if (saved === undefined || saved.zoomedId !== view.zoomedId) {
		return null;
	}
	return saved.nodeId === view.zoomedId || view.visibleIds.includes(saved.nodeId) ? saved : null;
}
