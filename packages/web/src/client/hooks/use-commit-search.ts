import {useCallback} from "react";
import {useNavigate} from "react-router-dom";
import {useOutlineStore} from "../stores/outline.js";

/** Commit `query` as the page's search (pushState), the way the header search box does on Enter. */
export function useCommitSearch(): (query: string) => void {
	const navigate = useNavigate();
	return useCallback(
		(query: string) => {
			useOutlineStore.getState().commitSearch(query, navigate);
		},
		[navigate],
	);
}
