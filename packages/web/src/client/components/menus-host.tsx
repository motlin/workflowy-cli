import {useQueryClient} from "@tanstack/react-query";
import {HOME_TARGET} from "@workflowy/shared/types";
import {useUpdateNode} from "../hooks/use-nodes.js";
import {selectItemType} from "../item-type-select.js";
import type {ItemTypeSelectDeps} from "../item-type-select.js";
import type {ItemType} from "../layout-types.js";
import {readChildren, readNode} from "../node-cache.js";
import {requestedMenuEntries} from "../requested-menu.js";
import {activePaneView, useOutlineStore} from "../stores/outline.js";
import type {RequestedMenu} from "../stores/outline.js";
import {ItemTypePicker} from "./layout-menu.js";

function NodeTypePickerMenu({menu}: {menu: RequestedMenu}) {
	const hideMenu = useOutlineStore((state) => state.hideMenu);
	const queryClient = useQueryClient();
	const updateNode = useUpdateNode();
	const types = requestedMenuEntries("node_type_picker", menu.cmdContext, menu.qualifiers).flatMap((entry) =>
		entry.kind === "command" ? [entry.cmd] : [],
	);
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
		selectItemType(type, menu.cmdContext.nodeIds, deps);
	};

	return (
		<ItemTypePicker
			onClose={() => {
				hideMenu("node_type_picker");
			}}
			onSelect={handleSelect}
			position={menu.target}
			types={types}
		/>
	);
}

/** Upstream's `jsx_root.menus` (`d54`): renders every menu requested by id, one per id. */
export function MenusHost() {
	const requestedMenus = useOutlineStore((state) => state.requestedMenus);
	const picker = requestedMenus.get("node_type_picker");
	return picker === undefined ? null : <NodeTypePickerMenu menu={picker} />;
}
