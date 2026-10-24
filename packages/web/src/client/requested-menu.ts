import {assembleFlatForId} from "./app-menu.js";
import type {AssembledEntry} from "./app-menu.js";
import {APP_MENU_CONFIG} from "./app-menu-config.js";
import {pickerItemTypes} from "./item-type-select.js";
import type {ItemType} from "./layout-types.js";

/** The `turn_into_*` command ids upstream's `node_type_picker` menu lists, by local item type key. */
const TURN_INTO_IDS: Record<string, string> = {
	bullet: "turn_into_bullet",
	h1: "turn_into_h1",
	h2: "turn_into_h2",
	h3: "turn_into_h3",
	p: "turn_into_paragraph",
	todo: "turn_into_todo",
	numbered: "turn_into_numbered",
	board: "turn_into_board",
	table: "turn_into_table",
	"quote-block": "turn_into_quote_block",
	"code-block": "turn_into_code_block",
	divider: "turn_into_divider",
};

/**
 * The rows of a menu opened by id (`GuiMenu.showById`): the config's flat assembly, with a command present only
 * when the local app can run it. Only the "Turn into..." picker is requestable today.
 */
export function requestedMenuEntries(
	menuId: string,
	cmdContext: {nodeIds: readonly string[]},
	qualifiers: readonly string[],
): AssembledEntry<ItemType>[] {
	if (menuId !== "node_type_picker") {
		return [];
	}
	const types = pickerItemTypes(cmdContext.nodeIds);
	return assembleFlatForId(
		menuId,
		qualifiers,
		(id) => types.find((type) => TURN_INTO_IDS[type.key] === id) ?? null,
		APP_MENU_CONFIG,
	);
}
