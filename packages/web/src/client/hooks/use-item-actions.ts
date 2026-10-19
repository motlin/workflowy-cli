import {useCallback} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {internalLinkUrl} from "../item-menu-model.js";
import {nodeKeys} from "../node-cache.js";
import {runSortChildren} from "../sort-children.js";
import type {SortDirection} from "../sort-children.js";
import {useOutlineStore} from "../stores/outline.js";
import {captureOutlineView, runInUndoBatch} from "../undo-batch.js";
import {fetchChildren, useMoveNodes} from "./use-nodes.js";

/** Upstream `copy_link`: copy the item's internal link and confirm with a brief toast. */
export function useCopyLink(): (nodeId: string) => Promise<void> {
	const showAppMessage = useOutlineStore((state) => state.showAppMessage);
	return useCallback(
		async (nodeId) => {
			await navigator.clipboard.writeText(internalLinkUrl(nodeId));
			showAppMessage("Link copied.", {timeout: 1000});
		},
		[showAppMessage],
	);
}

/** Upstream `sort_children_asc` / `sort_children_desc`: sort the item's children in one undo step, with an undo toast. */
export function useSortChildren(): (nodeId: string, direction: SortDirection) => Promise<void> {
	const queryClient = useQueryClient();
	const moveNodes = useMoveNodes();
	const showAppMessage = useOutlineStore((state) => state.showAppMessage);
	return useCallback(
		async (nodeId, direction) => {
			const children = await queryClient.query({
				queryKey: nodeKeys.children(nodeId),
				queryFn: async () => fetchChildren(nodeId),
				staleTime: "static",
			});
			await runInUndoBatch(captureOutlineView, () => {
				runSortChildren({
					parentId: nodeId,
					children: children.map((child) => ({id: child.id, name: child.name ?? "", movable: true})),
					direction,
					moveNodes: (request) => {
						moveNodes.mutate(request);
					},
					showToast: ({text, timeout, undoLabel, undo}) => {
						showAppMessage(text, {
							timeout,
							actions: [
								{
									label: undoLabel,
									run: () => {
										void runInUndoBatch(captureOutlineView, undo);
									},
								},
							],
						});
					},
				});
			});
		},
		[queryClient, moveNodes, showAppMessage],
	);
}
