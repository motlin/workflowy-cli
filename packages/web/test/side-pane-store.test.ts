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

describe("active pane", () => {
	it("starts on the main pane", async () => {
		const store = await loadStore();
		expect(store.getState().activePaneId).toBe("main");
	});

	it("activates a new side pane and stops editing in the main one", async () => {
		const store = await loadStore();
		store.getState().resumeEditing("carol", 3);
		store.getState().openSidePane("alice");
		const {activePaneId, editingId, editingCaretOffset} = store.getState();
		expect({activePaneId, editingId, editingCaretOffset}).toStrictEqual({
			activePaneId: "side",
			editingId: null,
			editingCaretOffset: null,
		});
	});

	it("switches the active pane", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		store.getState().setActivePane("main");
		expect(store.getState().activePaneId).toBe("main");
	});

	it("returns to the main pane and stops editing when the active side pane closes", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		store.getState().resumeEditing("bob", 0);
		store.getState().closeSidePane();
		const {activePaneId, editingId} = store.getState();
		expect({activePaneId, editingId}).toStrictEqual({activePaneId: "main", editingId: null});
	});

	it("keeps main editing when an inactive side pane closes", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		store.getState().setActivePane("main");
		store.getState().resumeEditing("bob", 0);
		store.getState().closeSidePane();
		const {activePaneId, editingId} = store.getState();
		expect({activePaneId, editingId}).toStrictEqual({activePaneId: "main", editingId: "bob"});
	});

	it("ignores activating the side pane when none is open", async () => {
		const store = await loadStore();
		store.getState().setActivePane("side");
		expect(store.getState().activePaneId).toBe("main");
	});

	it("reads the active pane's zoom", async () => {
		vi.resetModules();
		const {
			activeZoomedId,
			activePaneView,
			useOutlineStore: store,
		} = await import("../src/client/stores/outline.js");
		store.getState().zoom("main-node");
		const mainZoom = activeZoomedId(store.getState());
		store.getState().openSidePane("alice");
		const sideZoom = activeZoomedId(store.getState());
		const view = activePaneView();
		store.getState().setActivePane("main");
		expect({
			mainZoom,
			sideZoom,
			viewZoom: view.zoomedNodeId,
			backToMain: activeZoomedId(store.getState()),
		}).toStrictEqual({
			mainZoom: "main-node",
			sideZoom: "alice",
			viewZoom: "alice",
			backToMain: "main-node",
		});
	});
});
