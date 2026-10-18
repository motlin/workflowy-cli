import {describe, expect, it} from "vite-plus/test";
import {buildItemMenu, hasFooter, ITEM_MENU_KEYS} from "../src/client/item-menu-model.js";
import type {ItemMenuEntry, ItemMenuKey, ItemMenuNode} from "../src/client/item-menu-model.js";

const plain: ItemMenuNode = {completedAt: null, isMirror: false};
const everything = {available: (): boolean => true};

function only(...keys: ItemMenuKey[]) {
	return {available: (key: ItemMenuKey): boolean => keys.includes(key)};
}

function summarize(entries: ItemMenuEntry[]): string {
	return entries
		.map((entry) => (entry.kind === "separator" ? "|" : entry.label))
		.join(";")
		.replaceAll(";|;", "|");
}

describe("ITEM_MENU_KEYS", () => {
	it("lists every key in upstream order with separators", () => {
		expect(ITEM_MENU_KEYS).toStrictEqual([
			"open_in_pane",
			"complete",
			"add_note",
			"add_date",
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
			"---",
			"share",
			"show_export",
			"copy_link",
			"make_template",
			"---",
			"delete",
			"---",
			"expand_all",
			"collapse_all",
			"sort_children_asc",
			"sort_children_desc",
		]);
	});
});

describe("buildItemMenu", () => {
	it("renders the full upstream list for a non-mirror node with everything available", () => {
		expect(summarize(buildItemMenu(plain, everything))).toBe(
			"Open in Pane;Complete;Add note;Add date;Present;Add comment;Move To...;Move to Today;Move to Tomorrow;Move to Next Week;Move to Date...;Upload file;Mirror To...;Mirror;Duplicate|Share;Export;Copy internal link;Make template|Delete|Expand all;Collapse all;Sort A-Z;Sort Z-A",
		);
	});

	it("offers Detach Mirror only for a mirror root", () => {
		const labels = buildItemMenu({completedAt: null, isMirror: true}, everything).map((entry) =>
			entry.kind === "item" ? entry.label : "|",
		);
		expect(labels.slice(13, 16)).toStrictEqual(["Mirror", "Detach Mirror", "Duplicate"]);
	});

	it("drops leading, trailing and doubled separators after filtering", () => {
		expect(summarize(buildItemMenu(plain, only("delete", "expand_all")))).toBe("Delete|Expand all");
		expect(summarize(buildItemMenu(plain, only("share", "expand_all")))).toBe("Share|Expand all");
		expect(buildItemMenu(plain, only("delete"))).toStrictEqual([
			{kind: "item", key: "delete", label: "Delete", icon: "trash-can", shortcut: "⇧⌘⌫"},
		]);
		expect(buildItemMenu(plain, only())).toStrictEqual([]);
	});

	it("passes the node to the availability check", () => {
		const seen: ItemMenuNode[] = [];
		buildItemMenu(plain, {
			available: (_key, node) => {
				seen.push(node);
				return false;
			},
		});
		expect(seen.every((node) => node === plain)).toBe(true);
		expect(seen).toHaveLength(24);
	});

	it("labels complete as Uncomplete for a completed node", () => {
		expect(buildItemMenu({completedAt: 1_700_000_000, isMirror: false}, only("complete"))).toStrictEqual([
			{kind: "item", key: "complete", label: "Uncomplete", icon: "check", shortcut: "⌘↵"},
		]);
	});

	it("reduces the list to delete when the original is not found", () => {
		expect(buildItemMenu(plain, {...everything, originalNotFound: true})).toStrictEqual([
			{kind: "item", key: "delete", label: "Delete", icon: "trash-can", shortcut: "⇧⌘⌫"},
		]);
	});

	it("uses the upstream shortcuts", () => {
		const shortcuts = Object.fromEntries(
			buildItemMenu({completedAt: null, isMirror: true}, everything).flatMap((entry) =>
				entry.kind === "item" && entry.shortcut !== undefined ? [[entry.key, entry.shortcut]] : [],
			),
		);
		expect(shortcuts).toStrictEqual({
			complete: "⌘↵",
			add_note: "⇧↵",
			add_date: "!!",
			present_it: "⇧⌘P",
			comment: "⌃M",
			move_to: "⌃⌘M",
			mirror: "⇧⌘M",
			duplicate: "⇧⌘D",
			copy_link: "⇧⌘L",
			delete: "⇧⌘⌫",
		});
	});

	it("uses the upstream FA light icon names", () => {
		const icons = Object.fromEntries(
			buildItemMenu({completedAt: null, isMirror: true}, everything).flatMap((entry) =>
				entry.kind === "item" ? [[entry.key, entry.icon]] : [],
			),
		);
		expect(icons).toStrictEqual({
			open_in_pane: "table-columns",
			complete: "check",
			add_note: "pencil",
			add_date: "calendar-days",
			present_it: "play",
			comment: "message-lines",
			move_to: "arrow-right-long",
			move_to_today: "calendar-day",
			move_to_tomorrow: "calendar-circle-plus",
			move_to_next_week: "calendar-week",
			move_to_date: "calendar-days",
			upload_file: "file",
			mirror_to: "diamond-turn-right",
			mirror: "diamond",
			detach_mirror: "xmark",
			duplicate: "copy",
			share: "user-group",
			show_export: "file-export",
			copy_link: "link",
			make_template: "puzzle-piece",
			delete: "trash-can",
			expand_all: "up-right-and-down-left-from-center",
			collapse_all: "down-left-and-up-right-to-center",
			sort_children_asc: "arrow-down-a-z",
			sort_children_desc: "arrow-down-z-a",
		});
	});
});

describe("hasFooter", () => {
	it("shows the footer only when the node has a modified time", () => {
		expect(hasFooter({modifiedAt: null})).toBe(false);
		expect(hasFooter({modifiedAt: 1_700_000_000})).toBe(true);
	});
});
