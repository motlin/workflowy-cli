import {describe, expect, it, vi} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type * as IconButtonModule from "../src/client/components/icon-button.js";
import type {GearMenuHeaderItem} from "../src/client/components/gear-menu.js";
import {cssBlock, cssBlockText, hasSelector} from "./helpers/css-block.js";

const pickerCalls: unknown[] = [];
const openSidePaneCalls: (string | null)[] = [];
const storeState: {zoomedNodeId: string | null; sidePane: {zoomedId: string | null} | null} & Record<string, unknown> =
	{
		zoomedNodeId: "alice",
		sidePane: null,
		openSidePane: (zoomedId: string | null) => {
			openSidePaneCalls.push(zoomedId);
		},
		toggleLeftBar: () => {},
		searchInput: "",
		setSearchInput: () => {},
		searchFocused: false,
		setSearchFocused: () => {},
		showCompleted: false,
		openSettings: () => {},
		openPresentation: () => {},
		leftBarOffset: () => 0,
		leftBarMode: "drawerClosed",
		nav: {current: null, back: [], forward: []},
		showItemTypePicker: (picker: unknown) => {
			pickerCalls.push(picker);
		},
	};

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (selector?: (state: typeof storeState) => unknown) =>
		selector === undefined ? storeState : selector(storeState),
}));
vi.mock("../src/client/hooks/use-starred.js", () => ({
	STARS_UNAVAILABLE_TOOLTIP: "Stars need Workflowy login",
	useRecordStarViews: () => {},
	useStarActions: () => ({toggleStar: async () => Promise.resolve(true)}),
	useStarredLocations: () => [],
	useStars: () => ({stars: [], unavailable: false}),
}));
vi.mock("react-router-dom", () => ({useNavigate: () => () => {}}));
vi.mock("@tanstack/react-query", () => ({useQueryClient: () => ({}), useQuery: () => ({data: undefined})}));
const toggleState = {toggleCompleted: (): void => {}};
vi.mock("../src/client/hooks/use-show-completed-toggle.js", () => ({
	useShowCompletedToggle: () => toggleState.toggleCompleted,
}));
vi.mock("../src/client/navigation.js", () => ({stepNav: () => {}, useNavStackSync: () => {}}));
const nodeState: {hasChildren: boolean; rootChildren: {id: string}[]; layoutMode: string | null} = {
	hasChildren: true,
	rootChildren: [{id: "r1"}],
	layoutMode: null,
};
const homeState: {layoutMode: string | undefined} = {layoutMode: undefined};

const expandAllCalls: [string | null, boolean][] = [];

vi.mock("../src/client/hooks/use-nodes.js", () => ({
	useExpandAll: () => (rootId: string | null, open: boolean) => {
		expandAllCalls.push([rootId, open]);
	},
	useUpdateNode: () => ({mutate: () => {}}),
	useNode: (nodeId: string | null) => ({
		data:
			nodeId === null
				? undefined
				: {id: nodeId, hasChildren: nodeState.hasChildren, data: {layoutMode: nodeState.layoutMode}},
	}),
	useHome: () => ({data: homeState.layoutMode === undefined ? undefined : {layoutMode: homeState.layoutMode}}),
	useChildren: () => ({data: nodeState.rootChildren}),
}));
vi.mock("../src/client/components/breadcrumbs.js", () => ({
	Breadcrumbs: () => createElement("div", {className: "breadcrumbs-mock"}),
}));
const media = {wide: true};
vi.mock("../src/client/hooks/use-media-query.js", () => ({
	useMediaQuery: (query: string) => (query === "(min-width: 701px)" ? media.wide : true),
}));

interface CapturedGearMenuProps {
	headerItems?: GearMenuHeaderItem[];
	onExpandAll?: () => void;
	onCollapseAll?: () => void;
}
const gearMenuProps: CapturedGearMenuProps = {};
vi.mock("../src/client/components/gear-menu.js", () => ({
	GearMenu: (props: CapturedGearMenuProps) => {
		gearMenuProps.headerItems = props.headerItems;
		gearMenuProps.onExpandAll = props.onExpandAll;
		gearMenuProps.onCollapseAll = props.onCollapseAll;
		return null;
	},
}));

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
			if (props.tooltip === "New pane") {
				iconButtonProps.set("new_pane", props);
			}
			return actual.IconButton(props);
		},
	};
});

const {TopBar, createPeekController} = await import("../src/client/components/top-bar.js");

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");

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
			'<div class="wf-header header bg-primary border-b border-solid border-primary group-data-[pane-active=true]/pane:border-b-tint" style="left:0;z-index:200">',
		);
	});

	it("offsets the header by the pinned left bar width", () => {
		storeState.leftBarOffset = () => 296;
		const pinned = renderToStaticMarkup(createElement(TopBar));
		storeState.leftBarOffset = () => 0;
		expect(pinned.slice(0, pinned.indexOf(">") + 1)).toBe(
			'<div class="wf-header header bg-primary border-b border-solid border-primary group-data-[pane-active=true]/pane:border-b-tint" style="left:296px;z-index:200">',
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
	const home = {id: null, query: null};
	storeState.nav = {current: home, back: canGoBack ? [home] : [], forward: canGoForward ? [home] : []};
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

	it("replaces the hamburger with upstream's w-l spacer while the left bar is pinned", () => {
		storeState.leftBarMode = "alwaysOpen";
		const html = renderWithNav(false, false);
		storeState.leftBarMode = "drawerClosed";
		expect(html.slice(html.indexOf(">") + 1, html.indexOf('<div class="pagination">'))).toBe(
			'<div class="w-l"></div>',
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
		/fa-calendar-day\b|fa-user-plus|viewBox="0 0 33 30"|data-handbook="([^"]+)"|class="[^"]*\bgearMenu\b/gu,
	);
	return [...tokens].map((match) => {
		if (match[0] === 'viewBox="0 0 33 30"') {
			return "new_pane";
		}
		if (match[0].startsWith("data-handbook")) {
			return match[1] === "search.search" ? "search" : match[1];
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
			"new_pane",
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
			"new_pane",
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
		const kebab = cluster.slice(
			cluster.indexOf('<div tabindex="0" class="relative outline-none menu gearMenu">'),
			cluster.indexOf('<div class="self-stretch border-l'),
		);
		expect(kebab.replaceAll(/ d="[^"]*"/gu, "")).toBe(
			'<div tabindex="0" class="relative outline-none menu gearMenu"><div><div role="button" tabindex="0" class="iconButton lg shape-circle">' +
				'<svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="ellipsis-vertical" class="svg-inline--fa fa-ellipsis-vertical fa-lg " role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 512"><path fill="currentColor"></path></svg>' +
				"</div></div></div>",
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

	it("renders no Calendar popover", () => {
		const html = renderCluster("alice", true, []);
		expect(html).not.toContain("top-bar-calendar-container");
		expect(html).not.toContain("calendar-panel");
	});
});

function renderWithSidePane(): string {
	storeState.sidePane = {zoomedId: "bob"};
	const html = renderCluster("alice", true, [{id: "r1"}]);
	storeState.sidePane = null;
	return html;
}

/** Outer HTML of the New pane separator and IconButton, svg path data stripped. */
function newPaneHtml(html: string): string {
	const start = html.indexOf('<div class="self-stretch border-l border-solid border-primary mx-s">');
	const end = html.indexOf("</svg></div>", start) + "</svg></div>".length;
	return html.slice(start, end).replaceAll(/ d="[^"]*"/gu, "");
}

describe("TopBar New pane", () => {
	it("renders upstream's separator and 30x27 columns-plus IconButton after the kebab", () => {
		expect(newPaneHtml(renderCluster("alice", true, []))).toBe(
			'<div class="self-stretch border-l border-solid border-primary mx-s"></div>' +
				'<div role="button" tabindex="0" class="iconButton lg shape-circle">' +
				'<svg aria-hidden="true" focusable="false" width="30" height="27" viewBox="0 0 33 30" fill="none" xmlns="http://www.w3.org/2000/svg">' +
				'<path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor"></path><path fill="currentColor"></path></svg></div>',
		);
	});

	it("shows the ⌃R shortcut in its New pane tooltip", () => {
		renderCluster("alice", true, []);
		const props = iconButtonProps.get("new_pane");
		expect({tooltip: props?.tooltip, shortcut: props?.shortcut}).toStrictEqual({
			tooltip: "New pane",
			shortcut: "⌃R",
		});
	});

	it("opens a side pane on the zoomed node", () => {
		openSidePaneCalls.length = 0;
		renderCluster("alice", true, []);
		iconButtonProps.get("new_pane")?.onClick?.({} as never);
		expect(openSidePaneCalls).toStrictEqual(["alice"]);
	});

	it("opens a side pane on Home at root", () => {
		openSidePaneCalls.length = 0;
		renderCluster(null, true, [{id: "r1"}]);
		iconButtonProps.get("new_pane")?.onClick?.({} as never);
		expect(openSidePaneCalls).toStrictEqual([null]);
	});

	it("hides New pane and compacts the cluster while a pane is open", () => {
		expect(clusterSequence(renderWithSidePane())).toStrictEqual(["search", "today", "gearMenu"]);
	});

	it("moves the compactable actions into the more menu while a pane is open", () => {
		renderWithSidePane();
		expect(gearMenuProps.headerItems?.map((item) => item.label)).toStrictEqual([
			"Share",
			"Present",
			"Star",
			"Show completed",
			"Change layout",
		]);
	});
});

function renderCompact(zoomedNodeId: string | null): string {
	media.wide = false;
	const html = renderCluster(zoomedNodeId, true, [{id: "r1"}]);
	media.wide = true;
	return html;
}

describe("TopBar compact mode under 701px", () => {
	it("keeps only search, Today, the kebab and New pane in the cluster", () => {
		expect(clusterSequence(renderCompact("alice"))).toStrictEqual(["search", "today", "gearMenu", "new_pane"]);
	});

	it("prepends the compactable actions to the more menu", () => {
		renderCompact("alice");
		expect(gearMenuProps.headerItems?.map((item) => item.label)).toStrictEqual([
			"Share",
			"Present",
			"Star",
			"Show completed",
			"Change layout",
		]);
	});

	it("drops Share and Star from the more menu at root", () => {
		renderCompact(null);
		expect(gearMenuProps.headerItems?.map((item) => item.label)).toStrictEqual([
			"Present",
			"Show completed",
			"Change layout",
		]);
	});

	it("runs the same actions from the more menu", () => {
		const toggleCompleted = vi.fn<() => void>();
		toggleState.toggleCompleted = toggleCompleted;
		renderCompact("alice");
		toggleState.toggleCompleted = () => {};
		gearMenuProps.headerItems?.find((item) => item.label === "Show completed")?.onSelect();
		expect(toggleCompleted).toHaveBeenCalledOnce();
	});

	it("passes no header items when wide", () => {
		renderCluster("alice", true, []);
		expect(gearMenuProps.headerItems).toStrictEqual([]);
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
		toggleState.toggleCompleted = toggleCompleted;
		const html = renderToStaticMarkup(createElement(TopBar));
		toggleState.toggleCompleted = () => {};
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

describe("TopBar Expand all / Collapse all", () => {
	it("acts on the zoomed item's whole subtree, and on Home when not zoomed", () => {
		expandAllCalls.length = 0;
		renderToStaticMarkup(createElement(TopBar));
		gearMenuProps.onExpandAll?.();
		gearMenuProps.onCollapseAll?.();
		storeState.zoomedNodeId = null;
		renderToStaticMarkup(createElement(TopBar));
		storeState.zoomedNodeId = "alice";
		gearMenuProps.onExpandAll?.();

		expect(expandAllCalls).toStrictEqual([
			["alice", true],
			["alice", false],
			[null, true],
		]);
	});
});

/** The data-icon of the Change layout button's svg. */
function layoutIcon(html: string): string | undefined {
	const button = html.slice(html.indexOf('data-handbook="bullet.layout"'));
	return /data-icon="([^"]*)"/u.exec(button)?.[1];
}

/** Click Change layout with its element reporting `rect`, and return what the picker store received. */
function clickLayout(rect: {left: number; bottom: number}): unknown[] {
	pickerCalls.length = 0;
	const currentTarget = {getBoundingClientRect: () => rect};
	const onClick = iconButtonProps.get("bullet.layout")?.onClick as unknown as (event: unknown) => void;
	onClick({currentTarget});
	return [...pickerCalls];
}

describe("TopBar Change layout button", () => {
	it("shows the zoomed item's type icon and opens the picker under the button", () => {
		nodeState.layoutMode = "h2";
		const html = renderToStaticMarkup(createElement(TopBar));
		nodeState.layoutMode = null;
		expect(layoutIcon(html)).toBe("h2");
		expect(clickLayout({left: 1131, bottom: 42})).toStrictEqual([
			{nodeIds: ["alice"], position: {top: 46, left: 1131}},
		]);
	});

	it("shows Home's layout icon at Home and opens the picker on the home node", () => {
		storeState.zoomedNodeId = null;
		homeState.layoutMode = "board";
		const html = renderToStaticMarkup(createElement(TopBar));
		homeState.layoutMode = undefined;
		storeState.zoomedNodeId = "alice";
		expect(layoutIcon(html)).toBe("columns-3");
		expect(clickLayout({left: 1131, bottom: 42})).toStrictEqual([
			{nodeIds: ["home"], position: {top: 46, left: 1131}},
		]);
	});

	it("opens the picker under the kebab from the compact more menu", () => {
		pickerCalls.length = 0;
		renderCompact("alice");
		vi.stubGlobal("document", {
			querySelector: (selector: string) =>
				selector === ".wf-header .gearMenu" ? {getBoundingClientRect: () => ({left: 1200, bottom: 44})} : null,
		});
		gearMenuProps.headerItems?.find((item) => item.label === "Change layout")?.onSelect();
		vi.unstubAllGlobals();
		expect(pickerCalls).toStrictEqual([{nodeIds: ["alice"], position: {top: 48, left: 1200}}]);
	});
});

describe("createPeekController", () => {
	function setup(hovered = false) {
		const calls: string[] = [];
		const controller = createPeekController({
			open: () => {
				calls.push("open");
			},
			close: () => {
				calls.push("close");
			},
			isHovered: () => hovered,
		});
		return {calls, controller};
	}

	it("opens the drawer on enter and closes it 200ms after leave", () => {
		vi.useFakeTimers();
		const {calls, controller} = setup();
		controller.enter();
		expect(calls).toStrictEqual(["open"]);
		controller.leave();
		vi.advanceTimersByTime(199);
		expect(calls).toStrictEqual(["open"]);
		vi.advanceTimersByTime(1);
		expect(calls).toStrictEqual(["open", "close"]);
		vi.advanceTimersByTime(1000);
		vi.useRealTimers();
		expect(calls).toStrictEqual(["open", "close"]);
	});

	it("keeps the drawer open when the pointer reached the left bar", () => {
		vi.useFakeTimers();
		const {calls, controller} = setup(true);
		controller.enter();
		controller.leave();
		vi.advanceTimersByTime(200);
		vi.useRealTimers();
		expect(calls).toStrictEqual(["open"]);
	});

	it("cancels a pending close when the pointer re-enters", () => {
		vi.useFakeTimers();
		const {calls, controller} = setup();
		controller.enter();
		controller.leave();
		vi.advanceTimersByTime(100);
		controller.enter();
		vi.advanceTimersByTime(500);
		vi.useRealTimers();
		expect(calls).toStrictEqual(["open", "open"]);
	});
});
