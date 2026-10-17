import {describe, expect, it, vi} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {cssBlock, cssBlockText} from "./helpers/css-block.js";

const storeState = {
	zoomedNodeId: "alice",
	toggleLeftSidebar: () => {},
	toggleSearchPanel: () => {},
	openSearchWithQuery: () => {},
	toggleCompleted: () => {},
	showCompleted: false,
	openSettings: () => {},
	toggleStarPage: () => {},
	isPageStarred: () => false,
	openPresentation: () => {},
	expandAll: () => {},
	collapseAll: () => {},
};

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (selector?: (state: typeof storeState) => unknown) =>
		selector === undefined ? storeState : selector(storeState),
}));
vi.mock("react-router-dom", () => ({useNavigate: () => () => {}}));
const navState = {canGoBack: false, canGoForward: false};

vi.mock("../src/client/hooks/use-navigation-history.js", () => ({
	useNavigationHistory: () => navState,
}));
vi.mock("../src/client/hooks/use-flattened-tree.js", () => ({
	useFlattenedTree: () => ({flattenedNodes: []}),
}));
vi.mock("../src/client/hooks/use-nodes.js", () => ({useUpdateNode: () => ({mutate: () => {}})}));
vi.mock("../src/client/components/breadcrumbs.js", () => ({
	Breadcrumbs: () => createElement("div", {className: "breadcrumbs-mock"}),
}));
vi.mock("../src/client/components/gear-menu.js", () => ({GearMenu: () => null}));
vi.mock("../src/client/components/layout-menu.js", () => ({LayoutMenu: () => null}));

const {TopBar} = await import("../src/client/components/top-bar.js");

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");

function hasSelector(css: string, pattern: RegExp): boolean {
	const preludes = css.replaceAll(/\/\*[\s\S]*?\*\//gu, "").match(/[^{}]+(?=\{)/gu) ?? [];
	return preludes.some((prelude) => pattern.test(prelude));
}

const VOID_TAGS = new Set(["input", "img", "br", "hr"]);

/** Class attributes of the root element's direct children. */
function rootChildClasses(html: string): string[] {
	const classes: string[] = [];
	let depth = 0;
	for (const match of html.matchAll(/<(\/?)([a-z]+)([^>]*?)(\/?)>/gu)) {
		const [, closing, tag, attributes, selfClosing] = match;
		if (closing === "/") {
			depth--;
			continue;
		}
		if (depth === 1) {
			classes.push(/class="([^"]*)"/u.exec(attributes)?.[1] ?? "");
		}
		if (selfClosing !== "/" && !VOID_TAGS.has(tag)) {
			depth++;
		}
	}
	return classes;
}

describe("TopBar markup", () => {
	const html = renderToStaticMarkup(createElement(TopBar));

	it("renders upstream's wf-header root", () => {
		expect(html.slice(0, html.indexOf(">") + 1)).toBe(
			'<div class="wf-header header bg-primary border-b border-solid border-primary" style="left:0;z-index:200">',
		);
	});

	it("renders upstream's flat child order", () => {
		expect(rootChildClasses(html)).toStrictEqual([
			"",
			"pagination",
			"breadcrumbs-mock",
			"ml-auto flex self-stretch items-center gap-xs flex-shrink-0",
		]);
	});
});

function renderWithNav(canGoBack: boolean, canGoForward: boolean): string {
	navState.canGoBack = canGoBack;
	navState.canGoForward = canGoForward;
	return renderToStaticMarkup(createElement(TopBar));
}

/** Inner HTML of the `.pagination` element with svg path data stripped. */
function paginationInner(html: string): string {
	const start = html.indexOf('<div class="pagination">') + '<div class="pagination">'.length;
	const end = html.indexOf('<div class="breadcrumbs-mock">');
	return html
		.slice(start, end)
		.replace(/<\/div>$/u, "")
		.replaceAll(/ d="[^"]*"/gu, "");
}

function svg(name: string, width: number): string {
	return `<svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="${name}" class="svg-inline--fa fa-${name} fa-1x " role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 512"><path fill="currentColor"></path></svg>`;
}

describe("TopBar left controls", () => {
	it("renders a disabled Back and no Forward on an empty stack", () => {
		expect(paginationInner(renderWithNav(false, false))).toBe(
			`<div role="button" tabindex="-1" aria-disabled="true" data-handbook="nav.back" class="iconButton lg shape-circle disabled">${svg("chevron-left", 320)}</div>`,
		);
	});

	it("renders enabled Back and a sm:flex Forward when both stacks are non-empty", () => {
		expect(paginationInner(renderWithNav(true, true))).toBe(
			`<div role="button" tabindex="0" data-handbook="nav.back" class="iconButton lg shape-circle">${svg("chevron-left", 320)}</div>` +
				`<div role="button" tabindex="0" data-handbook="nav.forward" class="sm:flex hidden iconButton lg shape-circle">${svg("chevron-right", 320)}</div>`,
		);
	});

	it("renders the hamburger as a toggle_leftbar IconButton without a tooltip", () => {
		const html = renderWithNav(false, false);
		const wrapper = html.slice(html.indexOf(">") + 1, html.indexOf('<div class="pagination">'));
		expect(wrapper.replaceAll(/ d="[^"]*"/gu, "")).toBe(
			`<div style="position:relative"><div role="button" tabindex="0" data-handbook="toggle_leftbar" class="iconButton lg shape-circle">${svg("bars", 448)}</div></div>`,
		);
	});
});

describe("header CSS", () => {
	it("ports upstream's .header rule plus content-box sizing", () => {
		expect(cssBlock(styles, ".header")).toStrictEqual({
			position: "fixed",
			top: "0",
			right: "0",
			height: "var(--wf-header-height)",
			display: "flex",
			"min-width": "320px",
			padding: "0 var(--wf-space-m) 0 var(--wf-space-s)",
			"align-items": "center",
			"user-select": "none",
			color: "var(--wf-text-primary) !important",
			"box-sizing": "content-box",
		});
	});

	it("ports upstream's pagination and text color rules", () => {
		expect(cssBlock(styles, ".header .pagination")).toStrictEqual({display: "flex", "flex-direction": "row"});
		expect(
			cssBlock(styles, ".header :is(.iconButton), .header :is(.breadcrumbs), .header :is(.breadcrumb-item)"),
		).toStrictEqual({color: "var(--wf-text-primary) !important"});
	});

	it("hides the header when printing", () => {
		expect(cssBlockText(styles, "@media print").replaceAll(/\s+/gu, "")).toBe(".header{display:none!important;}");
	});

	it("drops the old top-bar layout rules and retargets the offline-banner override", () => {
		expect(hasSelector(styles, /\.top-bar(-left|-right|-nav-buttons)?\s*[{,]/u)).toBe(false);
		expect(cssBlock(styles, ".outline-container:has(.offline-banner) .wf-header")).toStrictEqual({top: "40px"});
	});
});
