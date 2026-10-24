import {HOME_TARGET} from "@workflowy/shared/types";
import {availableItemTypes} from "./layout-types.js";
import type {ItemType} from "./layout-types.js";

/** What choosing an item type needs from the outline: writes, expansion and the cached tree. */
export interface ItemTypeSelectDeps {
	/** Write `layoutMode` to the node (`"home"` for Home; `"bullets"` removes the stored key). */
	update: (nodeId: string, layoutMode: string) => void;
	/** Expand each of `ids`. */
	expandAll: (ids: readonly string[]) => void;
	childIds: (nodeId: string) => readonly string[];
	layoutMode: (nodeId: string) => string | null;
}

/** The types the picker offers for `nodeIds`: Home is both the root and the main document root. */
export function pickerItemTypes(nodeIds: readonly string[]): ItemType[] {
	const atHome = nodeIds.includes(HOME_TARGET);
	return availableItemTypes({isRoot: atHome, isMainDocumentRoot: atHome, readOnly: false, isTableCell: false});
}

/**
 * Upstream's `turn_into_*` execute: it only touches nodes the type is available for (Home cannot become most
 * types), then sets the type; choosing the current type again keeps it, and Divider never toggles off. Board and
 * Table first expand every child of each node so the columns or rows show.
 */
export function selectItemType(type: ItemType, nodeIds: readonly string[], deps: ItemTypeSelectDeps): void {
	const targets = nodeIds.filter((id) => pickerItemTypes([id]).some((available) => available.key === type.key));
	if (type.layoutModeKey === "divider") {
		for (const id of targets) {
			if (deps.layoutMode(id) !== "divider") {
				deps.update(id, "divider");
			}
		}
		return;
	}
	if (type.layoutModeKey === "board" || type.layoutModeKey === "table") {
		deps.expandAll(targets.flatMap((id) => deps.childIds(id)));
	}
	for (const id of targets) {
		deps.update(id, type.layoutModeKey);
	}
}

/**
 * Upstream's palette/slash `toggle_board` and `toggle_table` on one node: Board always sets `board` (no
 * toggle-off); Table writes `bullets` when the node is already a table. Turning either on expands the children.
 */
export function toggleBoardOrTable(
	command: "toggle_board" | "toggle_table",
	nodeId: string,
	deps: ItemTypeSelectDeps,
): void {
	if (command === "toggle_table" && deps.layoutMode(nodeId) === "table") {
		deps.update(nodeId, "bullets");
		return;
	}
	deps.expandAll(deps.childIds(nodeId));
	deps.update(nodeId, command === "toggle_board" ? "board" : "table");
}
