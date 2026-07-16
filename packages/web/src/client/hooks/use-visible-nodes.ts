import {useQueryClient} from '@tanstack/react-query';
import type {NodeResponse} from '../../node-types.js';
import {useMemo} from 'react';
import {useOutlineStore} from '../stores/outline.js';

/**
 * Builds a flattened list of visible node IDs in display order.
 * A node is visible if:
 * - It's a direct child of the zoomed node (or root if no zoom)
 * - All its ancestors are expanded
 * - It's not completed when showCompleted is false
 *
 * Uses TanStack Query's cached data to traverse the tree.
 */
export function useVisibleNodes(): string[] {
	const queryClient = useQueryClient();
	const {zoomedNodeId, expandedIds, showCompleted} = useOutlineStore();

	return useMemo(() => {
		const visibleIds: string[] = [];

		const collectVisibleNodes = (parentId: string | null) => {
			const queryKey = ['nodes', 'children', parentId];
			const children = queryClient.getQueryData<NodeResponse[]>(queryKey);

			if (!children) {
				return;
			}

			const filteredChildren = showCompleted ? children : children.filter((node) => node.completedAt === null);

			for (const node of filteredChildren) {
				visibleIds.push(node.id);

				if (expandedIds.has(node.id)) {
					collectVisibleNodes(node.id);
				}
			}
		};

		collectVisibleNodes(zoomedNodeId);
		return visibleIds;
	}, [queryClient, zoomedNodeId, expandedIds, showCompleted]);
}
