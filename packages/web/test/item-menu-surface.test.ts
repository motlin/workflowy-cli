import {afterAll, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import type {ReactNode, ReactPortal} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type {NodeResponse} from "../src/node-types.js";

vi.mock(import("react-dom"), async (importOriginal) => ({
	...(await importOriginal()),
	createPortal: (node: ReactNode): ReactPortal => node as ReactPortal,
}));
vi.mock("../src/client/stores/outline.js", () => ({useOutlineStore: {getState: () => ({})}}));
vi.stubGlobal("document", {body: {}});

const {ItemMenuTrigger} = await import("../src/client/components/node-context-menu.js");

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
			onCollapseAll: () => {},
			onComplete: () => {},
			onDelete: () => {},
			onExpandAll: () => {},
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
			ITEM_TOKENS,
			SEPARATOR_TOKENS,
			ITEM_TOKENS,
			SEPARATOR_TOKENS,
			ITEM_TOKENS,
			ITEM_TOKENS,
			SEPARATOR_TOKENS,
			FOOTER_TOKENS,
		]);
		expect(children.map((child) => /data-handbook="([^"]*)"/u.exec(child)?.[1] ?? null)).toStrictEqual([
			"complete",
			null,
			"delete",
			null,
			"expand_all",
			"collapse_all",
			null,
			null,
		]);
	});

	it("renders the Complete row with its icon, label and shortcut", () => {
		const complete = scrollerChildren(render(node))[0];
		expect(complete).toMatch(
			/<div class="menuItemIcon flex items-center text-secondary"><svg [^>]*data-icon="check"[^>]*><path [^>]*><\/path><\/svg><\/div>Complete<\/span><span class="text ml-l min-w-\[22px\] text-xs text-tertiary">⌘↵<\/span><\/span><\/a>$/u,
		);
	});

	it("renders Delete in the plain text color", () => {
		const del = scrollerChildren(render(node))[2];
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
		const children = scrollerChildren(render({...node, completedAt: 1, modifiedAt: null}));
		expect(children.map((child) => /<\/div>([^<]+)<\/span>/u.exec(child)?.[1] ?? null)).toStrictEqual([
			"Uncomplete",
			null,
			"Delete",
			null,
			"Expand all",
			"Collapse all",
		]);
	});
});
