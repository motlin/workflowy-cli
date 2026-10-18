import {describe, expect, it, vi} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type * as IconButtonModule from "../src/client/components/icon-button.js";
import {cssBlock, cssBlockText} from "./helpers/css-block.js";

const storeState: {zoomedNodeId: string | null} & Record<string, unknown> = {
	zoomedNodeId: "alice",
	toggleLeftBar: () => {},
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
	leftBarOffset: () => 0,
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
const nodeState = {hasChildren: true, rootChildren: [{id: "r1"}]};

vi.mock("../src/client/hooks/use-nodes.js", () => ({
	useUpdateNode: () => ({mutate: () => {}}),
	useNode: (nodeId: string | null) => ({
		data: nodeId === null ? undefined : {id: nodeId, hasChildren: nodeState.hasChildren},
	}),
	useChildren: () => ({data: nodeState.rootChildren}),
}));
vi.mock("../src/client/components/breadcrumbs.js", () => ({
	Breadcrumbs: () => createElement("div", {className: "breadcrumbs-mock"}),
}));
vi.mock("../src/client/components/gear-menu.js", () => ({GearMenu: () => null}));
vi.mock("../src/client/components/layout-menu.js", () => ({LayoutMenu: () => null}));

/** Props of every IconButton rendered, keyed by data-handbook. */
type IconButtonProps = Parameters<typeof IconButtonModule.IconButton>[0];

const iconButtonProps = new Map<string, IconButtonProps>();

vi.mock("../src/client/components/icon-button.js", async (importOriginal) => {
	const actual = await importOriginal<typeof IconButtonModule>();
	return {
		...actual,
		IconButton: (props: IconButtonProps) => {
			const handbook = props["data-handbook"];
			if (handbook !== undefined) {
				iconButtonProps.set(handbook, props);
			}
			if (props.tooltip === "Share") {
				iconButtonProps.set("share", props);
			}
			return actual.IconButton(props);
		},
	};
});

const {TopBar, shareUrl} = await import("../src/client/components/top-bar.js");

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

	it("offsets the header by the pinned left bar width", () => {
		storeState.leftBarOffset = () => 296;
		const pinned = renderToStaticMarkup(createElement(TopBar));
		storeState.leftBarOffset = () => 0;
		expect(pinned.slice(0, pinned.indexOf(">") + 1)).toBe(
			'<div class="wf-header header bg-primary border-b border-solid border-primary" style="left:296px;z-index:200">',
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

/** Inner HTML of the right cluster. */
function clusterHtml(html: string): string {
	const marker = '<div class="ml-auto flex self-stretch items-center gap-xs flex-shrink-0">';
	return html.slice(html.indexOf(marker) + marker.length);
}

/** Ordered identifiers of the right-cluster controls. */
function clusterSequence(html: string): string[] {
	const tokens = clusterHtml(html).matchAll(
		/top-bar-search-box|fa-calendar-day|fa-user-plus|data-handbook="([^"]+)"|class="[^"]*\bgearMenu\b/gu,
	);
	return [...tokens].map((match) => {
		if (match[0].startsWith("data-handbook")) {
			return match[1];
		}
		if (match[0] === "top-bar-search-box") {
			return "search";
		}
		if (match[0] === "fa-user-plus") {
			return "share";
		}
		return match[0] === "fa-calendar-day" ? "today" : "gearMenu";
	});
}

function renderCluster(zoomedNodeId: string | null, hasChildren: boolean, rootChildren: {id: string}[]): string {
	storeState.zoomedNodeId = zoomedNodeId;
	nodeState.hasChildren = hasChildren;
	nodeState.rootChildren = rootChildren;
	const html = renderToStaticMarkup(createElement(TopBar));
	storeState.zoomedNodeId = "alice";
	nodeState.hasChildren = true;
	nodeState.rootChildren = [{id: "r1"}];
	return html;
}

describe("TopBar right cluster", () => {
	it("orders the zoomed controls like upstream", () => {
		expect(clusterSequence(renderCluster("alice", true, []))).toStrictEqual([
			"search",
			"today",
			"share",
			"present_it",
			"starring.star",
			"complete.toggle",
			"bullet.layout",
			"gearMenu",
		]);
	});

	it("drops the star at root and keeps Present when root has children", () => {
		expect(clusterSequence(renderCluster(null, false, [{id: "r1"}]))).toStrictEqual([
			"search",
			"today",
			"present_it",
			"complete.toggle",
			"bullet.layout",
			"gearMenu",
		]);
	});

	it("hides Present when the zoomed node has no children", () => {
		expect(clusterSequence(renderCluster("alice", false, [{id: "r1"}]))).not.toContain("present_it");
	});

	it("hides Present at an empty root", () => {
		expect(clusterSequence(renderCluster(null, true, []))).not.toContain("present_it");
	});

	it("renders the kebab wrapper without a tooltip or blue dot", () => {
		const cluster = clusterHtml(renderCluster("alice", true, []));
		const kebab = cluster.slice(cluster.indexOf('<div tabindex="0" class="relative outline-none menu gearMenu">'));
		expect(kebab.replaceAll(/ d="[^"]*"/gu, "")).toBe(
			'<div tabindex="0" class="relative outline-none menu gearMenu"><div><div role="button" tabindex="0" class="iconButton lg shape-circle">' +
				'<svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="ellipsis-vertical" class="svg-inline--fa fa-ellipsis-vertical fa-lg " role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 512"><path fill="currentColor"></path></svg>' +
				"</div></div></div></div></div>",
		);
		expect(cluster).not.toContain("w-[7px]");
		expect(cluster).not.toContain('role="tooltip"');
	});

	it("renders Today as a bare div around a calendar-day IconButton", () => {
		const cluster = clusterHtml(renderCluster("alice", true, [])).replaceAll(/ d="[^"]*"/gu, "");
		expect(cluster).toContain(
			`<div><div role="button" tabindex="0" class="iconButton lg shape-circle">${svg("calendar-day", 448)}</div></div>`,
		);
	});

	it("renders no New pane separator and no Calendar popover", () => {
		const html = renderCluster("alice", true, []);
		expect(html).not.toContain("border-l");
		expect(html).not.toContain("top-bar-calendar-container");
		expect(html).not.toContain("calendar-panel");
	});
});

/** Outer HTML of the complete.toggle IconButton, svg path data stripped. */
function completedToggleHtml(html: string): string {
	const start = html.lastIndexOf("<div", html.indexOf('data-handbook="complete.toggle"'));
	const end = html.indexOf("</svg></div>", start) + "</svg></div>".length;
	return html.slice(start, end).replaceAll(/ d="[^"]*"/gu, "");
}

function svgStyled(name: string, width: number, style: string): string {
	return svg(name, width).replace(' 512"><path', ` 512" style="${style}"><path`);
}

describe("TopBar share button", () => {
	it("builds the workflowy.com short-id URL", () => {
		expect(shareUrl("21757ea6-e49b-4392-aa5b-aeda6fe0c1bb")).toBe("https://workflowy.com/#/aeda6fe0c1bb");
	});

	it("opens the zoomed node on workflowy.com in a new tab", () => {
		const open = vi.fn<typeof window.open>();
		vi.stubGlobal("window", {open});
		renderCluster("21757ea6-e49b-4392-aa5b-aeda6fe0c1bb", true, []);
		const onClick = iconButtonProps.get("share")?.onClick as () => void;
		onClick();
		vi.unstubAllGlobals();
		expect(open.mock.calls).toStrictEqual([["https://workflowy.com/#/aeda6fe0c1bb", "_blank", "noopener"]]);
	});

	it("renders a user-plus IconButton without a handbook", () => {
		const cluster = clusterHtml(renderCluster("alice", true, [])).replaceAll(/ d="[^"]*"/gu, "");
		expect(cluster).toContain(
			`<div role="button" tabindex="0" class="iconButton lg shape-circle">${svg("user-plus", 640)}</div>`,
		);
	});
});

describe("TopBar show completed toggle", () => {
	it("toggles completed directly on click, with no popup", () => {
		const toggleCompleted = vi.fn<() => void>();
		storeState.toggleCompleted = toggleCompleted;
		const html = renderToStaticMarkup(createElement(TopBar));
		storeState.toggleCompleted = () => {};
		const onClick = iconButtonProps.get("complete.toggle")?.onClick as () => void;
		onClick();
		expect(toggleCompleted).toHaveBeenCalledOnce();
		expect(html).not.toContain("hide-completed-popup");
		expect(html).not.toContain("top-bar-completed-container");
		expect(html).not.toContain('aria-haspopup="true" data-handbook="complete.toggle"');
	});

	it("renders an untinted check with a Show completed tooltip when hidden", () => {
		const html = renderToStaticMarkup(createElement(TopBar));
		expect(completedToggleHtml(html)).toBe(
			`<div role="button" tabindex="0" data-handbook="complete.toggle" class="iconButton lg shape-circle">${svg("check", 448)}</div>`,
		);
		expect(iconButtonProps.get("complete.toggle")?.tooltip).toBe("Show completed");
	});

	it("tints the check svg and offers Hide completed when shown", () => {
		storeState.showCompleted = true;
		const html = renderToStaticMarkup(createElement(TopBar));
		storeState.showCompleted = false;
		expect(completedToggleHtml(html)).toBe(
			`<div role="button" tabindex="0" data-handbook="complete.toggle" class="iconButton lg shape-circle">${svgStyled("check", 448, "color:var(--wf-text-tint)")}</div>`,
		);
		expect(iconButtonProps.get("complete.toggle")?.tooltip).toBe("Hide completed");
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

	it("drops the local-only Calendar popover rules", () => {
		expect(hasSelector(styles, /\.(calendar-panel|calendar-day|top-bar-calendar-container)\b/u)).toBe(false);
	});
});
