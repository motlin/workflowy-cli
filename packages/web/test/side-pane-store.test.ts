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
		expect(store.getState().sidePane).toStrictEqual({
			zoomedId: "alice",
			backLocations: [],
			forwardLocations: [],
			query: "",
			expandedIds: new Set(),
		});
	});

	it("opens a side pane at Home for a null zoom", async () => {
		const store = await loadStore();
		store.getState().openSidePane(null);
		expect(store.getState().sidePane).toStrictEqual({
			zoomedId: null,
			backLocations: [],
			forwardLocations: [],
			query: "",
			expandedIds: new Set(),
		});
	});

	it("zooms the open side pane independently of the main zoom", async () => {
		const store = await loadStore();
		store.getState().zoom("main-node");
		store.getState().openSidePane("alice");
		store.getState().zoomSidePane("bob");
		expect({main: store.getState().zoomedNodeId, pane: store.getState().sidePane}).toStrictEqual({
			main: "main-node",
			pane: {zoomedId: "bob", backLocations: ["alice"], forwardLocations: [], query: "", expandedIds: new Set()},
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
			afterBack: {
				zoomedId: "alice",
				backLocations: [null],
				forwardLocations: ["bob"],
				query: "",
				expandedIds: new Set(),
			},
			atStart: {
				zoomedId: null,
				backLocations: [],
				forwardLocations: ["alice", "bob"],
				query: "",
				expandedIds: new Set(),
			},
			afterForward: {
				zoomedId: "alice",
				backLocations: [null],
				forwardLocations: ["bob"],
				query: "",
				expandedIds: new Set(),
			},
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
			query: "",
			expandedIds: new Set(),
		});
	});

	it("ignores back and forward with empty stacks", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		store.getState().sidePaneBack();
		store.getState().sidePaneForward();
		expect(store.getState().sidePane).toStrictEqual({
			zoomedId: "alice",
			backLocations: [],
			forwardLocations: [],
			query: "",
			expandedIds: new Set(),
		});
	});

	it("filters the pane by its own search query, leaving the main search alone", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		store.getState().setSidePaneQuery("#todo");
		expect({pane: store.getState().sidePane, main: store.getState().searchQuery}).toStrictEqual({
			pane: {zoomedId: "alice", backLocations: [], forwardLocations: [], query: "#todo", expandedIds: new Set()},
			main: "",
		});
	});

	it("ends the pane search when the pane zooms elsewhere, like a new upstream location", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		store.getState().setSidePaneQuery("#todo");
		store.getState().zoomSidePane("bob");
		expect(store.getState().sidePane).toStrictEqual({
			zoomedId: "bob",
			backLocations: ["alice"],
			forwardLocations: [],
			query: "",
			expandedIds: new Set(),
		});
	});

	it("ignores a pane search when no pane is open", async () => {
		const store = await loadStore();
		store.getState().setSidePaneQuery("#todo");
		expect(store.getState().sidePane).toBeNull();
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
			sidePane: {zoomedId: "alice", backLocations: [], forwardLocations: [], query: "", expandedIds: new Set()},
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

	it("restores the pane's search query from the URL", async () => {
		const store = await loadStore();
		store.getState().restoreSidePane({zoomedId: "alice", query: "todo", ids, active: false});
		expect(store.getState().sidePane).toStrictEqual({
			zoomedId: "alice",
			backLocations: [],
			forwardLocations: [],
			query: "todo",
			expandedIds: new Set(),
		});
	});

	it("re-zooms an open pane without touching its history", async () => {
		const store = await loadStore();
		store.getState().openSidePane("alice");
		store.getState().zoomSidePane("bob");
		store.getState().restoreSidePane({zoomedId: "alice", ids, active: true});
		const {sidePane, paneUrlIds} = store.getState();
		expect({sidePane, paneUrlIds}).toStrictEqual({
			sidePane: {
				zoomedId: "alice",
				backLocations: ["alice"],
				forwardLocations: [],
				query: "",
				expandedIds: new Set(),
			},
			paneUrlIds: ids,
		});
	});
});

describe("per-pane expansion", () => {
	function stubFetch(): string[] {
		const bodies: string[] = [];
		vi.stubGlobal("fetch", async (_url: string, init?: {body?: string}) => {
			bodies.push(init?.body ?? "");
			return Promise.resolve({ok: true, status: 200});
		});
		return bodies;
	}

	it("seeds a new pane's expansion from the main outline's", async () => {
		stubFetch();
		const store = await loadStore();
		store.getState().setExpanded(new Set(["alice"]));
		store.getState().openSidePane(null);
		expect(store.getState().sidePane?.expandedIds).toStrictEqual(new Set(["alice"]));
	});

	it("toggles a row only in the active side pane and never saves it to the server", async () => {
		const bodies = stubFetch();
		const store = await loadStore();
		store.getState().setExpanded(new Set(["alice"]));
		store.getState().openSidePane(null);
		store.getState().toggleExpand("alice");
		store.getState().expand("bob");
		store.getState().replaceExpanded(new Set([...(store.getState().sidePane?.expandedIds ?? []), "carol"]));
		store.getState().collapse("bob");
		expect({
			main: store.getState().expandedIds,
			pane: store.getState().sidePane?.expandedIds,
			bodies,
		}).toStrictEqual({main: new Set(["alice"]), pane: new Set(["carol"]), bodies: []});
	});

	it("toggles a row only in the main outline while it is active", async () => {
		stubFetch();
		const store = await loadStore();
		store.getState().openSidePane(null);
		store.getState().setActivePane("main");
		store.getState().toggleExpand("alice");
		expect({
			main: store.getState().expandedIds,
			pane: store.getState().sidePane?.expandedIds,
		}).toStrictEqual({main: new Set(["alice"]), pane: new Set()});
	});

	it("keeps the pane's expansion across its zooms and history steps", async () => {
		stubFetch();
		const store = await loadStore();
		store.getState().openSidePane(null);
		store.getState().expand("alice");
		store.getState().zoomSidePane("bob");
		store.getState().sidePaneBack();
		store.getState().sidePaneForward();
		store.getState().setSidePaneQuery("todo");
		expect(store.getState().sidePane?.expandedIds).toStrictEqual(new Set(["alice"]));
	});

	it("reads each pane's expansion and the active pane's in its view", async () => {
		stubFetch();
		vi.resetModules();
		const {activePaneView, useOutlineStore: store} = await import("../src/client/stores/outline.js");
		const {paneExpandedIds} = await import("../src/client/pane-ids.js");
		store.getState().setExpanded(new Set(["main-row"]));
		store.getState().openSidePane(null);
		store.getState().toggleExpand("main-row");
		store.getState().expand("pane-row");
		const sideView = activePaneView().expandedIds;
		store.getState().setActivePane("main");
		const state = store.getState();
		expect({
			main: paneExpandedIds(state, "main"),
			side: paneExpandedIds(state, "side"),
			sideView,
			mainView: activePaneView().expandedIds,
		}).toStrictEqual({
			main: new Set(["main-row"]),
			side: new Set(["pane-row"]),
			sideView: new Set(["pane-row"]),
			mainView: new Set(["main-row"]),
		});
	});

	it("reads the main expansion for the side pane id once the pane closed", async () => {
		stubFetch();
		vi.resetModules();
		const {useOutlineStore: store} = await import("../src/client/stores/outline.js");
		const {paneExpandedIds} = await import("../src/client/pane-ids.js");
		store.getState().setExpanded(new Set(["alice"]));
		expect(paneExpandedIds(store.getState(), "side")).toStrictEqual(new Set(["alice"]));
	});

	it("seeds a pane restored from the URL from the main outline's expansion", async () => {
		stubFetch();
		const store = await loadStore();
		store.getState().setExpanded(new Set(["alice"]));
		store.getState().restoreSidePane({
			zoomedId: null,
			ids: {mainPaneId: "AAAAAAAAAAA", paneId: "BBBBBBBBBBB"},
			active: false,
		});
		expect(store.getState().sidePane?.expandedIds).toStrictEqual(new Set(["alice"]));
	});
});

describe("tag clicks route to the clicked pane's search", () => {
	async function load() {
		const store = await loadStore();
		const {togglePaneTagSearch} = await import("../src/client/hooks/use-commit-search.js");
		return {store, togglePaneTagSearch};
	}

	it("toggles a tag clicked in the side pane into the side pane's query, leaving the main search alone", async () => {
		const {store, togglePaneTagSearch} = await load();
		store.getState().openSidePane("alice");
		store.getState().setSidePaneQuery("#work ");
		const navigate = vi.fn<(to: string) => void>();
		togglePaneTagSearch("side", "@bob", navigate);
		expect({
			pane: store.getState().sidePane?.query,
			main: store.getState().searchQuery,
			navigated: navigate.mock.calls,
		}).toStrictEqual({
			pane: "#work @bob ",
			main: "",
			navigated: [],
		});
	});

	it("removes a tag clicked again in the side pane from the side pane's query", async () => {
		const {store, togglePaneTagSearch} = await load();
		store.getState().openSidePane("alice");
		store.getState().setSidePaneQuery("#work @bob ");
		togglePaneTagSearch("side", "@bob", vi.fn<(to: string) => void>());
		expect(store.getState().sidePane?.query).toBe("#work ");
	});

	it("commits a tag clicked in the main pane as the main search, leaving the side pane's query alone", async () => {
		const {store, togglePaneTagSearch} = await load();
		store.getState().openSidePane("alice");
		store.getState().setSidePaneQuery("#work ");
		const navigate = vi.fn<(to: string) => void>();
		togglePaneTagSearch("main", "@bob", navigate);
		const queries = navigate.mock.calls.map(([url]) => new URLSearchParams(url.split("#")[1]).get("q"));
		expect({pane: store.getState().sidePane?.query, queries}).toStrictEqual({pane: "#work ", queries: ["@bob "]});
	});
});
