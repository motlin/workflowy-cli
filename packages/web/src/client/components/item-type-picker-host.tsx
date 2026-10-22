import {useQueryClient} from "@tanstack/react-query";
import {HOME_TARGET} from "@workflowy/shared/types";
import {useUpdateNode} from "../hooks/use-nodes.js";
import {pickerItemTypes, selectItemType} from "../item-type-select.js";
import type {ItemTypeSelectDeps} from "../item-type-select.js";
import type {ItemType} from "../layout-types.js";
import {readChildren, readNode} from "../node-cache.js";
import {activePaneView, useOutlineStore} from "../stores/outline.js";
import {ItemTypePicker} from "./layout-menu.js";

/** Upstream's one "item-types.picker" root: shows the picker wherever `showItemTypePicker` opened it. */
export function ItemTypePickerHost() {
	const picker = useOutlineStore((state) => state.itemTypePicker);
	const hideItemTypePicker = useOutlineStore((state) => state.hideItemTypePicker);
	const queryClient = useQueryClient();
	const updateNode = useUpdateNode();

	if (picker === null) {
		return null;
	}
	const types = pickerItemTypes(picker.nodeIds);
	if (types.length === 0) {
		return null;
	}

	const deps: ItemTypeSelectDeps = {
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

	const handleSelect = (type: ItemType) => {
		selectItemType(type, picker.nodeIds, deps);
	};

	return (
		<ItemTypePicker onClose={hideItemTypePicker} onSelect={handleSelect} position={picker.position} types={types} />
	);
}
