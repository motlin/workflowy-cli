import {useQueryClient} from "@tanstack/react-query";
import {HOME_TARGET} from "@workflowy/shared/types";
import {readChildren, readNode} from "../node-cache.js";
import type {ItemTypeSelectDeps} from "../item-type-select.js";
import {activePaneView} from "../stores/outline.js";
import {useUpdateNode} from "./use-nodes.js";

/** What choosing a "Turn into" type needs from the outline: layout writes, expansion and the cached tree. */
export function useItemTypeSelectDeps(): ItemTypeSelectDeps {
	const queryClient = useQueryClient();
	const updateNode = useUpdateNode();
	return {
		update: (nodeId, layoutMode) => {
			updateNode.mutate({nodeId, layoutMode});
		},
		expandAll: (ids) => {
			const {expandedIds, replaceExpanded} = activePaneView();
			replaceExpanded(new Set([...expandedIds, ...ids]));
		},
		childIds: (nodeId) =>
			(readChildren(queryClient, nodeId === HOME_TARGET ? null : nodeId) ?? []).map((child) => child.id),
		layoutMode: (nodeId) => readNode(queryClient, nodeId)?.data.layoutMode ?? null,
	};
}
