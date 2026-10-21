import type {QueryClient} from "@tanstack/react-query";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useEffect} from "react";
import type {TreeSearchResult} from "../../server/tree-search.js";
import {readJson} from "../read-json.js";
import {prefetchSearchAncestors} from "../search-prefetch.js";
import type {SearchFilter} from "../search-filter.js";
import {searchFilter} from "../search-filter.js";
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

/** The tree-search query key; the session scopes which earlier results may stand in while a new one loads. */
export function treeSearchKey(session: number, zoomedNodeId: string | null, query: string, run: number) {
	return ["tree-search", session, zoomedNodeId, query, run] as const;
}

/** The most recently fetched result of this search session, shown while a changed or re-run query loads. */
function latestSessionResult(queryClient: QueryClient, session: number): TreeSearchResult | undefined {
	let latest: {result: TreeSearchResult; updatedAt: number} | undefined;
	for (const [key, result] of queryClient.getQueriesData<TreeSearchResult>({queryKey: ["tree-search", session]})) {
		const updatedAt = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
		if (result !== undefined && (latest === undefined || updatedAt > latest.updatedAt)) {
			latest = {result, updatedAt};
		}
	}
	return latest?.result;
}

interface SearchState {
	zoomedNodeId: string | null;
	searchQuery: string;
	searchRun: number;
	searchSession: number;
}

/**
 * The tree-search query: the committed search's matches under the zoomed node, re-fetched when the query is re-run.
 * While a new result loads, the session's previous result stays in place so the unfiltered outline never flashes.
 * Every row reads this query and that lookup scans the whole query cache, so it is left out once the search is
 * cleared: run per row on Back, it froze the tab for seconds.
 */
export function treeSearchOptions(
	queryClient: QueryClient,
	{zoomedNodeId, searchQuery, searchRun, searchSession}: SearchState,
) {
	return {
		queryKey: treeSearchKey(searchSession, zoomedNodeId, searchQuery, searchRun),
		queryFn: async () => fetchTreeSearch(searchQuery, zoomedNodeId),
		enabled: searchQuery !== "",
		placeholderData: searchQuery === "" ? undefined : () => latestSessionResult(queryClient, searchSession),
	};
}

function useTreeSearch() {
	const queryClient = useQueryClient();
	const zoomedNodeId = useOutlineStore((state) => state.zoomedNodeId);
	const searchQuery = useOutlineStore((state) => state.searchQuery);
	const searchRun = useOutlineStore((state) => state.searchRun);
	const searchSession = useOutlineStore((state) => state.searchSession);
	return useQuery(treeSearchOptions(queryClient, {zoomedNodeId, searchQuery, searchRun, searchSession}));
}

/** The in-place filter for the outline, or null when no search is committed or no result has arrived yet. */
export function useSearchFilter(): SearchFilter | null {
	const searchQuery = useOutlineStore((state) => state.searchQuery);
	const createdIds = useOutlineStore((state) => state.searchCreatedIds);
	const expansion = useOutlineStore((state) => state.searchExpansion);
	const {data} = useTreeSearch();
	return searchQuery === "" || data === undefined ? null : searchFilter(data, createdIds, expansion);
}

/** `useSearchFilter` read from the store and cache at call time, for commands such as the caret walk. */
export function currentSearchFilter(queryClient: QueryClient): SearchFilter | null {
	const {zoomedNodeId, searchQuery, searchRun, searchSession, searchCreatedIds, searchExpansion} =
		useOutlineStore.getState();
	if (searchQuery === "") {
		return null;
	}
	const result =
		queryClient.getQueryData<TreeSearchResult>(
			treeSearchKey(searchSession, zoomedNodeId, searchQuery, searchRun),
		) ?? latestSessionResult(queryClient, searchSession);
	return result === undefined ? null : searchFilter(result, searchCreatedIds, searchExpansion);
}

/**
 * Prefetch the children of the first search-expanded ancestors, a few at a time, rather than level by level as rows
 * render. Runs in an effect without subscribing, so a resolved prefetch re-renders only the rows that show it.
 */
export function usePrefetchSearchAncestors(search: SearchFilter | null): void {
	const queryClient = useQueryClient();
	const result = search?.result;
	useEffect(() => {
		const controller = new AbortController();
		void prefetchSearchAncestors(queryClient, result?.ancestorIds ?? [], fetchChildren, controller.signal);
		return () => {
			controller.abort();
		};
	}, [queryClient, result]);
}

/** The committed search's latest result, and whether the result for the current query is still on its way. */
export function useSearchProgress(): {result: TreeSearchResult | undefined; searching: boolean} {
	const {data, isPending, isPlaceholderData} = useTreeSearch();
	return {result: data, searching: isPending || isPlaceholderData};
}
