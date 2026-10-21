import {useEffect} from "react";
import {useQueryClient} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import {useNavigate} from "react-router-dom";
import {caretTextOffset, editorElement} from "../caret-dom.js";
import {escapeAction} from "../search-escape.js";
import {isModalOpen, useOutlineStore} from "../stores/outline.js";
import type {SearchReturn} from "../stores/outline.js";
import {collectVisibleNodeIds} from "./use-visible-nodes.js";

const SEARCH_INPUT_ID = "srch-input";

/** The window's scroll position when Escape focused search, restored when focus returns. */
let savedScrollTop: number | null = null;

function searchInputElement(): HTMLInputElement | null {
	const input = document.getElementById(SEARCH_INPUT_ID);
	return input instanceof HTMLInputElement ? input : null;
}

function editFirstVisibleRow(queryClient: QueryClient): void {
	const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds, resumeEditing} =
		useOutlineStore.getState();
	const [firstId] = collectVisibleNodeIds(
		queryClient,
		zoomedNodeId,
		expandedIds,
		showCompleted,
		animatingCompletionIds,
	);
	if (firstId !== undefined) {
		resumeEditing(firstId, 0);
	}
}

/**
 * Blur the search box and hand focus back to the outline: `leave` (blurring search by default) resumes the
 * remembered row and caret, else the first visible row is edited. Restores the scroll Escape saved.
 */
export function focusOutline(
	queryClient: QueryClient,
	leave = (): void => {
		useOutlineStore.getState().blurSearch();
	},
): void {
	searchInputElement()?.blur();
	const resumes = useOutlineStore.getState().searchReturn !== null;
	leave();
	if (!resumes) {
		editFirstVisibleRow(queryClient);
	}
	const scrollTop = savedScrollTop;
	savedScrollTop = null;
	if (scrollTop !== null) {
		globalThis.scrollTo(globalThis.scrollX, scrollTop);
	}
}

/** Where the caret sits in the edited name or note, blurring that editor so its text commits. */
function leaveEditor(): SearchReturn | null {
	const {editingId, editingNoteId} = useOutlineStore.getState();
	if (editingId !== null) {
		const editor = editorElement(editingId);
		const from = {nodeId: editingId, caretOffset: editor === null ? 0 : caretTextOffset(editor)};
		editor?.blur();
		return from;
	}
	if (editingNoteId !== null) {
		// Search-return resumes the node's name, not the note: a documented local deviation.
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
		return {nodeId: editingNoteId, caretOffset: Number.MAX_SAFE_INTEGER};
	}
	return null;
}

function popupOwnsEscape(): boolean {
	const {presentationOpen, itemTypePicker} = useOutlineStore.getState();
	return isModalOpen() || presentationOpen || itemTypePicker !== null;
}

/**
 * Upstream's global Escape (`focus_or_unfocus_search`): cancel a committed or typed search and return to the
 * outline, else leave a focused empty search box for the remembered caret, else commit the edited text and focus
 * the search box. Runs on `window` after every popup, menu and editor has had its chance to claim Escape.
 */
export function useSearchEscape(): void {
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (
				event.key !== "Escape" ||
				event.defaultPrevented ||
				event.isComposing ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				event.shiftKey ||
				popupOwnsEscape()
			) {
				return;
			}
			event.preventDefault();
			const state = useOutlineStore.getState();
			const action = escapeAction({
				searchQuery: state.searchQuery,
				searchInput: state.searchInput,
				inputFocused: document.activeElement?.id === SEARCH_INPUT_ID,
			});
			switch (action) {
				case "cancel": {
					const cancel = (): void => {
						useOutlineStore.getState().cancelSearch(navigate);
					};
					if (document.activeElement?.id === SEARCH_INPUT_ID) {
						focusOutline(queryClient, cancel);
					} else {
						// Focus already sits in the outline (or nowhere): keep it there.
						useOutlineStore.setState({searchReturn: null});
						cancel();
					}
					break;
				}
				case "blur": {
					focusOutline(queryClient);
					break;
				}
				case "focus": {
					const from = leaveEditor();
					savedScrollTop = globalThis.scrollY;
					state.focusSearch(from);
					searchInputElement()?.focus();
					break;
				}
			}
		};
		globalThis.addEventListener("keydown", onKeyDown);
		return () => {
			globalThis.removeEventListener("keydown", onKeyDown);
		};
	}, [queryClient, navigate]);
}
