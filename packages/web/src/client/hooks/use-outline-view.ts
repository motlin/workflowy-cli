import {useQuery, useQueryClient} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import {loadOutlineView, outlineViewCached, outlineViewKey} from "../outline-view.js";
import type {OutlineViewShape} from "../outline-view.js";
import {initialRowBudget} from "../render-window.js";
import {useOutlineStore} from "../stores/outline.js";
import {usePaneExpandedIds} from "../components/pane-context.js";
import {fetchOutlineView} from "./use-nodes.js";

/** The view a pane with `expandedIds` shows now: the first row budget a new view reaches after its first paint. */
export function outlineViewShape(expandedIds: ReadonlySet<string>, showCompleted: boolean): OutlineViewShape {
	return {
		expandedIds,
		showCompleted,
		budget: initialRowBudget(typeof window === "undefined" ? 0 : window.innerHeight),
	};
}

function viewQuery(queryClient: QueryClient, rootId: string | null, shape: OutlineViewShape) {
	return {
		queryKey: outlineViewKey(rootId),
		// A failed load leaves each level to its own children query.
		queryFn: async () => {
			await loadOutlineView(queryClient, rootId, shape, fetchOutlineView).catch(ignoreFailure);
			return true;
		},
		// Loaded once per visit: a later expand loads its own level, and leaving the view drops the entry, so the next
		// visit loads what the cache is missing then.
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 0,
	} as const;
}

function ignoreFailure(): void {}

/** Load the outline view under `rootId` (see `loadOutlineView`) through the query the outline waits on. */
export async function queryOutlineView(
	queryClient: QueryClient,
	rootId: string | null,
	shape: OutlineViewShape,
): Promise<void> {
	await queryClient.query(viewQuery(queryClient, rootId, shape));
}

/**
 * Whether the outline view under `rootId` is still loading in one request, for the outline to keep the previous view
 * on screen until the new one renders whole. Already cached, it is loaded from the first render.
 */
export function useOutlineViewPending(rootId: string | null): boolean {
	const queryClient = useQueryClient();
	const expandedIds = usePaneExpandedIds();
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const shape = outlineViewShape(expandedIds, showCompleted);
	return useQuery({
		...viewQuery(queryClient, rootId, shape),
		initialData: () => (outlineViewCached(queryClient, rootId, shape) ? true : undefined),
	}).isPending;
}
