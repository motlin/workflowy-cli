import {describe, expect, it} from "vite-plus/test";
import {availableItemTypes, currentTypeIcon, ITEM_TYPES} from "../src/client/layout-types.js";
import type {ItemTypeContext} from "../src/client/layout-types.js";

const NORMAL: ItemTypeContext = {isRoot: false, isMainDocumentRoot: false, readOnly: false, isTableCell: false};

describe("ITEM_TYPES", () => {
	it("lists the upstream turn-into types in menu order", () => {
		expect(ITEM_TYPES).toStrictEqual([
			{key: "bullet", label: "Bullets", layoutModeKey: "bullets", icon: "list-ul", handbook: "toggle_bullet"},
			{key: "h1", label: "Heading 1", layoutModeKey: "h1", icon: "h1", handbook: "toggle_h1"},
			{key: "h2", label: "Heading 2", layoutModeKey: "h2", icon: "h2", handbook: "toggle_h2"},
			{key: "h3", label: "Heading 3", layoutModeKey: "h3", icon: "h3", handbook: "toggle_h3"},
			{key: "p", label: "Paragraph", layoutModeKey: "p", icon: "paragraph", handbook: "toggle_paragraph"},
			{key: "todo", label: "To-do", layoutModeKey: "todo", icon: "list-check", handbook: "toggle_todo"},
			{key: "numbered", label: "Number", layoutModeKey: "numbered", icon: "list-ol"},
			{key: "board", label: "Board", layoutModeKey: "board", icon: "columns-3", handbook: "toggle_board"},
			{key: "table", label: "Table", layoutModeKey: "table", icon: "table-cells"},
			{key: "quote-block", label: "Quote", layoutModeKey: "quote-block", icon: "block-quote"},
			{key: "code-block", label: "Code Block", layoutModeKey: "code-block", icon: "rectangle-code"},
			{key: "divider", label: "Divider", layoutModeKey: "divider", icon: "horizontal-rule"},
		]);
	});
});

describe("availableItemTypes", () => {
	const labels = (ctx: ItemTypeContext): string[] => availableItemTypes(ctx).map((type) => type.label);

	it("offers only Bullets and Board on Home", () => {
		expect(labels({isRoot: true, isMainDocumentRoot: true, readOnly: false, isTableCell: false})).toStrictEqual([
			"Bullets",
			"Board",
		]);
	});

	it("drops To-do on a zoomed root", () => {
		expect(labels({...NORMAL, isRoot: true})).toStrictEqual([
			"Bullets",
			"Heading 1",
			"Heading 2",
			"Heading 3",
			"Paragraph",
			"Number",
			"Board",
			"Table",
			"Quote",
			"Code Block",
			"Divider",
		]);
	});

	it("offers all twelve types on a normal item", () => {
		expect(labels(NORMAL)).toStrictEqual([
			"Bullets",
			"Heading 1",
			"Heading 2",
			"Heading 3",
			"Paragraph",
			"To-do",
			"Number",
			"Board",
			"Table",
			"Quote",
			"Code Block",
			"Divider",
		]);
	});

	it("offers nine types in a table cell", () => {
		expect(labels({...NORMAL, isTableCell: true})).toStrictEqual([
			"Bullets",
			"Heading 1",
			"Heading 2",
			"Heading 3",
			"Paragraph",
			"To-do",
			"Number",
			"Board",
			"Table",
		]);
	});

	it("offers nothing when read-only", () => {
		expect(labels({...NORMAL, readOnly: true})).toStrictEqual([]);
	});
});

describe("currentTypeIcon", () => {
	it("maps each layout mode to its type icon", () => {
		expect(
			[null, undefined, "bullets", "h2", "todo", "numbered", "board", "code-block", "divider", "unknown"].map(
				(mode) => currentTypeIcon(mode),
			),
		).toStrictEqual([
			"list-ul",
			"list-ul",
			"list-ul",
			"h2",
			"list-check",
			"list-ol",
			"columns-3",
			"rectangle-code",
			"horizontal-rule",
			"list-ul",
		]);
	});

	it("reads legacy check, paragraph and quote values", () => {
		expect(["check", "paragraph", "quote"].map((mode) => currentTypeIcon(mode))).toStrictEqual([
			"list-check",
			"paragraph",
			"block-quote",
		]);
	});

	it("lets legacy metadata.fmt h1/h2/h3/p win over layoutMode", () => {
		expect(["h1", "h3", "p", null].map((fmt) => currentTypeIcon("bullets", fmt))).toStrictEqual([
			"h1",
			"h3",
			"paragraph",
			"list-ul",
		]);
	});
});
