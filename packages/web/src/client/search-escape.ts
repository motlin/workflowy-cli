export interface SearchEscapeState {
	/** The committed search ("" when none). */
	searchQuery: string;
	/** The header search box's live text. */
	searchInput: string;
	/** Whether the header search box has focus. */
	inputFocused: boolean;
}

export type SearchEscapeAction = "cancel" | "blur" | "focus";

/**
 * Upstream's `focus_or_unfocus_search` (Escape): cancel a committed or typed search, else leave a focused empty
 * search box, else focus it.
 */
export function escapeAction({searchQuery, searchInput, inputFocused}: SearchEscapeState): SearchEscapeAction {
	if (searchQuery !== "" || searchInput !== "") {
		return "cancel";
	}
	return inputFocused ? "blur" : "focus";
}

/**
 * Where Escape returns the caret from the search box with nothing remembered: the zoom-root title when zoomed
 * (upstream `WF.Focus.firstProject()`), else the first visible row, both at offset 0.
 */
export function escapeReturnTarget({
	zoomedNodeId,
	firstVisibleId,
}: {
	zoomedNodeId: string | null;
	firstVisibleId: string | undefined;
}): {id: string; offset: number} | null {
	const id = zoomedNodeId ?? firstVisibleId;
	return id === undefined ? null : {id, offset: 0};
}
