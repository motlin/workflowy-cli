import type {MouseEvent} from "react";
import {createPortal} from "react-dom";
import type {InlineAttr} from "../rich-text.js";
import type {FaIconKey} from "./fa-icons.js";
import {FaIcon} from "./fa-icons.js";
import {Flyout} from "./flyout/flyout.js";
import {IconButton} from "./icon-button.js";

export type SelectionToolbarAction =
	| "h1"
	| "h2"
	| "h3"
	| "p"
	| "bold"
	| "underline"
	| "italic"
	| "strikethrough"
	| "code-format"
	| "link"
	| "latest-color"
	| "show-palette";

export interface SelectionToolbarButton {
	key: SelectionToolbarAction;
	icon: FaIconKey;
	iconClassName: string;
	tooltip: string | undefined;
	/** The row layout mode that marks a type button active. */
	layoutMode?: string;
	/** The inline attribute that marks a format button active when it touches the selection. */
	attr?: InlineAttr;
}

/** Upstream's label/shortcut separator: space, four nbsp, space. */
const GAP = "      ";

/** Upstream's toolbar buttons in order; the first four (types) are hidden in a note. */
// oxlint-disable-next-line react/only-export-components -- static button table exported for unit tests
export const selectionToolbarButtons: readonly SelectionToolbarButton[] = [
	{key: "h1", icon: "far:h1", iconClassName: "h1", tooltip: `Heading 1${GAP}⌥⌘1`, layoutMode: "h1"},
	{key: "h2", icon: "far:h2", iconClassName: "h2", tooltip: `Heading 2${GAP}⌥⌘2`, layoutMode: "h2"},
	{key: "h3", icon: "far:h3", iconClassName: "h3", tooltip: `Heading 3${GAP}⌥⌘3`, layoutMode: "h3"},
	{key: "p", icon: "far:paragraph", iconClassName: "paragraph", tooltip: `Paragraph${GAP}⌥⌘4`, layoutMode: "p"},
	{key: "bold", icon: "far:bold", iconClassName: "", tooltip: `Bold${GAP}⌘B`, attr: "b"},
	{key: "underline", icon: "far:underline", iconClassName: "", tooltip: `Underline${GAP}⌘U`, attr: "u"},
	{key: "italic", icon: "far:italic", iconClassName: "", tooltip: `Italic${GAP}⌘I`, attr: "i"},
	{key: "strikethrough", icon: "far:strikethrough", iconClassName: "", tooltip: `Strikethrough${GAP}⇧⌘X`, attr: "s"},
	{key: "code-format", icon: "far:code", iconClassName: "code", tooltip: "Inline Code    ⇧⌘C", attr: "code"},
	{key: "link", icon: "far:link", iconClassName: "", tooltip: `Link${GAP}⌘K`},
	{key: "latest-color", icon: "far:font", iconClassName: "", tooltip: `Text color${GAP}⇧⌘H`},
	{key: "show-palette", icon: "far:chevron-down", iconClassName: "show-palette", tooltip: undefined},
];

const TYPE_BUTTON_COUNT = 4;

/** Upstream places the menu center 55px right of the selection center and 52px above its top, unclamped. */
const X_SHIFT = 55;
const Y_SHIFT = -52;

/** Upstream's safe-area portal host around popup flyouts. */
const HOST_STYLE = {
	overflow: "hidden",
	marginTop: "var(--safe-area-inset-top)",
	marginBottom: "var(--safe-area-inset-bottom)",
} as const;

export interface SelectionToolbarProps {
	/** The selection's bounding rect in page coordinates. */
	rect: {x: number; y: number; width: number};
	/** The selection is in a note: the type buttons are hidden. */
	inNote: boolean;
	/** Inline attributes touching the selection. */
	activeAttrs: ReadonlySet<InlineAttr>;
	/** The row's layout mode, or null for bullets. */
	layoutMode: string | null | undefined;
	/** The last text color class used, shown on the font button. */
	lastColorClass?: string;
	onAction: (action: SelectionToolbarAction) => void;
}

function isActive(button: SelectionToolbarButton, props: SelectionToolbarProps): boolean {
	if (button.layoutMode !== undefined) {
		return props.layoutMode === button.layoutMode;
	}
	return button.attr !== undefined && props.activeAttrs.has(button.attr);
}

function iconClassName(button: SelectionToolbarButton, lastColorClass: string | undefined): string {
	if (button.key === "latest-color" && lastColorClass !== undefined && lastColorClass !== "") {
		return `${lastColorClass} !p-[3px] rounded-[3px]`;
	}
	return button.iconClassName;
}

/** Upstream's floating text-formatting toolbar shown above a non-collapsed selection. */
export function SelectionToolbar(props: SelectionToolbarProps) {
	const {rect, inNote, lastColorClass, onAction} = props;
	const buttons = inNote ? selectionToolbarButtons.slice(TYPE_BUTTON_COUNT) : selectionToolbarButtons;
	const position = [rect.x + rect.width / 2 + X_SHIFT, rect.y + Y_SHIFT] as const;
	return createPortal(
		<div style={HOST_STYLE}>
			<Flyout position={position} className="ctx-menu" style={{maxWidth: "none", padding: "var(--wf-space-s)"}}>
				<div className="flex">
					{buttons.map((button) => (
						<IconButton
							key={button.key}
							size="md"
							shape="square"
							className={`ctx-menu-item ${isActive(button, props) ? "active" : ""}`}
							tooltip={button.tooltip}
							onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
								// Keep the selection, and keep the press from reaching the row's drag-select through the portal.
								event.preventDefault();
								event.stopPropagation();
							}}
							onClick={(event) => {
								event.stopPropagation();
								onAction(button.key);
							}}
						>
							<FaIcon icon={button.icon} className={iconClassName(button, lastColorClass)} />
						</IconButton>
					))}
				</div>
			</Flyout>
		</div>,
		document.body,
	);
}
