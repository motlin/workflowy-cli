import {afterAll, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import type {ReactNode, ReactPortal} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type {NodeResponse} from "../src/node-types.js";
import type {ItemMenuActions} from "../src/client/components/node-context-menu.js";

vi.mock(import("react-dom"), async (importOriginal) => ({
	...(await importOriginal()),
	createPortal: (node: ReactNode): ReactPortal => node as ReactPortal,
}));
const showItemTypePicker = vi.fn<(picker: {nodeIds: string[]; position: {top: number; left: number}}) => void>();
vi.mock("../src/client/stores/outline.js", () => ({useOutlineStore: {getState: () => ({showItemTypePicker})}}));
vi.stubGlobal("document", {body: {}});

const {ItemMenuTrigger, TurnIntoRow} = await import("../src/client/components/node-context-menu.js");
const NOOP_ACTIONS: ItemMenuActions = {
	onComplete: () => {},
	onAddNote: () => {},
	onAddDate: () => {},
	onDeleteDates: () => {},
	onPresent: () => {},
	onDuplicate: () => {},
	onExport: () => {},
	onCopyLink: () => {},
	onMakeTemplate: () => {},
	onDelete: () => {},
	onExpandAll: () => {},
	onCollapseAll: () => {},
	onSort: () => {},
};

function localSeconds(year: number, month: number, day: number, hour: number, minute: number): number {
	return new Date(year, month - 1, day, hour, minute).getTime() / 1000;
}

const node: NodeResponse = {
	id: "alice",
	parent_id: null,
	name: "Alice",
	note: null,
	priority: 0,
	data: {layoutMode: null},
	createdAt: localSeconds(2026, 10, 1, 9, 13),
	modifiedAt: localSeconds(2026, 10, 1, 9, 13),
	completedAt: null,
};

function render(target: NodeResponse): string {
	return renderToStaticMarkup(
		createElement(ItemMenuTrigger, {
			node: target,
			expanded: true,
			actions: NOOP_ACTIONS,
			onOpenChange: () => {},
		}),
	);
}

/** Splits an HTML fragment into its top-level elements. */
function topLevelElements(html: string): string[] {
	const elements: string[] = [];
	const tagPattern = /<(\/?)([a-z]+)[^>]*?(\/?)>/gu;
	let depth = 0;
	let start = 0;
	for (const match of html.matchAll(tagPattern)) {
		const [, closing, , selfClosing] = match;
		if (closing === "/") {
			depth--;
			if (depth === 0) {
				elements.push(html.slice(start, match.index + match[0].length));
			}
		} else if (selfClosing !== "/") {
			if (depth === 0) {
				start = match.index;
			}
			depth++;
		}
	}
	return elements;
}

function scrollerChildren(html: string): string[] {
	const open = /<div style="--menu-max-h:[^"]*" class="[^"]*scroller[^"]*">/u.exec(html);
	if (!open) {
		throw new Error(`No scroller in ${html}`);
	}
	const rest = html.slice(open.index + open[0].length);
	return topLevelElements(rest.slice(0, rest.lastIndexOf("</div></div></div>")));
}

function classTokens(element: string): string[] {
	const match = /^<[a-z]+[^>]*? class="([^"]*)"/u.exec(element);
	return match ? match[1].split(/\s+/u).filter(Boolean) : [];
}

const ITEM_TOKENS = [
	"pl-l",
	"py-xs",
	"pr-l",
	"block",
	"!no-underline",
	"cursor-pointer",
	"whitespace-nowrap",
	"leading-base",
	"border-solid",
	"border-primary",
	"text-primary",
	"hover:bg-secondary",
	"mobile:border-t",
	"mobile:last:border-b",
	"mobile:py-ml",
	"mobile:landscape:pl-safe-left",
	"mobile:landscape:pr-safe-right",
	"menuItem",
	"menuItem",
	"canHover",
];
const TURN_INTO_TOKENS = [
	"item-type-picker",
	"flex",
	"justify-between",
	"items-center",
	"px-l",
	"py-xs",
	"mobile:py-ml",
	"leading-base",
	"hover:bg-secondary",
	"mobile:landscape:pl-safe-left",
	"mobile:landscape:pr-safe-right",
	"cursor-pointer",
	"desktop:text-xs",
];
const SEPARATOR_TOKENS = ["border-t", "border-primary", "border-solid", "my-s"];
const FOOTER_TOKENS = [
	"flex",
	"flex-col",
	"gap-m",
	"text-tertiary",
	"text-xs",
	"px-l",
	"pt-s",
	"pb-ml",
	"whitespace-nowrap",
	"mobile:text-base",
	"mobile:py-ml",
	"mobile:landscape:pl-safe-left",
	"mobile:landscape:pr-safe-right",
];

describe("item menu surface", () => {
	beforeAll(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 9, 1, 10, 5));
	});
	afterAll(() => {
		vi.useRealTimers();
	});

	it("places the flyout bottom-start with upstream's 300px max width", () => {
		const flyout = /<div class="wf-menu[^"]*flyout menu"([^>]*)>/u.exec(render(node));
		expect(flyout?.[1]).toBe(
			' data-popper-reference-hidden="false" data-popper-escaped="false" data-popper-placement="bottom-start" style="position:absolute;inset:0px auto auto 0px;pointer-events:auto;z-index:1001;min-width:0;max-width:300px;margin-top:4px;padding:5px;transform:translate3d(0px, 0px, 0px)"',
		);
	});

	it("renders the available rows, separators and footer as scroller children", () => {
		const children = scrollerChildren(render(node));
		expect(children.map((child) => classTokens(child))).toStrictEqual([
			TURN_INTO_TOKENS,
			SEPARATOR_TOKENS,
			ITEM_TOKENS,
			ITEM_TOKENS,
			ITEM_TOKENS,
			ITEM_TOKENS,
			ITEM_TOKENS,
			SEPARATOR_TOKENS,
			ITEM_TOKENS,
			ITEM_TOKENS,
			ITEM_TOKENS,
			SEPARATOR_TOKENS,
			ITEM_TOKENS,
			SEPARATOR_TOKENS,
			ITEM_TOKENS,
			ITEM_TOKENS,
			ITEM_TOKENS,
			ITEM_TOKENS,
			SEPARATOR_TOKENS,
			FOOTER_TOKENS,
		]);
		expect(children.map((child) => /data-handbook="([^"]*)"/u.exec(child)?.[1] ?? null)).toStrictEqual([
			"bullet.layout",
			null,
			"complete",
			"add_note",
			"add_date",
			"present_it",
			"duplicate",
			null,
			"show_export",
			"copy_link",
			"make_template",
			null,
			"delete",
			null,
			"expand_all",
			"collapse_all",
			"sort_children_asc",
			"sort_children_desc",
			null,
			null,
		]);
	});

	it("renders the Complete row with its icon, label and shortcut", () => {
		const complete = scrollerChildren(render(node))[2];
		expect(complete).toMatch(
			/<div class="menuItemIcon flex items-center text-secondary"><svg [^>]*data-icon="check"[^>]*><path [^>]*><\/path><\/svg><\/div>Complete<\/span><span class="text ml-l min-w-\[22px\] text-xs text-tertiary">⌘↵<\/span><\/span><\/a>$/u,
		);
	});

	it("renders the Add note row with its pencil icon, label and shortcut", () => {
		const addNote = scrollerChildren(render(node))[3];
		expect(addNote).toMatch(
			/<div class="menuItemIcon flex items-center text-secondary"><svg [^>]*data-icon="pencil"[^>]*><path [^>]*><\/path><\/svg><\/div>Add note<\/span><span class="text ml-l min-w-\[22px\] text-xs text-tertiary">⇧↵<\/span><\/span><\/a>$/u,
		);
	});

	it("renders the Add date row with its calendar icon and !! shortcut", () => {
		const addDate = scrollerChildren(render(node))[4];
		expect(addDate).toMatch(
			/<div class="menuItemIcon flex items-center text-secondary"><svg [^>]*data-icon="calendar-days"[^>]*><path [^>]*><\/path><\/svg><\/div>Add date<\/span><span class="text ml-l min-w-\[22px\] text-xs text-tertiary">!!<\/span><\/span><\/a>$/u,
		);
	});

	it("offers Delete dates only when the name or note holds a date", () => {
		const labels = (target: NodeResponse) =>
			scrollerChildren(render(target))
				.map((child) => /data-handbook="([^"]*)"/u.exec(child)?.[1] ?? null)
				.slice(2, 6);
		expect({
			plain: labels(node),
			datedName: labels({...node, name: 'Alice <time startYear="2026" startMonth="10" startDay="1">x</time>'}),
			datedNote: labels({...node, note: '<time startYear="2026" startMonth="10" startDay="1">x</time>'}),
		}).toStrictEqual({
			plain: ["complete", "add_note", "add_date", "present_it"],
			datedName: ["complete", "add_note", "add_date", "delete_dates"],
			datedNote: ["complete", "add_note", "add_date", "delete_dates"],
		});
	});

	it("renders Delete in the plain text color", () => {
		const del = scrollerChildren(render(node))[12];
		expect(del).toContain('data-handbook="delete"');
		expect(classTokens(del)).toStrictEqual(ITEM_TOKENS);
		expect(del).not.toContain("danger");
	});

	it("renders the Changed / Created footer in upstream's format", () => {
		const footer = scrollerChildren(render(node)).at(-1);
		expect(footer?.replace(/^<div[^>]*>/u, "")).toBe(
			'<div class="flex flex-col gap-s"><div><b>Changed:</b> Today at 09:13</div></div><div class="flex flex-col gap-s"><div><b>Created:</b> Today at 09:13</div></div></div>',
		);
	});

	it("labels Complete as Uncomplete for a completed node and drops the footer without modifiedAt", () => {
		const children = scrollerChildren(render({...node, completedAt: 1, modifiedAt: null})).slice(2);
		expect(children.map((child) => /<\/div>([^<]+)<\/span>/u.exec(child)?.[1] ?? null)).toStrictEqual([
			"Uncomplete",
			"Add note",
			"Add date",
			"Present",
			"Duplicate",
			null,
			"Export",
			"Copy internal link",
			"Make template",
			null,
			"Delete",
			null,
			"Expand all",
			"Collapse all",
			"Sort A-Z",
			"Sort Z-A",
		]);
	});

	it("renders upstream's Turn into row first: arrows-cross icon, label, chevron-down at the end", () => {
		const row = scrollerChildren(render(node))[0];
		expect(row.replaceAll(/<svg [^>]*data-icon="([^"]*)"[^>]*>.*?<\/svg>/gu, "<icon $1/>")).toBe(
			'<div data-handbook="bullet.layout" data-handbook-placement="right" class="item-type-picker flex justify-between items-center px-l py-xs mobile:py-ml leading-base hover:bg-secondary mobile:landscape:pl-safe-left mobile:landscape:pr-safe-right cursor-pointer desktop:text-xs"><div class="row-start flex gap-m items-center"><icon arrows-cross/><p>Turn into…</p></div><div class="row-end"><icon chevron-down/></div></div>',
		);
	});

	it("closes the menu on click, then opens the shared picker at the click's page coordinates", () => {
		const onClose = vi.fn<() => void>();
		const preventDefault = vi.fn<() => void>();
		const row = TurnIntoRow({nodeId: "alice", onClose});
		row.props.onMouseDown({preventDefault});
		row.props.onClick({pageX: 42, pageY: 56});
		const beforeTimer = {onClose: onClose.mock.calls.length, picker: showItemTypePicker.mock.calls.length};
		vi.runAllTimers();
		expect({
			preventDefault: preventDefault.mock.calls.length,
			beforeTimer,
			picker: showItemTypePicker.mock.calls,
		}).toStrictEqual({
			preventDefault: 1,
			beforeTimer: {onClose: 1, picker: 0},
			picker: [[{nodeIds: ["alice"], position: {top: 56, left: 42}}]],
		});
	});
});
