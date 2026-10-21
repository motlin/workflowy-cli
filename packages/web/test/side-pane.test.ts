import {describe, expect, it, vi} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createElement, useContext} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type * as IconButtonModule from "../src/client/components/icon-button.js";
import {cssBlock} from "./helpers/css-block.js";

const calls: {close: number; zoom: (string | null)[]; activate: string[]} = {close: 0, zoom: [], activate: []};
const storeState: {sidePane: {zoomedId: string | null} | null; activePaneId: string} & Record<string, unknown> = {
	sidePane: {zoomedId: "bob"},
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

const {MainPane, SidePane} = await import("../src/client/components/side-pane.js");

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");

function render(): string {
	return renderToStaticMarkup(createElement(SidePane));
}

describe("SidePane", () => {
	it("renders nothing when no pane is open", () => {
		storeState.sidePane = null;
		const html = render();
		storeState.sidePane = {zoomedId: "bob"};
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

	it("renders a wf-pane-header with Home and Close pane", () => {
		const html = render();
		expect(html).toContain(
			'<div class="wf-header header bg-primary wf-pane-header border-b border-solid border-primary group-data-[pane-active=true]/pane:border-b-tint flex-shrink-0">',
		);
		expect([...buttons.keys()]).toStrictEqual(["Home", "Close pane"]);
	});

	it("renders the outline zoomed to the pane's node inside its own scroller", () => {
		expect(render()).toContain(
			'<div class="side-pane-scroller vertical-scrollable-container"><div class="outline-tree-mock" data-parent="bob"></div></div>',
		);
	});

	it("renders Home's outline for a null pane zoom", () => {
		storeState.sidePane = {zoomedId: null};
		const html = render();
		storeState.sidePane = {zoomedId: "bob"};
		expect(html).toContain('data-parent="home"');
	});

	it("closes the pane from its xmark button", () => {
		calls.close = 0;
		render();
		buttons.get("Close pane")?.onClick?.({} as never);
		expect(calls.close).toBe(1);
	});

	it("zooms the pane to Home from its house button", () => {
		calls.zoom.length = 0;
		render();
		buttons.get("Home")?.onClick?.({} as never);
		expect(calls.zoom).toStrictEqual([null]);
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
		storeState.sidePane = {zoomedId: "bob"};
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
