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
		expect(store.getState().sidePane).toStrictEqual({zoomedId: "alice", backLocations: [], forwardLocations: []});
	});

	it("opens a side pane at Home for a null zoom", async () => {
		const store = await loadStore();
		store.getState().openSidePane(null);
		expect(store.getState().sidePane).toStrictEqual({zoomedId: null, backLocations: [], forwardLocations: []});
	});

	it("zooms the open side pane independently of the main zoom", async () => {
		const store = await loadStore();
		store.getState().zoom("main-node");
		store.getState().openSidePane("alice");
		store.getState().zoomSidePane("bob");
		expect({main: store.getState().zoomedNodeId, pane: store.getState().sidePane}).toStrictEqual({
			main: "main-node",
			pane: {zoomedId: "bob", backLocations: ["alice"], forwardLocations: []},
		});
	});

	it("keeps its own back and forward stacks, like upstream's payload backLocations/forwardLocations", async () => {
		const store = await loadStore();
		store.getState().openSidePane(null);
		store.getState().zoomSidePane("alice");
		store.getState().zoomSidePane("bob");
		store.getState().sidePaneBack();
		const afterBack = store.getState().sidePane;
		store.getState().sidePaneBack();
		const atStart = store.getState().sidePane;
		store.getState().sidePaneForward();
		const afterForward = store.getState().sidePane;
		expect({afterBack, atStart, afterForward}).toStrictEqual({
			afterBack: {zoomedId: "alice", backLocations: [null], forwardLocations: ["bob"]},
			atStart: {zoomedId: null, backLocations: [], forwardLocations: ["alice", "bob"]},
			afterForward: {zoomedId: "alice", backLocations: [null], forwardLocations: ["bob"]},
		});
	});

	it("clears the forward stack on a new pane zoom and skips re-zooming to the same node", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		store.getState().zoomSidePane("bob");
		store.getState().sidePaneBack();
		store.getState().zoomSidePane("carol");
		store.getState().zoomSidePane("carol");
		expect(store.getState().sidePane).toStrictEqual({
			zoomedId: "carol",
			backLocations: ["alice"],
			forwardLocations: [],
		});
	});

	it("ignores back and forward with empty stacks", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		store.getState().sidePaneBack();
		store.getState().sidePaneForward();
		expect(store.getState().sidePane).toStrictEqual({zoomedId: "alice", backLocations: [], forwardLocations: []});
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

describe("pane URL ids", () => {
	it("starts with none", async () => {
		const store = await loadStore();
		expect(store.getState().paneUrlIds).toBeNull();
	});

	it("gives a new side pane and the main pane distinct 11-character ids", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		const ids = store.getState().paneUrlIds;
		expect({
			main: /^[A-Za-z0-9_-]{11}$/u.test(ids?.mainPaneId ?? ""),
			side: /^[A-Za-z0-9_-]{11}$/u.test(ids?.paneId ?? ""),
			distinct: ids?.mainPaneId !== ids?.paneId,
		}).toStrictEqual({main: true, side: true, distinct: true});
	});

	it("drops them when the side pane closes", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		store.getState().closeSidePane();
		expect(store.getState().paneUrlIds).toBeNull();
	});
});

describe("restoreSidePane", () => {
	const ids = {mainPaneId: "AAAAAAAAAAA", paneId: "BBBBBBBBBBB"};

	it("opens the pane from the URL with its ids, inactive, keeping main editing", async () => {
		const store = await loadStore();
		store.getState().resumeEditing("bob", 0);
		store.getState().restoreSidePane({zoomedId: "alice", ids, active: false});
		const {sidePane, paneUrlIds, activePaneId, editingId} = store.getState();
		expect({sidePane, paneUrlIds, activePaneId, editingId}).toStrictEqual({
			sidePane: {zoomedId: "alice", backLocations: [], forwardLocations: []},
			paneUrlIds: ids,
			activePaneId: "main",
			editingId: "bob",
		});
	});

	it("activates the restored pane and stops editing when asked", async () => {
		const store = await loadStore();
		store.getState().resumeEditing("bob", 0);
		store.getState().restoreSidePane({zoomedId: null, ids, active: true});
		const {activePaneId, editingId} = store.getState();
		expect({activePaneId, editingId}).toStrictEqual({activePaneId: "side", editingId: null});
	});

	it("re-zooms an open pane without touching its history", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		store.getState().zoomSidePane("bob");
		store.getState().restoreSidePane({zoomedId: "alice", ids, active: true});
		const {sidePane, paneUrlIds} = store.getState();
		expect({sidePane, paneUrlIds}).toStrictEqual({
			sidePane: {zoomedId: "alice", backLocations: ["alice"], forwardLocations: []},
			paneUrlIds: ids,
		});
	});
});
