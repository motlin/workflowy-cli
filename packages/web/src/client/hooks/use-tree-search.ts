import {useQueries, useQuery} from "@tanstack/react-query";
import type {TreeSearchResult} from "../../server/tree-search.js";
import {nodeKeys} from "../node-cache.js";
import {readJson} from "../read-json.js";
import type {SearchFilter} from "../search-filter.js";
import {useOutlineStore} from "../stores/outline.js";
import {fetchChildren} from "./use-nodes.js";

async function fetchTreeSearch(query: string, rootId: string | null): Promise<TreeSearchResult> {
	const response = await fetch("/api/search/tree", {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({query, rootId}),
	});
	if (!response.ok) {
		throw new Error(`Tree search failed: ${response.statusText}`);
	}
	return readJson<TreeSearchResult>(response);
}

/** The committed search's matches under the zoomed node, re-fetched when the query is re-run. */
function useTreeSearch() {
	const zoomedNodeId = useOutlineStore((state) => state.zoomedNodeId);
	const searchQuery = useOutlineStore((state) => state.searchQuery);
	const searchRun = useOutlineStore((state) => state.searchRun);
	return useQuery({
		queryKey: ["tree-search", zoomedNodeId, searchQuery, searchRun],
		queryFn: async () => fetchTreeSearch(searchQuery, zoomedNodeId),
		enabled: searchQuery !== "",
	});
}

/** The in-place filter for the outline, or null when no search is committed or its result has not arrived. */
export function useSearchFilter(): SearchFilter | null {
	const searchQuery = useOutlineStore((state) => state.searchQuery);
	const createdIds = useOutlineStore((state) => state.searchCreatedIds);
	const expansion = useOutlineStore((state) => state.searchExpansion);
	const {data} = useTreeSearch();
	return searchQuery === "" || data === undefined ? null : {result: data, createdIds, expansion};
}

/** Fetch the children of every search-expanded ancestor at once rather than level by level as rows render. */
export function usePrefetchSearchAncestors(search: SearchFilter | null): void {
	useQueries({
		queries: (search?.result.ancestorIds ?? []).map((id) => ({
			queryKey: nodeKeys.children(id),
			queryFn: async () => fetchChildren(id),
		})),
	});
}
