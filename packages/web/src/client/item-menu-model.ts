/**
 * Pure model of the bullet (item) context menu, matching upstream Workflowy's
 * default `config.item.menu`, plus upstream's palette-only `delete_dates` after "Add date".
 * Unavailable commands are filtered out rather than shown disabled, and separators are
 * cleaned up after filtering.
 */
import type {NodeResponse} from "../node-types.js";
import type {FaIconKey} from "./components/fa-icons.js";

/** A light (`fal:`) FontAwesome icon name from the shared registry. */
export type ItemMenuIcon = FaIconKey extends infer K ? (K extends `fal:${infer N}` ? N : never) : never;

export type ItemMenuKey =
	| "open_in_pane"
	| "complete"
	| "add_note"
	| "add_date"
	| "delete_dates"
	| "present_it"
	| "comment"
	| "move_to"
	| "move_to_today"
	| "move_to_tomorrow"
	| "move_to_next_week"
	| "move_to_date"
	| "upload_file"
	| "mirror_to"
	| "mirror"
	| "detach_mirror"
	| "duplicate"
	| "share"
	| "show_export"
	| "copy_link"
	| "make_template"
	| "delete"
	| "expand_all"
	| "collapse_all"
	| "sort_children_asc"
	| "sort_children_desc";

const ITEM_MENU_SEPARATOR = "---";

type ItemMenuSlot = ItemMenuKey | typeof ITEM_MENU_SEPARATOR;

export const ITEM_MENU_KEYS: readonly ItemMenuSlot[] = [
	"open_in_pane",
	"complete",
	"add_note",
	"add_date",
	"delete_dates",
	"present_it",
	"comment",
	"move_to",
	"move_to_today",
	"move_to_tomorrow",
	"move_to_next_week",
	"move_to_date",
	"upload_file",
	"mirror_to",
	"mirror",
	"detach_mirror",
	"duplicate",
	ITEM_MENU_SEPARATOR,
	"share",
	"show_export",
	"copy_link",
	"make_template",
	ITEM_MENU_SEPARATOR,
	"delete",
	ITEM_MENU_SEPARATOR,
	"expand_all",
	"collapse_all",
	"sort_children_asc",
	"sort_children_desc",
];

interface ItemMenuDef {
	label: string;
	icon: ItemMenuIcon;
	shortcut?: string;
}

const ITEM_MENU_DEFS: Record<ItemMenuKey, ItemMenuDef> = {
	open_in_pane: {label: "Open in Pane", icon: "table-columns"},
	complete: {label: "Complete", icon: "check", shortcut: "⌘↵"},
	add_note: {label: "Add note", icon: "pencil", shortcut: "⇧↵"},
	add_date: {label: "Add date", icon: "calendar-days", shortcut: "!!"},
	delete_dates: {label: "Delete dates", icon: "calendar-days"},
	present_it: {label: "Present", icon: "play", shortcut: "⇧⌘P"},
	comment: {label: "Add comment", icon: "message-lines", shortcut: "⌃M"},
	move_to: {label: "Move To...", icon: "arrow-right-long", shortcut: "⌃⌘M"},
	move_to_today: {label: "Move to Today", icon: "calendar-day"},
	move_to_tomorrow: {label: "Move to Tomorrow", icon: "calendar-circle-plus"},
	move_to_next_week: {label: "Move to Next Week", icon: "calendar-week"},
	move_to_date: {label: "Move to Date...", icon: "calendar-days"},
	upload_file: {label: "Upload file", icon: "file"},
	mirror_to: {label: "Mirror To...", icon: "diamond-turn-right"},
	mirror: {label: "Mirror", icon: "diamond", shortcut: "⇧⌘M"},
	detach_mirror: {label: "Detach Mirror", icon: "xmark"},
	duplicate: {label: "Duplicate", icon: "copy", shortcut: "⇧⌘D"},
	share: {label: "Share", icon: "user-group"},
	show_export: {label: "Export", icon: "file-export"},
	copy_link: {label: "Copy internal link", icon: "link", shortcut: "⇧⌘L"},
	make_template: {label: "Make template", icon: "puzzle-piece"},
	delete: {label: "Delete", icon: "trash-can", shortcut: "⇧⌘⌫"},
	expand_all: {label: "Expand all", icon: "up-right-and-down-left-from-center"},
	collapse_all: {label: "Collapse all", icon: "down-left-and-up-right-to-center"},
	sort_children_asc: {label: "Sort A-Z", icon: "arrow-down-a-z"},
	sort_children_desc: {label: "Sort Z-A", icon: "arrow-down-z-a"},
};

export type ItemMenuEntry =
	| {kind: "item"; key: ItemMenuKey; label: string; icon: ItemMenuIcon; shortcut?: string}
	| {kind: "separator"};

export type ItemMenuNode = Pick<NodeResponse, "completedAt" | "isMirror">;

export interface ItemMenuContext<N extends ItemMenuNode = ItemMenuNode> {
	available(key: ItemMenuKey, node: N): boolean;
	originalNotFound?: boolean;
}

function toEntry(key: ItemMenuKey, node: ItemMenuNode): ItemMenuEntry {
	const {label, icon, shortcut} = ITEM_MENU_DEFS[key];
	const finalLabel = key === "complete" && node.completedAt !== null ? "Uncomplete" : label;
	return shortcut === undefined
		? {kind: "item", key, label: finalLabel, icon}
		: {kind: "item", key, label: finalLabel, icon, shortcut};
}

export function buildItemMenu<N extends ItemMenuNode>(node: N, ctx: ItemMenuContext<N>): ItemMenuEntry[] {
	if (ctx.originalNotFound === true) {
		return [toEntry("delete", node)];
	}
	const entries: ItemMenuEntry[] = [];
	for (const slot of ITEM_MENU_KEYS) {
		if (slot === ITEM_MENU_SEPARATOR) {
			if (entries.length > 0 && entries.at(-1)?.kind !== "separator") {
				entries.push({kind: "separator"});
			}
			continue;
		}
		if (slot === "detach_mirror" && node.isMirror !== true) {
			continue;
		}
		if (ctx.available(slot, node)) {
			entries.push(toEntry(slot, node));
		}
	}
	if (entries.at(-1)?.kind === "separator") {
		entries.pop();
	}
	return entries;
}

/** Commands the local app runs; buildItemMenu hides the rest. */
const LOCAL_ITEM_MENU_KEYS: ReadonlySet<ItemMenuKey> = new Set([
	"complete",
	"add_note",
	"add_date",
	"delete_dates",
	"present_it",
	"duplicate",
	"show_export",
	"copy_link",
	"make_template",
	"delete",
	"expand_all",
	"collapse_all",
	"sort_children_asc",
	"sort_children_desc",
]);

/** The local availability map; Delete dates also needs a date in the name or note. */
export function localItemMenuContext({hasDates}: {hasDates: boolean}): ItemMenuContext {
	return {available: (key) => LOCAL_ITEM_MENU_KEYS.has(key) && (key !== "delete_dates" || hasDates)};
}

/** A node's workflowy.com URL (upstream's internal link), keyed by the last 12 hex digits of its id. */
export function internalLinkUrl(nodeId: string): string {
	return `https://workflowy.com/#/${nodeId.replaceAll("-", "").slice(-12)}`;
}

export function hasFooter(node: Pick<NodeResponse, "modifiedAt">): boolean {
	return node.modifiedAt !== null;
}

/** Upstream's `--item-menu-left`: where the bullet-menu trigger sits, left of the expand arrow. */
export function itemMenuLeft(hasVisibleChildren: boolean, visualDepth: number): string {
	if (!hasVisibleChildren) {
		return "calc(var(--name-left-overhang) - 23px)";
	}
	return visualDepth > 1 ? "calc(var(--name-left-overhang) - 55px)" : "calc(var(--name-left-overhang) - 46px)";
}
