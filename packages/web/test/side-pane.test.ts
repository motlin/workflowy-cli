import {describe, expect, it, vi} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createElement, useContext} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type * as IconButtonModule from "../src/client/components/icon-button.js";
import {cssBlock} from "./helpers/css-block.js";

interface PaneState {
	zoomedId: string | null;
	backLocations: (string | null)[];
	forwardLocations: (string | null)[];
}
const calls: {close: number; zoom: (string | null)[]; activate: string[]; history: string[]} = {
	close: 0,
	zoom: [],
	activate: [],
	history: [],
};
const BOB: PaneState = {zoomedId: "bob", backLocations: [], forwardLocations: []};
const storeState: {sidePane: PaneState | null; activePaneId: string} & Record<string, unknown> = {
	sidePane: BOB,
	activePaneId: "side",
	setActivePane: (paneId: string) => {
		calls.activate.push(paneId);
	},
	closeSidePane: () => {
		calls.close++;
	},
	zoomSidePane: (zoomedId: string | null) => {
		calls.zoom.push(zoomedId);
	},
	sidePaneBack: () => {
		calls.history.push("back");
	},
	sidePaneForward: () => {
		calls.history.push("forward");
	},
};

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (selector?: (state: typeof storeState) => unknown) =>
		selector === undefined ? storeState : selector(storeState),
}));

const {PaneContext, paneActivation, sidePaneWidth} = await import("../src/client/components/pane-context.js");

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

const {MainPane, SidePane} = await import("../src/client/components/side-pane.js");

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");

function render(): string {
	return renderToStaticMarkup(createElement(SidePane));
}

describe("SidePane", () => {
	it("renders nothing when no pane is open", () => {
		storeState.sidePane = null;
		const html = render();
		storeState.sidePane = BOB;
		expect(html).toBe("");
	});

	it("renders an item-tree pane with upstream's data attributes", () => {
		const html = render();
		expect(html.slice(0, html.indexOf(">") + 1)).toBe(
			'<div data-pane-id="side" data-pane-type="item-tree" data-pane-active="true" class="side-pane group/pane relative box-border flex-none bg-primary flex flex-col">',
		);
	});

	it("marks the pane inactive while the main pane is active", () => {
		storeState.activePaneId = "main";
		const html = render();
		storeState.activePaneId = "side";
		expect(html).toContain('data-pane-active="false"');
	});

	it("tells its outline it renders in the side pane", () => {
		seenPaneIds.length = 0;
		render();
		expect(seenPaneIds).toStrictEqual(["side"]);
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
		}).toStrictEqual({buttons: ["Back", "Today", "Close pane"], backDisabled: true, crumbsAfterBack: true});
	});

	it("enables Back and shows Forward when the pane has history", () => {
		buttons.clear();
		storeState.sidePane = {zoomedId: "bob", backLocations: [null], forwardLocations: ["carol"]};
		render();
		storeState.sidePane = BOB;
		calls.history.length = 0;
		buttons.get("Back")?.onClick?.({} as never);
		buttons.get("Forward")?.onClick?.({} as never);
		expect({
			buttons: [...buttons.keys()],
			backDisabled: buttons.get("Back")?.disabled,
			history: calls.history,
		}).toStrictEqual({
			buttons: ["Back", "Forward", "Today", "Close pane"],
			backDisabled: false,
			history: ["back", "forward"],
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
			zoom: ["alice", null],
			scrolls: "function",
		});
	});

	it("zooms the pane, not the main outline, to today", () => {
		calls.zoom.length = 0;
		const html = render();
		today.zoomTo?.("day1");
		expect({zoom: calls.zoom, hasTodayTarget: html.includes("calendar-day")}).toStrictEqual({
			zoom: ["day1"],
			hasTodayTarget: true,
		});
	});

	it("renders the outline zoomed to the pane's node inside its own scroller", () => {
		expect(render()).toContain(
			'<div class="side-pane-scroller vertical-scrollable-container"><div class="outline-tree-mock" data-parent="bob"></div></div>',
		);
	});

	it("renders Home's outline for a null pane zoom", () => {
		storeState.sidePane = {...BOB, zoomedId: null};
		const html = render();
		storeState.sidePane = BOB;
		expect(html).toContain('data-parent="home"');
	});

	it("closes the pane from its xmark button", () => {
		calls.close = 0;
		render();
		buttons.get("Close pane")?.onClick?.({} as never);
		expect(calls.close).toBe(1);
	});

	it("routes bullet zooms inside the pane to the pane", () => {
		seenPaneZooms.length = 0;
		calls.zoom.length = 0;
		render();
		seenPaneZooms[0]?.("carol");
		expect(calls.zoom).toStrictEqual(["carol"]);
	});
});

describe("MainPane", () => {
	function renderMain(): string {
		return renderToStaticMarkup(createElement(MainPane, null, createElement("i")));
	}

	it("wraps the main outline in a layout-free pane, active while a side pane is open and focused out of", () => {
		storeState.activePaneId = "main";
		const html = renderMain();
		storeState.activePaneId = "side";
		expect(html).toBe(
			'<div data-pane-id="main" data-pane-type="item-tree" data-pane-active="true" class="main-pane group/pane contents"><i></i></div>',
		);
	});

	it("is inactive while the side pane is active", () => {
		expect(renderMain()).toContain('data-pane-active="false"');
	});

	it("is never active without a side pane, so its header keeps the plain border", () => {
		storeState.activePaneId = "main";
		storeState.sidePane = null;
		const html = renderMain();
		storeState.activePaneId = "side";
		storeState.sidePane = BOB;
		expect(html).toContain('data-pane-active="false"');
	});
});

describe("paneActivation", () => {
	it("activates the pane on pointerdown and focusin inside it, like upstream", () => {
		const activated: string[] = [];
		const handlers = paneActivation("side", (paneId) => {
			activated.push(paneId);
		});
		handlers.onPointerDown();
		handlers.onFocus();
		expect(activated).toStrictEqual(["side", "side"]);
	});
});

describe("sidePaneWidth", () => {
	it("splits the space beside the left bar in half with a 350px floor", () => {
		expect([sidePaneWidth(0), sidePaneWidth(296)]).toStrictEqual([
			"max(350px, calc((100vw - 0px) / 2))",
			"max(350px, calc((100vw - 296px) / 2))",
		]);
	});
});

describe("side pane layout CSS", () => {
	it("pins the pane to the right half of the space beside the left bar", () => {
		expect(cssBlock(styles, ".side-pane")).toStrictEqual({
			position: "fixed",
			top: "0",
			right: "0",
			bottom: "0",
			width: "var(--side-pane-width)",
			"z-index": "200",
			"border-left": "var(--wf-border-width-s) solid var(--wf-border-primary)",
		});
	});

	it("lets the pane header flow inside the pane instead of fixing it to the window", () => {
		expect(cssBlock(styles, ".side-pane .header")).toStrictEqual({position: "static", "min-width": "0"});
	});

	it("scrolls the pane's outline on its own", () => {
		expect(cssBlock(styles, ".side-pane-scroller")).toStrictEqual({
			flex: "1 1 0",
			"min-height": "0",
			"overflow-y": "auto",
			"overscroll-behavior": "contain",
			padding: "24px 40px 24px 56px",
		});
	});

	it("narrows the main outline and header by the pane width", () => {
		expect({
			view: cssBlock(styles, ".outline-container.with-side-pane .outline-view"),
			header: cssBlock(styles, ".outline-container.with-side-pane > .main-pane > .header"),
		}).toStrictEqual({
			view: {"margin-right": "var(--side-pane-width)", "padding-right": "40px"},
			header: {right: "var(--side-pane-width)"},
		});
	});
});
