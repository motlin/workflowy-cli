import {useEffect, useState} from "react";
import {hint} from "../keys/hint.js";
import {useOutlineStore} from "../stores/outline.js";

interface HotkeyRow {
	name: string;
	command: string;
	modifier?: (text: string) => string;
}

const paneRange = (text: string): string => `${text}–8`;

/** Upstream's hotkeys panel rows, in upstream order. */
// oxlint-disable-next-line react/only-export-components -- static row table exported for tests
export const HOTKEY_ROWS: readonly HotkeyRow[] = [
	{name: "Zoom in", command: "zoom_in"},
	{name: "Zoom out", command: "zoom_out"},
	{name: "Zoom to Today", command: "navigate_to_today"},
	{name: "Expand", command: "expand"},
	{name: "Collapse", command: "collapse"},
	{name: "Indent", command: "indent"},
	{name: "Outdent", command: "outdent"},
	{name: "Move up", command: "move_up"},
	{name: "Move down", command: "move_down"},
	{name: "Focus next sibling", command: "focus_next_sibling"},
	{name: "Focus previous sibling", command: "focus_prev_sibling"},
	{name: "Complete", command: "complete"},
	{name: "Duplicate", command: "duplicate"},
	{name: "Export", command: "show_export"},
	{name: "Delete", command: "delete"},
	{name: "Search", command: "focus_or_unfocus_search"},
	{name: "Show/hide completed", command: "show_or_hide_completed"},
	{name: "Star page", command: "star_current_item"},
	{name: "Navigate home", command: "navigate_home"},
	{name: "Jump menu", command: "show_switcher"},
	{name: "Bold", command: "toggle_bold"},
	{name: "Italic", command: "toggle_italic"},
	{name: "Underline", command: "toggle_underline"},
	{name: "Strikethrough", command: "toggle_strikethrough"},
	{name: "Code", command: "toggle_code"},
	{name: "Toggle left sidebar", command: "toggle_leftbar"},
	{name: "Toggle this sidebar", command: "toggle_rightbar"},
	{name: "Open or focus pane 1–8", command: "focus_or_open_pane_1", modifier: paneRange},
	{name: "Open in pane 1–8", command: "open_in_pane_1", modifier: paneRange},
	{name: "New pane", command: "new_pane"},
	{name: "Close pane", command: "close_pane"},
	{name: "Copy mirror(s) to paste", command: "mirror"},
	{name: "Jump to previous sibling", command: "navigate_to_prev_item"},
	{name: "Jump to next sibling", command: "navigate_to_next_item"},
	{name: "Heading 1", command: "toggle_h1"},
	{name: "Heading 2", command: "toggle_h2"},
	{name: "Heading 3", command: "toggle_h3"},
	{name: "Paragraph", command: "toggle_paragraph"},
	{name: "Code Block", command: "toggle_code_block"},
	{name: "Quote", command: "toggle_quote_block"},
	{name: "Bullet", command: "toggle_bullet"},
	{name: "To do", command: "toggle_todo"},
	{name: "Number", command: "toggle_numbered"},
	{name: "Mark read", command: "mark_read"},
	{name: "Open/close AI Chat", command: "toggle_ai_chat"},
	{name: "Create AI Node", command: "toggle_ai_item"},
	{name: "Jump to previous unread", command: "previous_unread"},
	{name: "Jump to next unread", command: "next_unread"},
];

function rightBarWidth(): number {
	return Math.max(16, Math.min(Math.max(400, innerWidth / 4), innerWidth - 16));
}

function useRightBarWidth(): number {
	const [width, setWidth] = useState(rightBarWidth);
	useEffect(() => {
		const onResize = (): void => {
			setWidth(rightBarWidth());
		};
		addEventListener("resize", onResize);
		return () => {
			removeEventListener("resize", onResize);
		};
	}, []);
	return width;
}

function HotkeyRowView({name, command, modifier}: HotkeyRow) {
	const chip = hint(command);
	const text = chip === undefined || modifier === undefined ? chip : modifier(chip);
	return (
		<div title={command} className="font-system leading-base py-xs cursor-help">
			<div className="flex items-center">
				<div className="flex-grow">{name}</div>
				<div className="ml-l min-w-[96px] text-right">
					{text && (
						<span className="inline-flex items-center justify-center rounded-xs bg-quaternary px-2xs py-3xs text-[11px] font-medium tracking-[0.02em] text-secondary">
							{text}
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

function HotkeysPanel() {
	return (
		<>
			<div className="pb-ml text-base font-bold">
				<span className="cursor-pointer py-2xs px-ml rounded-[16px] !text-on-color !bg-tint">Hotkeys</span>
			</div>
			{HOTKEY_ROWS.map((row) => (
				<HotkeyRowView key={row.command} {...row} />
			))}
		</>
	);
}

/** Upstream's right bar: a fixed hotkeys panel that collapses to a 16px strip. */
export function RightBar() {
	const show = useOutlineStore((s) => s.showKeyboardShortcuts);
	const collapsed = useOutlineStore((s) => s.rightBarCollapsed);
	const toggleRightBarCollapsed = useOutlineStore((s) => s.toggleRightBarCollapsed);
	const width = useRightBarWidth();

	return (
		<div className="right-bar inline-flex fixed top-3xl right-0" style={{zIndex: 99}}>
			{show && (
				<div
					className={
						"fixed top-3xl right-sal bottom-sal\n        text-xs bg-primary text-secondary transition-transform duration-200 ease-base print:hidden"
					}
					style={{
						width,
						transform: collapsed ? "translateX(calc(100% - var(--wf-space-l)))" : undefined,
						zIndex: 99,
					}}
				>
					<div className="h-full py-xl pl-[calc(var(--wf-space-l)+var(--wf-space-m))] pr-xl box-border overflow-auto">
						<HotkeysPanel />
					</div>
					{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream's strip is a plain div; ⌘/ is the keyboard path */}
					<div
						onClick={toggleRightBarCollapsed}
						className="absolute inset-y-0 left-0 w-[var(--wf-space-l)] px-2xs flex items-center border-l border-solid border-primary text-tertiary bg-primary cursor-pointer hover:bg-quaternary"
					>
						{collapsed ? "←" : "→"}
					</div>
				</div>
			)}
		</div>
	);
}
