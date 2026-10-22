import {useQuery, useQueryClient} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import {loadOutlineView, outlineViewCached, outlineViewKey} from "../outline-view.js";
import type {OutlineViewShape} from "../outline-view.js";
import {initialRowBudget} from "../render-window.js";
import {useOutlineStore} from "../stores/outline.js";
import {usePaneExpandedIds, usePaneId} from "../components/pane-context.js";
import {paneExpandedIds} from "../pane-ids.js";
import {adoptViewExpansion, initialExpansionPending} from "./use-expansion-sync.js";
import {fetchOutlineView} from "./use-nodes.js";

/** The view a pane with `expandedIds` shows now: the first row budget a new view reaches after its first paint. */
export function outlineViewShape(expandedIds: ReadonlySet<string>, showCompleted: boolean): OutlineViewShape {
	return {
		expandedIds,
		showCompleted,
		budget: initialRowBudget(typeof window === "undefined" ? 0 : window.innerHeight),
	};
}

/**
 * While the page load's expansion GET is in flight, the main outline's view expands the account's rows on the server
 * instead of waiting on it, and adopts the ones it reached, so the first view still loads every level it expands.
 */
function viewQuery(queryClient: QueryClient, rootId: string | null, shape: () => OutlineViewShape) {
	return {
		queryKey: outlineViewKey(rootId),
		// A failed load leaves each level to its own children query.
		queryFn: async () => {
			const current = shape();
			const accountExpansion =
				initialExpansionPending() && current.expandedIds === useOutlineStore.getState().expandedIds
					? adoptViewExpansion
					: undefined;
			await loadOutlineView(queryClient, rootId, current, fetchOutlineView, accountExpansion).catch(
				ignoreFailure,
			);
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
	await queryClient.query(viewQuery(queryClient, rootId, () => shape));
}

/**
 * Whether the outline view under `rootId` is still loading in one request, for the outline to keep the previous view
 * on screen until the new one renders whole. Already cached, it is loaded from the first render.
 */
export function useOutlineViewPending(rootId: string | null): boolean {
	const queryClient = useQueryClient();
	const paneId = usePaneId();
	const expandedIds = usePaneExpandedIds();
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const shape = outlineViewShape(expandedIds, showCompleted);
	const currentShape = () => {
		const state = useOutlineStore.getState();
		return outlineViewShape(paneExpandedIds(state, paneId), state.showCompleted);
	};
	return useQuery({
		...viewQuery(queryClient, rootId, currentShape),
		initialData: () => (outlineViewCached(queryClient, rootId, shape) ? true : undefined),
	}).isPending;
}
