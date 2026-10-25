import {useQueryClient} from "@tanstack/react-query";
import {lineSplitRequests} from "../line-split.js";
import {plainText} from "../rich-text.js";
import {HOME_TARGET} from "@workflowy/shared/types";
import {readChildren, readNode} from "../node-cache.js";
import type {ItemTypeSelectDeps} from "../item-type-select.js";
import {activePaneView} from "../stores/outline.js";
import {useCreateNode, useUpdateNode} from "./use-nodes.js";

/** What choosing a "Turn into" type needs from the outline: layout writes, expansion and the cached tree. */
export function useItemTypeSelectDeps(): ItemTypeSelectDeps {
	const queryClient = useQueryClient();
	const updateNode = useUpdateNode();
	const createNode = useCreateNode();
	return {
		update: (nodeId, layoutMode, extra) => {
			updateNode.mutate({nodeId, layoutMode, ...extra});
		},
		plainName: (nodeId) => plainText(readNode(queryClient, nodeId)?.name ?? "", ""),
		createAfter: (nodeId, lines) => {
			for (const request of lineSplitRequests(
				queryClient,
				lines.map((line) => ({afterId: nodeId, ...line})),
			)) {
				createNode.mutate(request);
			}
		},
		hasNote: (nodeId) => (readNode(queryClient, nodeId)?.note ?? "") !== "",
		expandAll: (ids) => {
			const {expandedIds, replaceExpanded} = activePaneView();
			replaceExpanded(new Set([...expandedIds, ...ids]));
		},
		childIds: (nodeId) =>
			(readChildren(queryClient, nodeId === HOME_TARGET ? null : nodeId) ?? []).map((child) => child.id),
		layoutMode: (nodeId) => readNode(queryClient, nodeId)?.data.layoutMode ?? null,
	};
}
