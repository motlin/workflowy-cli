/**
 * Registry of item types ("Turn into" targets) cloned from upstream `ITEM_TYPES`,
 * plus the rules that decide which types an item may become and which icon the
 * type-menu header shows for the item's current layout.
 */
export interface ItemType {
	key: string;
	label: string;
	/** Value stored in `metadata.layoutMode` for this type. */
	layoutModeKey: string;
	/** Font Awesome icon name. */
	icon: string;
	/** Keyboard-handbook command that toggles this type, when one exists. */
	handbook?: string;
}

export interface ItemTypeContext {
	isRoot: boolean;
	isMainDocumentRoot: boolean;
	readOnly: boolean;
	isTableCell: boolean;
}

export const ITEM_TYPES: readonly ItemType[] = [
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
];

const MAIN_DOCUMENT_ROOT_EXCLUDED = new Set([
	"h1",
	"h2",
	"h3",
	"p",
	"numbered",
	"table",
	"quote-block",
	"code-block",
	"divider",
]);

const TABLE_CELL_ALLOWED = new Set(["bullets", "todo", "board", "table", "h1", "h2", "h3", "p", "numbered"]);

/** Types an item may be turned into, in menu order. */
export function availableItemTypes(ctx: ItemTypeContext): ItemType[] {
	if (ctx.readOnly) {
		return [];
	}
	return ITEM_TYPES.filter(
		(type) =>
			!(ctx.isRoot && type.layoutModeKey === "todo") &&
			!(ctx.isMainDocumentRoot && MAIN_DOCUMENT_ROOT_EXCLUDED.has(type.layoutModeKey)) &&
			!(ctx.isTableCell && !TABLE_CELL_ALLOWED.has(type.layoutModeKey)),
	);
}

/** Legacy stored values that upstream still reads as a current type. */
const LEGACY_LAYOUT_ALIASES: Record<string, string> = {
	check: "todo",
	paragraph: "p",
	quote: "quote-block",
};

const LEGACY_FMT_TYPES = new Set(["h1", "h2", "h3", "p"]);

/**
 * Icon for the item's current type. A legacy `metadata.fmt` of h1/h2/h3/p wins
 * over `layoutMode`; anything unrecognized shows the bullets icon.
 */
export function currentTypeIcon(layoutMode: string | null | undefined, fmt?: string | null): string {
	const mode = fmt && LEGACY_FMT_TYPES.has(fmt) ? fmt : layoutMode;
	const key = mode ? (LEGACY_LAYOUT_ALIASES[mode] ?? mode) : null;
	return ITEM_TYPES.find((type) => type.layoutModeKey === key)?.icon ?? "list-ul";
}
