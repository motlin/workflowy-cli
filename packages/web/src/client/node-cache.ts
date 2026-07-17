import type {QueryClient} from '@tanstack/react-query';
import type {NodeResponse} from '../node-types.js';

/**
 * The single source of truth for React Query cache keys under the `nodes`
 * namespace. Every reader/writer must go through this factory — a hand-rolled
 * key array that drifts from these shapes silently misses the cache (a
 * `getQueryData` on a mismatched key returns `undefined`, degrading to a refetch
 * with no type error).
 */
export const nodeKeys = {
	all: ['nodes'] as const,
	children: (parentId: string | null) => [...nodeKeys.all, 'children', parentId] as const,
	detail: (nodeId: string) => [...nodeKeys.all, 'detail', nodeId] as const,
	ancestors: (nodeId: string) => [...nodeKeys.all, 'ancestors', nodeId] as const,
};

/** Read a parent's cached children, or undefined if not cached. */
export function readChildren(queryClient: QueryClient, parentId: string | null): NodeResponse[] | undefined {
	return queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(parentId));
}

/** Read a single node's cached detail, or undefined if not cached. */
export function readDetail(queryClient: QueryClient, nodeId: string): NodeResponse | undefined {
	return queryClient.getQueryData<NodeResponse>(nodeKeys.detail(nodeId));
}
