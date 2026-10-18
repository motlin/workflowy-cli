import {useQueryClient} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import {nodeKeys} from "../node-cache.js";
import type {NodeResponse} from "../../node-types.js";
import {useMemo} from "react";
import {useOutlineStore} from "../stores/outline.js";
import {isPotentiallyVisible} from "../tree-ops.js";

/**
 * Builds a flattened list of visible node IDs in display order.
 * A node is visible if:
 * - It's a direct child of the zoomed node (or root if no zoom)
 * - All its ancestors are expanded
 * - It's not completed when showCompleted is false, unless its completion is still animating
 *
 * Uses TanStack Query's cached data to traverse the tree.
 */
export function collectVisibleNodeIds(
	queryClient: QueryClient,
	zoomedNodeId: string | null,
	expandedIds: ReadonlySet<string>,
	showCompleted: boolean,
	animatingCompletionIds: ReadonlySet<string>,
): string[] {
	const visibleIds: string[] = [];

	const collectVisibleNodes = (parentId: string | null) => {
		const children = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(parentId));

		if (!children) {
			return;
		}

		const filteredChildren = children.filter((node) =>
			isPotentiallyVisible(node, showCompleted, animatingCompletionIds),
		);

		for (const node of filteredChildren) {
			visibleIds.push(node.id);

			if (expandedIds.has(node.id)) {
				collectVisibleNodes(node.id);
			}
		}
	};

	collectVisibleNodes(zoomedNodeId);
	return visibleIds;
}

export function useVisibleNodes(): string[] {
	const queryClient = useQueryClient();
	const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = useOutlineStore();

	return useMemo(
		() => collectVisibleNodeIds(queryClient, zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds),
		[queryClient, zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds],
	);
}
