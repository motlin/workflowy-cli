import {notifyManager} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import type {BacklinksResponse, NodeResponse, OutlineViewResponse} from "../node-types.js";
import {nodeKeys} from "./node-cache.js";
import {pendingCreates} from "./pending-creates.js";
import {pendingMoves} from "./pending-moves.js";
import {viewParentIds} from "./render-window.js";

/** What an outline view under a root renders: expansion, completion, and the rows it mounts at most. */
export interface OutlineViewShape {
	expandedIds: ReadonlySet<string>;
	showCompleted: boolean;
	budget: number;
}

/** The body of `POST /api/v1/nodes/view`. */
export interface OutlineViewRequest {
	rootId: string | null;
	expandedIds: string[];
	limit: number;
	showCompleted: boolean;
}

/** The query an outline view's load runs under; outside `nodes`, so a tree write's invalidation does not rerun it. */
export function outlineViewKey(rootId: string | null) {
	return ["outline-view", rootId] as const;
}

/** Whether the cache holds every list and Backlinks section the view under `rootId` renders within its budget. */
export function outlineViewCached(queryClient: QueryClient, rootId: string | null, shape: OutlineViewShape): boolean {
	const parentIds = viewParentIds(
		(parentId) => queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(parentId)),
		rootId,
		shape.budget,
		{
			expandedIds: shape.expandedIds,
			showCompleted: shape.showCompleted,
			animatingCompletionIds: new Set(),
			search: null,
		},
	);
	return (
		parentIds?.every(
			(parentId) =>
				parentId === null ||
				queryClient.getQueryData<BacklinksResponse>(nodeKeys.backlinks(parentId)) !== undefined,
		) ?? false
	);
}

/**
 * Load the outline view under `rootId` in one request: the root's children and those of every expanded row the row
 * budget reaches, with their Backlinks sections, so the view renders whole instead of one depth level per round
 * trip. Lists the cache already holds stay (they may carry optimistic writes), as does a list a pending move touches;
 * with the whole view cached, nothing is sent.
 */
export async function loadOutlineView(
	queryClient: QueryClient,
	rootId: string | null,
	shape: OutlineViewShape,
	fetchView: (request: OutlineViewRequest) => Promise<OutlineViewResponse>,
): Promise<void> {
	if (outlineViewCached(queryClient, rootId, shape)) {
		return;
	}
	await pendingMoves.settled(rootId);
	const {lists} = await fetchView({
		rootId,
		expandedIds: [...shape.expandedIds],
		limit: shape.budget,
		showCompleted: shape.showCompleted,
	});
	notifyManager.batch(() => {
		for (const {parentId, nodes, backlinks} of lists) {
			if (queryClient.getQueryData(nodeKeys.children(parentId)) === undefined && !pendingMoves.has(parentId)) {
				queryClient.setQueryData(nodeKeys.children(parentId), pendingCreates.withPending(parentId, nodes));
			}
			if (
				parentId !== null &&
				backlinks !== null &&
				queryClient.getQueryData(nodeKeys.backlinks(parentId)) === undefined
			) {
				queryClient.setQueryData(nodeKeys.backlinks(parentId), backlinks);
			}
		}
	});
}
