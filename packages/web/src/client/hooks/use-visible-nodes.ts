import type {QueryClient} from "@tanstack/react-query";
import {nodeKeys} from "../node-cache.js";
import type {NodeResponse} from "../../node-types.js";
import {useOutlineStore} from "../stores/outline.js";
import {isPotentiallyVisible, rowHasChildren} from "../tree-ops.js";
import type {ExpansionRow} from "../expansion.js";
import {navigableIds} from "../caret-navigation.js";

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

/**
 * The nodes the caret can visit right now, in display order: the zoom root's
 * title (when zoomed) then the visible rows. Reads the store and cache at call
 * time, so commands see rows created since the last render.
 */
export function currentNavigableIds(queryClient: QueryClient): string[] {
	const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = useOutlineStore.getState();
	return navigableIds(
		zoomedNodeId,
		collectVisibleNodeIds(queryClient, zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds),
	);
}

/**
 * The rendered rows under the zoom root with their depth and whether each is a parent, read from the store and
 * cache at call time, for the zoom root's level-by-level ⌘↓ / ⌘↑ and page-wide ⌃Space.
 */
export function currentExpansionRows(queryClient: QueryClient): ExpansionRow[] {
	const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = useOutlineStore.getState();
	const rows: ExpansionRow[] = [];
	const walk = (parentId: string | null, depth: number) => {
		const children = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(parentId)) ?? [];
		for (const node of children) {
			if (!isPotentiallyVisible(node, showCompleted, animatingCompletionIds)) {
				continue;
			}
			const cached = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(node.id));
			const hasVisibleChildren =
				node.hasChildren === undefined
					? cached === undefined || cached.length > 0
					: rowHasChildren(node, showCompleted);
			rows.push({id: node.id, depth, hasVisibleChildren});
			if (expandedIds.has(node.id)) {
				walk(node.id, depth + 1);
			}
		}
	};
	walk(zoomedNodeId, 0);
	return rows;
}
