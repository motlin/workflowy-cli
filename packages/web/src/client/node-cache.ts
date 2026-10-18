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
export function spliceBlock(children: NodeResponse[], rows: NodeResponse[], index: number): NodeResponse[] {
	const moving = new Set(rows.map((row) => row.id));
	const sorted = sortByPriority(children);
	const others = sorted.filter((child) => !moving.has(child.id));
	const at = sorted.slice(0, Math.max(0, index)).filter((child) => !moving.has(child.id)).length;
	return [...others.slice(0, at), ...rows, ...others.slice(at)].map((child, i) => ({
		...child,
		priority: (i + 1) * 100,
	}));
}
