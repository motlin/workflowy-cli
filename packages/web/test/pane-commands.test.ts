import {describe, expect, it} from "vite-plus/test";
import {processCombo} from "../src/client/keys/dispatch.js";
import {paneCommands} from "../src/client/pane-commands.js";
import type {PaneCommandStore} from "../src/client/pane-commands.js";

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
