import {describe, expect, it, vi} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createElement, useContext} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type * as IconButtonModule from "../src/client/components/icon-button.js";
import {cssBlock} from "./helpers/css-block.js";

interface PaneState {
	id: string;
	zoomedId: string | null;
	backLocations: (string | null)[];
	forwardLocations: (string | null)[];
	query: string;
	expandedIds: Set<string>;
}
const calls: {
	close: string[];
	zoom: string[];
	activate: string[];
	history: string[];
	opened: unknown[][];
	queries: string[];
} = {
	close: [],
	zoom: [],
	activate: [],
	history: [],
	opened: [],
	queries: [],
};
const B = "BBBBBBBBBBB";
const C = "CCCCCCCCCCC";
const D = "DDDDDDDDDDD";
function paneState(id: string, zoomedId: string | null): PaneState {
	return {id, zoomedId, backLocations: [], forwardLocations: [], query: "", expandedIds: new Set()};
}
const BOB = paneState(B, "bob");
const storeState: {panes: PaneState[]; activePaneId: string; paneWidths: Record<string, number>} & Record<
	string,
	unknown
> = {
	panes: [BOB],
	activePaneId: B,
	paneWidths: {main: 400, [B]: 500, [C]: 600, [D]: 700},
	setPaneWidths: () => {},
	resizeToAvailableWidth: () => {},
	setActivePane: (paneId: string) => {
		calls.activate.push(paneId);
	},
	closePane: (paneId: string) => {
		calls.close.push(paneId);
	},
	zoomPane: (paneId: string, zoomedId: string | null) => {
		calls.zoom.push(`${paneId}:${zoomedId ?? "home"}`);
	},
	paneBack: (paneId: string) => {
		calls.history.push(`back:${paneId}`);
	},
	paneForward: (paneId: string) => {
		calls.history.push(`forward:${paneId}`);
	},
	openPane: (zoomedId: string | null, options?: unknown) => {
		calls.opened.push([zoomedId, options]);
		return "NEW";
	},
	setPaneQuery: (paneId: string, query: string) => {
		calls.queries.push(`${paneId}:${query}`);
	},
};

/** Render with `panes` open, restoring the one-pane default afterwards. */
function withPanes<T>(panes: PaneState[], run: () => T): T {
	storeState.panes = panes;
	try {
		return run();
	} finally {
		storeState.panes = [BOB];
	}
}

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: Object.assign(
		(selector?: (state: typeof storeState) => unknown) =>
			selector === undefined ? storeState : selector(storeState),
		{getState: () => storeState},
	),
	workspacePaneIds: (state: typeof storeState) => ["main", ...state.panes.map((pane) => pane.id)],
}));

const {PaneContext, paneActivation} = await import("../src/client/components/pane-context.js");

/** Records the pane context each OutlineTree sees, so tests can check bullet zooms stay in the pane. */
const seenPaneZooms: ((id: string | null) => void)[] = [];
const seenPaneIds: string[] = [];
vi.mock("../src/client/components/outline-tree.js", () => ({
	OutlineTree: ({parentId}: {parentId: string | null}) => {
		const pane = useContext(PaneContext);
		if (pane !== null) {
			seenPaneZooms.push(pane.zoom);
			seenPaneIds.push(pane.id);
		}
		return createElement("div", {className: "outline-tree-mock", "data-parent": parentId ?? "home"});
	},
}));

type IconButtonProps = Parameters<typeof IconButtonModule.IconButton>[0];
const buttons = new Map<string, IconButtonProps>();
vi.mock("../src/client/components/icon-button.js", async (importOriginal) => {
	const actual = await importOriginal<typeof IconButtonModule>();
	return {
		...actual,
		IconButton: (props: IconButtonProps) => {
			if (typeof props.tooltip === "string") {
				buttons.set(props.tooltip, props);
			}
			return actual.IconButton(props);
		},
	};
});

/** The pane header's breadcrumbs: records the zoom they show and where their clicks go. */
const crumbProps: {nodeId: string | null; onNavigate?: (id: string | null) => void; scrollToTop?: () => void}[] = [];
vi.mock("../src/client/components/breadcrumbs.js", () => ({
	Breadcrumbs: (props: (typeof crumbProps)[number]) => {
		crumbProps.push(props);
		return createElement("div", {className: "breadcrumbs-mock"});
	},
}));

/** Today in the pane header: records the zoom it targets. */
const today: {zoomTo: ((id: string) => void) | undefined} = {zoomTo: undefined};
vi.mock("../src/client/hooks/use-navigate-to-today.js", () => ({
	useNavigateToToday: (zoomTo?: (id: string) => void) => {
		today.zoomTo = zoomTo;
		return async () => Promise.resolve();
	},
}));

/** The pane's compact search box: records the query it shows and where commits go. */
const searchProps: {query: string; compact?: boolean; onCommit: (query: string) => void}[] = [];
vi.mock("../src/client/components/pane-search-box.js", () => ({
	PaneSearchBox: (props: (typeof searchProps)[number]) => {
		searchProps.push(props);
		return createElement("div", {className: "pane-search-mock"});
	},
}));

/** The pane's kebab: records the zoom its compactable items act on. */
const menuZooms: (string | null)[] = [];
vi.mock("../src/client/components/header-more-menu.js", () => ({
	HeaderMoreMenu: ({zoomedId}: {zoomedId: string | null}) => {
		menuZooms.push(zoomedId);
		return createElement("div", {className: "more-menu-mock"});
	},
}));

const {MainPane, PaneWorkspace, SidePanes} = await import("../src/client/components/side-pane.js");

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");

function render(): string {
	return renderToStaticMarkup(createElement(SidePanes, {onUndo: () => {}, onRedo: () => {}}));
}

describe("SidePanes", () => {
	it("renders nothing when no pane is open", () => {
		expect(withPanes([], render)).toBe("");
	});

	it("renders every open pane left to right as workspace flex items sized by their widths, like upstream", () => {
		const html = withPanes([BOB, paneState(C, "carol"), paneState(D, null)], render);
		const tags = [...html.matchAll(/<div data-pane-id="[^"]*"[^>]*>/gu)].map(([tag]) => tag);
		expect({first: html.startsWith(`<div data-pane-id="${B}"`), tags}).toStrictEqual({
			first: true,
			tags: [
				[B, 500],
				[C, 600],
				[D, 700],
			].map(
				([id, width]) =>
					`<div data-pane-id="${id}" data-pane-type="item-tree" data-pane-active="${id === B ? "true" : "false"}" class="side-pane group/pane relative box-border flex-none h-full max-h-full min-h-0 min-w-[350px] bg-primary flex flex-col" style="flex:${width} 1 0px">`,
			),
		});
	});

	it("puts a 4px resize handle on every pane's left edge", () => {
		const handle = '<div class="pane-resize-handle absolute top-0 bottom-0 left-0 w-[4px] cursor-ew-resize"></div>';
		const html = withPanes([BOB, paneState(C, "carol"), paneState(D, null)], render);
		expect(html.split(handle).length - 1).toBe(3);
	});

	it("marks the pane inactive while the main pane is active", () => {
		storeState.activePaneId = "main";
		const html = render();
		storeState.activePaneId = B;
		expect(html).toContain('data-pane-active="false"');
	});

	it("tells each pane's outline which pane it renders in", () => {
		seenPaneIds.length = 0;
		withPanes([BOB, paneState(C, "carol")], render);
		expect(seenPaneIds).toStrictEqual([B, C]);
	});

	it("renders a wf-pane-header with upstream's Back, breadcrumbs, Today and Close pane", () => {
		buttons.clear();
		const html = render();
		expect(html).toContain(
			'<div class="wf-header header bg-primary wf-pane-header border-b border-solid border-primary group-data-[pane-active=true]/pane:border-b-tint flex-shrink-0">',
		);
		expect({
			buttons: [...buttons.keys()],
			backDisabled: buttons.get("Back")?.disabled,
			crumbsAfterBack: html.indexOf("breadcrumbs-mock") > html.indexOf("chevron-left"),
		}).toStrictEqual({
			buttons: ["Back", "Today", "Close pane", "New pane"],
			backDisabled: true,
			crumbsAfterBack: true,
		});
	});

	it("enables Back and shows Forward when the pane has history, stepping that pane's history", () => {
		buttons.clear();
		calls.history.length = 0;
		withPanes([{...BOB, backLocations: [null], forwardLocations: ["carol"]}], render);
		buttons.get("Back")?.onClick?.({} as never);
		buttons.get("Forward")?.onClick?.({} as never);
		expect({
			buttons: [...buttons.keys()],
			backDisabled: buttons.get("Back")?.disabled,
			history: calls.history,
		}).toStrictEqual({
			buttons: ["Back", "Forward", "Today", "Close pane", "New pane"],
			backDisabled: false,
			history: [`back:${B}`, `forward:${B}`],
		});
	});

	it("shows the pane's zoom in breadcrumbs that zoom the pane", () => {
		crumbProps.length = 0;
		calls.zoom.length = 0;
		render();
		const crumbs = crumbProps.at(-1);
		crumbs?.onNavigate?.("alice");
		crumbs?.onNavigate?.(null);
		expect({nodeId: crumbs?.nodeId, zoom: calls.zoom, scrolls: typeof crumbs?.scrollToTop}).toStrictEqual({
			nodeId: "bob",
			zoom: [`${B}:alice`, `${B}:home`],
			scrolls: "function",
		});
	});

	it("zooms the pane, not the main outline, to today", () => {
		calls.zoom.length = 0;
		const html = render();
		today.zoomTo?.("day1");
		expect({zoom: calls.zoom, hasTodayTarget: html.includes("calendar-day")}).toStrictEqual({
			zoom: [`${B}:day1`],
			hasTodayTarget: true,
		});
	});

	it("orders the header's right cluster like upstream: search circle, Today, kebab, Close pane", () => {
		const html = render();
		const order = ["pane-search-mock", "calendar-day", "more-menu-mock", "xmark"].map((marker) =>
			html.indexOf(marker),
		);
		expect({
			found: order.every((index) => index > 0),
			ordered: order.every((index, i) => i === 0 || index > (order[i - 1] ?? 0)),
		}).toStrictEqual({found: true, ordered: true});
	});

	it("gives the pane a compact search box over its own query that commits to the pane", () => {
		searchProps.length = 0;
		calls.queries.length = 0;
		withPanes([{...BOB, query: "#todo"}], render);
		const search = searchProps.at(-1);
		search?.onCommit("#done");
		expect({query: search?.query, compact: search?.compact, queries: calls.queries}).toStrictEqual({
			query: "#todo",
			compact: true,
			queries: [`${B}:#done`],
		});
	});

	it("points each pane's kebab at that pane's zoom", () => {
		menuZooms.length = 0;
		withPanes([BOB, paneState(C, "carol")], render);
		expect(menuZooms).toStrictEqual(["bob", "carol"]);
	});

	it("puts upstream's pane-workspace-control with a New pane button at the last pane's top right only", () => {
		const control =
			'<div class="pane-workspace-control box-content absolute top-0 right-0 flex h-[var(--wf-header-height)] w-[var(--pane-workspace-control-width)] items-center justify-center border-l border-b border-solid border-primary group-data-[pane-active=true]/pane:border-b-tint bg-primary">';
		const html = withPanes([BOB, paneState(C, "carol"), paneState(D, null)], render);
		const controlAt = html.indexOf(control);
		expect({
			count: html.split(control).length - 1,
			inLastPane: controlAt > html.indexOf(`data-pane-id="${D}"`),
		}).toStrictEqual({count: 1, inLastPane: true});
	});

	it("opens another pane on the last pane's zoom from its New pane button, after it", () => {
		calls.opened.length = 0;
		buttons.clear();
		withPanes([BOB, paneState(C, "carol")], render);
		buttons.get("New pane")?.onClick?.({} as never);
		expect({shortcut: buttons.get("New pane")?.shortcut, opened: calls.opened}).toStrictEqual({
			shortcut: "⌃R",
			opened: [["carol", {sourcePaneId: C}]],
		});
	});

	it("renders the outline zoomed to the pane's node inside its own scroller", () => {
		expect(render()).toContain(
			'<div class="side-pane-scroller vertical-scrollable-container"><div class="outline-tree-mock" data-parent="bob"></div></div>',
		);
	});

	it("renders Home's outline for a null pane zoom", () => {
		expect(withPanes([paneState(B, null)], render)).toContain('data-parent="home"');
	});

	it("closes its own pane from its xmark button", () => {
		calls.close.length = 0;
		buttons.clear();
		withPanes([BOB, paneState(C, "carol")], render);
		buttons.get("Close pane")?.onClick?.({} as never);
		expect(calls.close).toStrictEqual([C]);
	});

	it("routes bullet zooms inside each pane to that pane", () => {
		seenPaneZooms.length = 0;
		calls.zoom.length = 0;
		withPanes([BOB, paneState(C, "carol")], render);
		seenPaneZooms[0]?.("dave");
		seenPaneZooms[1]?.("eve");
		expect(calls.zoom).toStrictEqual([`${B}:dave`, `${C}:eve`]);
	});
});

describe("PaneWorkspace", () => {
	function renderWorkspace(): string {
		return renderToStaticMarkup(createElement(PaneWorkspace, null, createElement("i")));
	}

	it("is a horizontally scrolling full-height flex row of panes while a pane is open, like upstream's workspace", () => {
		expect(renderWorkspace()).toBe(
			'<div data-pane-workspace="true" class="pane-workspace flex h-screen max-h-screen min-h-0 items-stretch overflow-x-auto overflow-y-hidden bg-primary"><i></i></div>',
		);
	});

	it("lays nothing out in the single-document layout", () => {
		expect(withPanes([], renderWorkspace)).toBe('<div class="pane-workspace contents"><i></i></div>');
	});
});

describe("MainPane", () => {
	function renderMain(): string {
		return renderToStaticMarkup(createElement(MainPane, null, createElement("i")));
	}

	it("wraps the main outline in a layout-free pane in the single-document layout", () => {
		expect(withPanes([], renderMain)).toBe(
			'<div data-pane-id="main" data-pane-type="item-tree" data-pane-active="false" class="main-pane group/pane contents"><i></i></div>',
		);
	});

	it("is active while a pane is open and the main pane was focused last", () => {
		storeState.activePaneId = "main";
		const html = renderMain();
		storeState.activePaneId = B;
		expect(html).toContain('data-pane-active="true"');
	});

	it("is inactive while another pane is active", () => {
		expect(renderMain()).toContain('data-pane-active="false"');
	});

	it("becomes the workspace's first flex item, sized by its width, while a pane is open", () => {
		expect(renderMain()).toBe(
			'<div data-pane-id="main" data-pane-type="item-tree" data-pane-active="false" class="main-pane group/pane shrink-0 min-w-[350px] relative box-border h-full max-h-full min-h-0 flex flex-col" style="flex:400 1 0px"><i></i></div>',
		);
	});

	it("is never active without a pane open, so its header keeps the plain border", () => {
		storeState.activePaneId = "main";
		const html = withPanes([], renderMain);
		storeState.activePaneId = B;
		expect(html).toContain('data-pane-active="false"');
	});
});

describe("paneActivation", () => {
	it("activates the pane on pointerdown and focusin inside it, like upstream", () => {
		const activated: string[] = [];
		const handlers = paneActivation(B, (paneId) => {
			activated.push(paneId);
		});
		handlers.onPointerDown();
		handlers.onFocus();
		expect(activated).toStrictEqual([B, B]);
	});
});

describe("side pane layout CSS", () => {
	it("borders each pane on the left", () => {
		expect(cssBlock(styles, ".side-pane")).toStrictEqual({
			"border-left": "var(--wf-border-width-s) solid var(--wf-border-primary)",
			"--pane-workspace-control-width": "var(--wf-header-height)",
		});
	});

	it("lets each pane header flow inside its pane, and only the last one makes room for the New pane control", () => {
		expect({
			header: cssBlock(styles, ".side-pane .header"),
			last: cssBlock(styles, ".side-pane:last-child .header"),
		}).toStrictEqual({
			header: {position: "static", "min-width": "0"},
			last: {"padding-right": "var(--pane-workspace-control-width)"},
		});
	});

	it("scrolls each pane's outline on its own", () => {
		expect(cssBlock(styles, ".side-pane-scroller")).toStrictEqual({
			flex: "1 1 0",
			"min-height": "0",
			"overflow-y": "auto",
			"overscroll-behavior": "contain",
			padding: "24px 40px 24px 56px",
		});
	});

	it("gives the main pane its own scroller and an in-flow header while a pane is open, like the other panes", () => {
		expect({
			view: cssBlock(styles, ".outline-container.with-side-pane .main-pane > .outline-view"),
			header: cssBlock(styles, ".outline-container.with-side-pane .main-pane > .header"),
		}).toStrictEqual({
			view: {
				flex: "1 1 0",
				"min-height": "0",
				margin: "0",
				"overflow-y": "auto",
				"overscroll-behavior": "contain",
				padding: "24px 40px 24px 56px",
			},
			header: {position: "static", "min-width": "0", "flex-shrink": "0"},
		});
	});

	it("stacks the resize handle over the pane header", () => {
		expect(cssBlock(styles, ".pane-resize-handle")).toStrictEqual({"z-index": "1"});
	});
});
