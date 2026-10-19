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
