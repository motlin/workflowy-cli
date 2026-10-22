import {useCallback, useContext} from "react";
import type {NavigateFn} from "../stores/outline.js";
import {useOutlineStore} from "../stores/outline.js";
import {PaneContext} from "../components/pane-context.js";
import {MAIN_PANE_ID, findPane} from "../pane-ids.js";
import {toggleTagInQuery} from "../tag-render.js";
import {paneSearchState} from "./use-tree-search.js";
import {useStableNavigate} from "./use-stable-navigate.js";

/**
 * Upstream's tag click searches within the pane it was clicked in: toggle `tag` in that pane's query. An open pane's
 * query is its own (written to panes=v2); the main pane's commits as the page's search (pushState).
 */
export function togglePaneTagSearch(paneId: string, tag: string, navigate: NavigateFn): void {
	const state = useOutlineStore.getState();
	const query = toggleTagInQuery(paneSearchState(state, paneId).searchQuery, tag);
	if (findPane(state.panes, paneId) !== undefined) {
		state.setPaneQuery(paneId, query);
		return;
	}
	state.commitSearch(query, navigate);
}

/** `togglePaneTagSearch` for the pane the caller renders in. */
export function usePaneTagSearch(): (tag: string) => void {
	const navigate = useStableNavigate();
	const paneId = useContext(PaneContext)?.id ?? MAIN_PANE_ID;
	return useCallback(
		(tag: string) => {
			togglePaneTagSearch(paneId, tag, navigate);
		},
		[navigate, paneId],
	);
}
