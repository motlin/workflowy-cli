import {beforeEach, describe, expect, it, vi} from "vite-plus/test";

function stubGlobals(): void {
	vi.stubGlobal("localStorage", {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
	});
	vi.stubGlobal("innerWidth", 1272);
	vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
	vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
	vi.stubGlobal("addEventListener", () => {});
}

async function loadStore() {
	vi.resetModules();
	const {useOutlineStore} = await import("../src/client/stores/outline.js");
	return useOutlineStore;
}

beforeEach(() => {
	stubGlobals();
});

describe("side pane store", () => {
	it("starts with no side pane", async () => {
		const store = await loadStore();
		expect(store.getState().sidePane).toBeNull();
	});

	it("opens a side pane zoomed to the given node", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		expect(store.getState().sidePane).toStrictEqual({zoomedId: "alice"});
	});

	it("opens a side pane at Home for a null zoom", async () => {
		const store = await loadStore();
		store.getState().openSidePane(null);
		expect(store.getState().sidePane).toStrictEqual({zoomedId: null});
	});

	it("zooms the open side pane independently of the main zoom", async () => {
		const store = await loadStore();
		store.getState().zoom("main-node");
		store.getState().openSidePane("alice");
		store.getState().zoomSidePane("bob");
		expect({main: store.getState().zoomedNodeId, pane: store.getState().sidePane}).toStrictEqual({
			main: "main-node",
			pane: {zoomedId: "bob"},
		});
	});

	it("ignores a pane zoom when no pane is open", async () => {
		const store = await loadStore();
		store.getState().zoomSidePane("bob");
		expect(store.getState().sidePane).toBeNull();
	});

	it("closes the side pane", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		store.getState().closeSidePane();
		expect(store.getState().sidePane).toBeNull();
	});
});
