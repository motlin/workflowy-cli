import {useCallback} from "react";
import {useStableNavigate} from "./use-stable-navigate.js";
import {useOutlineStore} from "../stores/outline.js";

/** Commit `query` as the page's search (pushState), the way the header search box does on Enter. */
export function useCommitSearch(): (query: string) => void {
	const navigate = useStableNavigate();
	return useCallback(
		(query: string) => {
			useOutlineStore.getState().commitSearch(query, navigate);
		},
		[navigate],
	);
}
