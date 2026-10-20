import type {QueryClient} from "@tanstack/react-query";
import type {NodeResponse} from "../node-types.js";
import {sortByPriority} from "./tree-position.js";

/**
 * The single source of truth for React Query cache keys under the `nodes`
 * namespace. Every reader/writer must go through this factory — a hand-rolled
 * key array that drifts from these shapes silently misses the cache (a
 * `getQueryData` on a mismatched key returns `undefined`, degrading to a refetch
 * with no type error).
 */
export const nodeKeys = {
	all: ["nodes"] as const,
	children: (parentId: string | null) => [...nodeKeys.all, "children", parentId] as const,
	detail: (nodeId: string) => [...nodeKeys.all, "detail", nodeId] as const,
	ancestors: (nodeId: string) => [...nodeKeys.all, "ancestors", nodeId] as const,
	backlinks: (nodeId: string) => [...nodeKeys.all, "backlinks", nodeId] as const,
	/** A day page's Found Dates; under `nodes` so any tree write refreshes it. */
	foundDates: (dayId: string) => [...nodeKeys.all, "found-dates", dayId] as const,
	/** Home's own metadata (`GET /api/v1/home`): its layoutMode. */
	home: () => [...nodeKeys.all, "home"] as const,
	/** A location id (short or full) resolved to the full uuid, or null when the server has no such node. */
	resolvedId: (locationId: string) => [...nodeKeys.all, "resolved-id", locationId] as const,
};

/** Read a parent's cached children, or undefined if not cached. */
export function readChildren(queryClient: QueryClient, parentId: string | null): NodeResponse[] | undefined {
	return queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(parentId));
}

/** Read a single node's cached detail, or undefined if not cached. */
export function readDetail(queryClient: QueryClient, nodeId: string): NodeResponse | undefined {
	return queryClient.getQueryData<NodeResponse>(nodeKeys.detail(nodeId));
}

/**
 * A node from its detail cache, else from whichever cached children list holds it.
 * Rows render from children lists, so most visible nodes have no detail entry.
 */
export function readNode(queryClient: QueryClient, nodeId: string): NodeResponse | undefined {
	const detail = readDetail(queryClient, nodeId);
	if (detail) {
		return detail;
	}
	for (const [, children] of queryClient.getQueriesData<NodeResponse[]>({queryKey: [...nodeKeys.all, "children"]})) {
		const found = children?.find((child) => child.id === nodeId);
		if (found) {
			return found;
		}
	}
	return undefined;
}

/**
 * A command's item node: the fetched edited node when it is the item, else the cached row. Right after a
 * click or Enter the edited node's fetch has not returned (a new row's waits for its create), and the
 * cached row keeps hotkeys pressed then from being dropped.
 */
export function readItemNode(
	queryClient: QueryClient,
	itemId: string | undefined,
	editedNode: NodeResponse | undefined,
): NodeResponse | undefined {
	if (itemId === undefined) {
		return undefined;
	}
	return editedNode?.id === itemId ? editedNode : readNode(queryClient, itemId);
}

/**
 * Upstream move/insert splice: sort `children` by priority, drop any copy of `row`,
 * insert it at `index` (a move slot, see `spliceBlock`), and renumber priorities `(i+1)*100`.
 */
export function spliceChildren(children: NodeResponse[], row: NodeResponse, index: number): NodeResponse[] {
	return spliceBlock(children, [row], index);
}

/**
 * Upstream `bulk_move` splice: remove every row in `rows` from `children`, then insert
 * them contiguously in the given order. `index` is the move endpoint's slot: counted
 * among ALL of `children` in priority order, moved rows included (before removal),
 * so `index` lands the block right before the row that sat at `index`; clamped to the end.
 */
export function spliceBlock<T extends Pick<NodeResponse, "id" | "priority">>(
	children: T[],
	rows: T[],
	index: number,
): T[] {
	const moving = new Set(rows.map((row) => row.id));
	const sorted = sortByPriority(children);
	const others = sorted.filter((child) => !moving.has(child.id));
	const at = sorted.slice(0, Math.max(0, index)).filter((child) => !moving.has(child.id)).length;
	return [...others.slice(0, at), ...rows, ...others.slice(at)].map((child, i) => ({
		...child,
		priority: (i + 1) * 100,
	}));
}

/** The cache entries that hold `nodeId`: its detail entry and every cached children list containing its row. */
function cachedNodeEntries(
	queryClient: QueryClient,
	nodeId: string,
): [readonly unknown[], NodeResponse | NodeResponse[]][] {
	const entries: [readonly unknown[], NodeResponse | NodeResponse[]][] = [];
	const detail = readDetail(queryClient, nodeId);
	if (detail) {
		entries.push([nodeKeys.detail(nodeId), detail]);
	}
	for (const [key, children] of queryClient.getQueriesData<NodeResponse[]>({
		queryKey: [...nodeKeys.all, "children"],
	})) {
		if (children?.some((child) => child.id === nodeId)) {
			entries.push([key, children]);
		}
	}
	return entries;
}

function restoring(queryClient: QueryClient, entries: [readonly unknown[], unknown][]): () => void {
	return () => {
		for (const [key, value] of entries) {
			queryClient.setQueryData(key, value);
		}
	};
}

/** Snapshot every cache entry that holds `nodeId` without changing it; returns a function that restores them. */
export function snapshotCachedNode(queryClient: QueryClient, nodeId: string): () => void {
	return restoring(queryClient, cachedNodeEntries(queryClient, nodeId));
}

/**
 * Optimistically apply `patch` to `nodeId` everywhere the outline reads it: its detail
 * entry and its row in every cached children list (rows render from the list, so a
 * detail-only patch leaves the row showing stale text until the refetch). Returns a
 * function that restores every touched entry.
 */
export function patchCachedNode(
	queryClient: QueryClient,
	nodeId: string,
	apply: (node: NodeResponse) => NodeResponse,
): () => void {
	const entries = cachedNodeEntries(queryClient, nodeId);
	for (const [key, value] of entries) {
		queryClient.setQueryData(
			key,
			Array.isArray(value) ? value.map((child) => (child.id === nodeId ? apply(child) : child)) : apply(value),
		);
	}
	return restoring(queryClient, entries);
}
