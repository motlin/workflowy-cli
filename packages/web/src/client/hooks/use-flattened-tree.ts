import {useQueries, useQueryClient} from "@tanstack/react-query";
import {nodeKeys} from "../node-cache.js";
import type {NodeResponse} from "../../node-types.js";
import {useMemo} from "react";
import {useOutlineStore} from "../stores/outline.js";
import {useChildren} from "./use-nodes.js";
import {readJson} from "../read-json.js";
import {isPotentiallyVisible, rowHasChildren} from "../tree-ops.js";

/**
 * A flattened node includes the original node data plus its depth in the tree.
 * This allows us to render a flat list with proper indentation.
 */
interface FlattenedNode {
	node: NodeResponse;
	depth: number;
	isExpanded: boolean;
	hasChildren: boolean;
}

async function fetchChildren(parentId: string): Promise<NodeResponse[]> {
	const url = `/api/v1/nodes?parent_id=${encodeURIComponent(parentId)}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch children: ${response.statusText}`);
	}
	const data = await readJson<{nodes: NodeResponse[]}>(response);
	return data.nodes;
}

/**
 * Recursively flattens the tree structure into an array for virtualization.
 * Only includes nodes that are visible (i.e., all ancestors are expanded).
 */
export function flattenTree(
	nodes: NodeResponse[] | undefined,
	expandedIds: Set<string>,
	showCompleted: boolean,
	depth: number,
	childrenMap: Map<string, NodeResponse[]>,
	animating: ReadonlySet<string>,
): FlattenedNode[] {
	if (!nodes || nodes.length === 0) {
		return [];
	}

	const visibleNodes = nodes.filter((node) => isPotentiallyVisible(node, showCompleted, animating));

	const result: FlattenedNode[] = [];

	for (const node of visibleNodes) {
		const isExpanded = expandedIds.has(node.id);
		const children = childrenMap.get(node.id);
		// Use the server-provided child flags when available, otherwise fall back to checking fetched children
		const hasChildren =
			node.hasChildren === undefined
				? children === undefined || children.length > 0
				: rowHasChildren(node, showCompleted);

		result.push({
			node,
			depth,
			isExpanded,
			hasChildren,
		});

		// Only recurse into expanded nodes that have fetched children
		if (isExpanded && children && children.length > 0) {
			const childFlattened = flattenTree(children, expandedIds, showCompleted, depth + 1, childrenMap, animating);
			result.push(...childFlattened);
		}
	}

	return result;
}

/**
 * Collects all expanded node IDs that need their children fetched.
 * Traverses the tree starting from the root and collects expanded IDs.
 */
function collectExpandedIds(
	nodes: NodeResponse[] | undefined,
	expandedIds: Set<string>,
	showCompleted: boolean,
	childrenMap: Map<string, NodeResponse[]>,
	animating: ReadonlySet<string>,
): string[] {
	if (!nodes || nodes.length === 0) {
		return [];
	}

	const visibleNodes = nodes.filter((node) => isPotentiallyVisible(node, showCompleted, animating));
	const result: string[] = [];

	for (const node of visibleNodes) {
		if (expandedIds.has(node.id)) {
			result.push(node.id);
			// Recurse into children if they're available
			const children = childrenMap.get(node.id);
			if (children && children.length > 0) {
				result.push(...collectExpandedIds(children, expandedIds, showCompleted, childrenMap, animating));
			}
		}
	}

	return result;
}

/**
 * Hook that provides a flattened, virtualization-ready tree structure.
 * Fetches children for the root and all expanded nodes.
 *
 * Uses useQueries to fetch children for all expanded nodes in parallel,
 * which ensures React re-renders when any children data changes.
 */
export function useFlattenedTree(rootParentId: string | null) {
	const queryClient = useQueryClient();
	const {expandedIds, showCompleted, animatingCompletionIds} = useOutlineStore();

	// Fetch root children
	const {data: rootChildren, isLoading, error} = useChildren(rootParentId);

	// Build a map of already-fetched children from cache
	// This is needed to know which expanded nodes to query
	const cachedChildrenMap = useMemo(() => {
		const map = new Map<string, NodeResponse[]>();

		// Helper to get cached data
		const getCached = (parentId: string): NodeResponse[] | undefined =>
			queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(parentId));

		// Collect cached children for all expanded nodes
		const collectCached = (nodes: NodeResponse[] | undefined): void => {
			if (!nodes) {
				return;
			}
			for (const node of nodes) {
				if (expandedIds.has(node.id)) {
					const cached = getCached(node.id);
					if (cached) {
						map.set(node.id, cached);
						collectCached(cached);
					}
				}
			}
		};

		collectCached(rootChildren);
		return map;
	}, [rootChildren, expandedIds, queryClient]);

	// Collect IDs of expanded nodes that need their children fetched
	const expandedNodeIds = useMemo(
		() => collectExpandedIds(rootChildren, expandedIds, showCompleted, cachedChildrenMap, animatingCompletionIds),
		[rootChildren, expandedIds, showCompleted, cachedChildrenMap, animatingCompletionIds],
	);

	// Fetch children for all expanded nodes using useQueries
	// This ensures we re-render when any children data changes
	const childrenQueries = useQueries({
		queries: expandedNodeIds.map((nodeId) => ({
			queryKey: nodeKeys.children(nodeId),
			queryFn: async () => fetchChildren(nodeId),
		})),
	});

	// Build a complete map of all children data
	const childrenMap = useMemo(() => {
		const map = new Map<string, NodeResponse[]>();

		// Add data from queries
		for (const [i, expandedNodeId] of expandedNodeIds.entries()) {
			const query = childrenQueries[i];
			if (query?.data) {
				map.set(expandedNodeId, query.data);
			}
		}

		return map;
	}, [expandedNodeIds, childrenQueries]);

	// Flatten the tree structure
	const flattenedNodes = useMemo(
		() => flattenTree(rootChildren, expandedIds, showCompleted, 0, childrenMap, animatingCompletionIds),
		[rootChildren, expandedIds, showCompleted, childrenMap, animatingCompletionIds],
	);

	return {
		flattenedNodes,
		isLoading,
		error,
	};
}
