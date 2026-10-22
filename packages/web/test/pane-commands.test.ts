import {describe, expect, it} from "vite-plus/test";
import {processCombo} from "../src/client/keys/dispatch.js";
import {openInPane, paneCommands, paneNavCommands} from "../src/client/pane-commands.js";
import type {OpenInPaneState, PaneCommandStore, PaneNavDeps} from "../src/client/pane-commands.js";

function fakeStore(sidePane: {zoomedId: string | null} | null) {
	const state = {sidePane};
	const store: PaneCommandStore = {
		getState: () => ({
			sidePane: state.sidePane,
			openSidePane: (zoomedId) => {
				state.sidePane = {zoomedId};
			},
			closeSidePane: () => {
				state.sidePane = null;
			},
		}),
	};
	return {state, store};
}

describe("pane commands", () => {
	it("⌃R opens a pane on the zoomed item when none is open", () => {
		const {state, store} = fakeStore(null);
		const result = processCombo("ctrl+r", paneCommands(store), {items: [], zoomedId: "alice"}, true);
		expect({result, sidePane: state.sidePane}).toStrictEqual({result: "claimed", sidePane: {zoomedId: "alice"}});
	});

	it("⌃R opens a pane at Home when the main outline is at Home", () => {
		const {state, store} = fakeStore(null);
		const result = processCombo("ctrl+r", paneCommands(store), {items: [], zoomedId: null}, true);
		expect({result, sidePane: state.sidePane}).toStrictEqual({result: "claimed", sidePane: {zoomedId: null}});
	});

	it("⌃R leaves the open pane alone, since only one pane is supported, and still claims the combo", () => {
		const {state, store} = fakeStore({zoomedId: "bob"});
		const result = processCombo("ctrl+r", paneCommands(store), {items: [], zoomedId: "alice"}, true);
		expect({result, sidePane: state.sidePane}).toStrictEqual({result: "claimed", sidePane: {zoomedId: "bob"}});
	});

	it("⌃⌘W closes the open pane", () => {
		const {state, store} = fakeStore({zoomedId: "bob"});
		const result = processCombo("ctrl+meta+w", paneCommands(store), {items: [], zoomedId: "alice"}, true);
		expect({result, sidePane: state.sidePane}).toStrictEqual({result: "claimed", sidePane: null});
	});

	it("⌃⌘W with no pane open changes nothing and still claims the combo", () => {
		const {state, store} = fakeStore(null);
		const result = processCombo("ctrl+meta+w", paneCommands(store), {items: [], zoomedId: "alice"}, true);
		expect({result, sidePane: state.sidePane}).toStrictEqual({result: "claimed", sidePane: null});
	});
});

function fakeOpenInPaneState(sidePane: {zoomedId: string | null} | null) {
	const calls: string[] = [];
	const state: OpenInPaneState = {
		sidePane,
		openSidePane: (zoomedId) => {
			calls.push(`open:${zoomedId ?? "home"}`);
		},
		zoomSidePane: (zoomedId) => {
			calls.push(`zoom:${zoomedId ?? "home"}`);
		},
		setActivePane: (paneId) => {
			calls.push(`activate:${paneId}`);
		},
	};
	return {calls, state};
}

describe("openInPane", () => {
	it("opens a pane zoomed into the item when none is open", () => {
		const {calls, state} = fakeOpenInPaneState(null);
		openInPane(state, "alice");
		expect(calls).toStrictEqual(["open:alice"]);
	});

	it("zooms and focuses the one side pane when it is already open", () => {
		const {calls, state} = fakeOpenInPaneState({zoomedId: "bob"});
		openInPane(state, "alice");
		expect(calls).toStrictEqual(["zoom:alice", "activate:side"]);
	});
});

function fakeNav(activePaneId: "main" | "side", sidePane: {zoomedId: string | null} | null = {zoomedId: "bob"}) {
	const calls: string[] = [];
	const record =
		(name: string) =>
		(id?: string | null): void => {
			calls.push(id === undefined ? name : `${name}:${id ?? "home"}`);
		};
	const deps: PaneNavDeps = {
		getState: () => ({
			activePaneId,
			sidePane,
			zoomSidePane: record("pane"),
			sidePaneBack: record("pane-back"),
			sidePaneForward: record("pane-forward"),
		}),
		commitEdit: record("commit"),
		goHome: record("main-home"),
		stepMain: (direction) => {
			calls.push(`main-${direction}`);
		},
		navigateToToday: async (inSidePane) => {
			calls.push(inSidePane ? "pane-today" : "main-today");
			return Promise.resolve();
		},
		jumpToSibling: async (step, inSidePane) => {
			calls.push(`${inSidePane ? "pane" : "main"}-sibling:${step}`);
			return Promise.resolve();
		},
	};
	return {calls, registry: paneNavCommands(deps)};
}

const ctx = {items: [], zoomedId: "bob"};

describe("pane navigation commands", () => {
	it("⌘' zooms the active side pane home instead of navigating the main outline", () => {
		const {calls, registry} = fakeNav("side");
		expect({result: processCombo("meta+'", registry, ctx, true), calls}).toStrictEqual({
			result: "claimed",
			calls: ["commit", "pane:home"],
		});
	});

	it("⌘' navigates the main outline home while the main pane is active", () => {
		const {calls, registry} = fakeNav("main");
		expect({result: processCombo("meta+'", registry, ctx, true), calls}).toStrictEqual({
			result: "claimed",
			calls: ["commit", "main-home"],
		});
	});

	it("⌘' navigates the main outline when the active pane id is stale and no pane is open", () => {
		const {calls, registry} = fakeNav("side", null);
		processCombo("meta+'", registry, ctx, true);
		expect(calls).toStrictEqual(["commit", "main-home"]);
	});

	it("⌃T opens today in the active side pane", () => {
		const {calls, registry} = fakeNav("side");
		processCombo("ctrl+t", registry, ctx, true);
		expect(calls).toStrictEqual(["pane-today"]);
	});

	it("⌃T opens today in the main outline while the main pane is active", () => {
		const {calls, registry} = fakeNav("main");
		processCombo("ctrl+t", registry, ctx, true);
		expect(calls).toStrictEqual(["main-today"]);
	});

	it("⇧⌘9 / ⇧⌘0 jump the active side pane to its zoom's siblings", () => {
		const {calls, registry} = fakeNav("side");
		processCombo("meta+shift+9", registry, ctx, true);
		processCombo("meta+shift+0", registry, ctx, true);
		expect(calls).toStrictEqual(["pane-sibling:-1", "pane-sibling:1"]);
	});

	it("⇧⌘9 / ⇧⌘0 jump the main outline while the main pane is active", () => {
		const {calls, registry} = fakeNav("main");
		processCombo("meta+shift+9", registry, ctx, true);
		processCombo("meta+shift+0", registry, ctx, true);
		expect(calls).toStrictEqual(["main-sibling:-1", "main-sibling:1"]);
	});

	it("Back / Forward step the active side pane's own history", () => {
		const {calls, registry} = fakeNav("side");
		registry.navigate_backward.execute(ctx);
		registry.navigate_forward.execute(ctx);
		expect(calls).toStrictEqual(["commit", "pane-back", "commit", "pane-forward"]);
	});

	it("Back / Forward step the main outline's history while the main pane is active", () => {
		const {calls, registry} = fakeNav("main");
		registry.navigate_backward.execute(ctx);
		registry.navigate_forward.execute(ctx);
		expect(calls).toStrictEqual(["commit", "main-back", "commit", "main-forward"]);
	});
});
