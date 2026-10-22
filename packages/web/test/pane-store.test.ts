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

interface PaneOverrides {
	zoomedId?: string | null;
	backLocations?: (string | null)[];
	forwardLocations?: (string | null)[];
	query?: string;
	expandedIds?: Set<string>;
}

function pane(id: string, overrides: PaneOverrides = {}) {
	return {
		id,
		zoomedId: null,
		backLocations: [],
		forwardLocations: [],
		query: "",
		expandedIds: new Set<string>(),
		...overrides,
	};
}

const PANE_ID = /^[A-Za-z0-9_-]{11}$/u;

beforeEach(() => {
	stubGlobals();
});

describe("pane store", () => {
	it("starts with no panes", async () => {
		const store = await loadStore();
		expect(store.getState().panes).toStrictEqual([]);
	});

	it("opens a pane zoomed to the given node under a fresh 11-character id", async () => {
		const store = await loadStore();
		const id = store.getState().openPane("alice");
		expect({valid: PANE_ID.test(id), panes: store.getState().panes}).toStrictEqual({
			valid: true,
			panes: [pane(id, {zoomedId: "alice"})],
		});
	});

	it("opens a pane at Home for a null zoom", async () => {
		const store = await loadStore();
		const id = store.getState().openPane(null);
		expect(store.getState().panes).toStrictEqual([pane(id)]);
	});

	it("appends each new pane after the last one by default, like upstream's New pane", async () => {
		const store = await loadStore();
		const a = store.getState().openPane("alice");
		const b = store.getState().openPane("bob");
		const c = store.getState().openPane("carol");
		expect(store.getState().panes.map((p) => [p.id, p.zoomedId])).toStrictEqual([
			[a, "alice"],
			[b, "bob"],
			[c, "carol"],
		]);
	});

	it("inserts a pane at the workspace index upstream counts with the main pane at 0", async () => {
		const store = await loadStore();
		const a = store.getState().openPane("alice");
		const b = store.getState().openPane("bob");
		const c = store.getState().openPane("carol", {index: 1});
		const d = store.getState().openPane("dave", {index: 3});
		const e = store.getState().openPane("eve", {index: 0});
		const f = store.getState().openPane("frank", {index: 99});
		expect(store.getState().panes.map((p) => p.id)).toStrictEqual([e, c, a, d, b, f]);
	});

	it("gives every pane a distinct id", async () => {
		const store = await loadStore();
		const ids = [null, "a", "b", "c"].map((zoom) => store.getState().openPane(zoom));
		const all = [store.getState().mainPaneUrlId, ...ids];
		expect(new Set(all).size).toBe(5);
	});

	it("zooms each pane independently of the main zoom and of the other panes", async () => {
		const store = await loadStore();
		store.getState().zoom("main-node");
		const a = store.getState().openPane("alice");
		const b = store.getState().openPane("bob");
		store.getState().zoomPane(a, "carol");
		expect({main: store.getState().zoomedNodeId, panes: store.getState().panes}).toStrictEqual({
			main: "main-node",
			panes: [pane(a, {zoomedId: "carol", backLocations: ["alice"]}), pane(b, {zoomedId: "bob"})],
		});
	});

	it("keeps each pane's own back and forward stacks, like upstream's payload backLocations/forwardLocations", async () => {
		const store = await loadStore();
		const a = store.getState().openPane(null);
		const b = store.getState().openPane("bob");
		store.getState().zoomPane(a, "alice");
		store.getState().zoomPane(a, "carol");
		store.getState().zoomPane(b, "dave");
		store.getState().paneBack(a);
		const afterBack = store.getState().panes;
		store.getState().paneBack(a);
		store.getState().paneForward(a);
		expect({afterBack, afterForward: store.getState().panes}).toStrictEqual({
			afterBack: [
				pane(a, {zoomedId: "alice", backLocations: [null], forwardLocations: ["carol"]}),
				pane(b, {zoomedId: "dave", backLocations: ["bob"]}),
			],
			afterForward: [
				pane(a, {zoomedId: "alice", backLocations: [null], forwardLocations: ["carol"]}),
				pane(b, {zoomedId: "dave", backLocations: ["bob"]}),
			],
		});
	});

	it("clears the forward stack on a new pane zoom and skips re-zooming to the same node", async () => {
		const store = await loadStore();
		const a = store.getState().openPane("alice");
		store.getState().zoomPane(a, "bob");
		store.getState().paneBack(a);
		store.getState().zoomPane(a, "carol");
		store.getState().zoomPane(a, "carol");
		expect(store.getState().panes).toStrictEqual([pane(a, {zoomedId: "carol", backLocations: ["alice"]})]);
	});

	it("ignores back and forward with empty stacks", async () => {
		const store = await loadStore();
		const a = store.getState().openPane("alice");
		store.getState().paneBack(a);
		store.getState().paneForward(a);
		expect(store.getState().panes).toStrictEqual([pane(a, {zoomedId: "alice"})]);
	});

	it("filters a pane by its own search query, leaving the main search and other panes alone", async () => {
		const store = await loadStore();
		const a = store.getState().openPane("alice");
		const b = store.getState().openPane("bob");
		store.getState().setPaneQuery(b, "#todo");
		expect({panes: store.getState().panes, main: store.getState().searchQuery}).toStrictEqual({
			panes: [pane(a, {zoomedId: "alice"}), pane(b, {zoomedId: "bob", query: "#todo"})],
			main: "",
		});
	});

	it("ends the pane search when the pane zooms elsewhere, like a new upstream location", async () => {
		const store = await loadStore();
		const a = store.getState().openPane("alice");
		store.getState().setPaneQuery(a, "#todo");
		store.getState().zoomPane(a, "bob");
		expect(store.getState().panes).toStrictEqual([pane(a, {zoomedId: "bob", backLocations: ["alice"]})]);
	});

	it("ignores zooms and searches for a pane that is not open", async () => {
		const store = await loadStore();
		store.getState().setPaneQuery("BBBBBBBBBBB", "#todo");
		store.getState().zoomPane("BBBBBBBBBBB", "bob");
		store.getState().paneBack("BBBBBBBBBBB");
		expect(store.getState().panes).toStrictEqual([]);
	});

	it("closes a middle pane, keeping the panes on either side in order", async () => {
		const store = await loadStore();
		const a = store.getState().openPane("alice");
		const b = store.getState().openPane("bob");
		const c = store.getState().openPane("carol");
		store.getState().closePane(b);
		expect(store.getState().panes.map((p) => p.id)).toStrictEqual([a, c]);
	});

	it("closes all panes", async () => {
		const store = await loadStore();
		store.getState().openPane("alice");
		store.getState().openPane("bob");
		store.getState().closeAllPanes();
		const {panes, mainPaneUrlId, activePaneId} = store.getState();
		expect({panes, mainPaneUrlId, activePaneId}).toStrictEqual({
			panes: [],
			mainPaneUrlId: null,
			activePaneId: "main",
		});
	});
});

describe("active pane", () => {
	it("starts on the main pane", async () => {
		const store = await loadStore();
		expect(store.getState().activePaneId).toBe("main");
	});

	it("activates a new pane and stops editing in the previous one", async () => {
		const store = await loadStore();
		store.getState().resumeEditing("carol", 3);
		const a = store.getState().openPane("alice");
		const {activePaneId, editingId, editingCaretOffset} = store.getState();
		expect({activePaneId, editingId, editingCaretOffset}).toStrictEqual({
			activePaneId: a,
			editingId: null,
			editingCaretOffset: null,
		});
	});

	it("switches the active pane among open panes", async () => {
		const store = await loadStore();
		const a = store.getState().openPane("alice");
		store.getState().openPane("bob");
		store.getState().setActivePane(a);
		const first = store.getState().activePaneId;
		store.getState().setActivePane("main");
		expect({first, second: store.getState().activePaneId}).toStrictEqual({first: a, second: "main"});
	});

	it("activates the most recently active remaining pane when the active pane closes, like upstream's focus history", async () => {
		const store = await loadStore();
		const a = store.getState().openPane("alice");
		const b = store.getState().openPane("bob");
		const c = store.getState().openPane("carol");
		store.getState().setActivePane(a);
		store.getState().setActivePane(c);
		store.getState().resumeEditing("dave", 0);
		store.getState().closePane(c);
		const {activePaneId, editingId} = store.getState();
		expect({activePaneId, editingId, b: b !== a}).toStrictEqual({activePaneId: a, editingId: null, b: true});
	});

	it("returns to the main pane when the last pane closes", async () => {
		const store = await loadStore();
		const a = store.getState().openPane("alice");
		store.getState().resumeEditing("bob", 0);
		store.getState().closePane(a);
		const {activePaneId, editingId, mainPaneUrlId} = store.getState();
		expect({activePaneId, editingId, mainPaneUrlId}).toStrictEqual({
			activePaneId: "main",
			editingId: null,
			mainPaneUrlId: null,
		});
	});

	it("keeps the active pane and its editing when an inactive pane closes", async () => {
		const store = await loadStore();
		const a = store.getState().openPane("alice");
		const b = store.getState().openPane("bob");
		store.getState().setActivePane(a);
		store.getState().resumeEditing("carol", 0);
		store.getState().closePane(b);
		const {activePaneId, editingId} = store.getState();
		expect({activePaneId, editingId}).toStrictEqual({activePaneId: a, editingId: "carol"});
	});

	it("ignores activating a pane that is not open", async () => {
		const store = await loadStore();
		store.getState().setActivePane("BBBBBBBBBBB");
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
		const a = store.getState().openPane("alice");
		store.getState().openPane("bob");
		const bobZoom = activeZoomedId(store.getState());
		store.getState().setActivePane(a);
		const view = activePaneView();
		store.getState().setActivePane("main");
		expect({
			mainZoom,
			bobZoom,
			viewZoom: view.zoomedNodeId,
			backToMain: activeZoomedId(store.getState()),
		}).toStrictEqual({
			mainZoom: "main-node",
			bobZoom: "bob",
			viewZoom: "alice",
			backToMain: "main-node",
		});
	});
});

describe("main pane URL id", () => {
	it("starts with none", async () => {
		const store = await loadStore();
		expect(store.getState().mainPaneUrlId).toBeNull();
	});

	it("gives the main pane an 11-character id once the first pane opens, and keeps it for later panes", async () => {
		const store = await loadStore();
		store.getState().openPane("alice");
		const first = store.getState().mainPaneUrlId;
		store.getState().openPane("bob");
		expect({valid: PANE_ID.test(first ?? ""), kept: store.getState().mainPaneUrlId === first}).toStrictEqual({
			valid: true,
			kept: true,
		});
	});
});

describe("closeMainPane", () => {
	it("makes the first pane the main pane: it takes the main id and leaves the list, the rest shift left", async () => {
		const store = await loadStore();
		const a = store.getState().openPane("alice");
		const b = store.getState().openPane("bob");
		const promoted = store.getState().closeMainPane();
		const {panes, mainPaneUrlId, activePaneId} = store.getState();
		expect({promoted, panes, mainPaneUrlId, activePaneId}).toStrictEqual({
			promoted: pane(a, {zoomedId: "alice"}),
			panes: [pane(b, {zoomedId: "bob"})],
			mainPaneUrlId: a,
			activePaneId: "main",
		});
	});

	it("returns to a single document when the only pane is promoted", async () => {
		const store = await loadStore();
		store.getState().openPane("alice");
		store.getState().closeMainPane();
		const {panes, mainPaneUrlId} = store.getState();
		expect({panes, mainPaneUrlId}).toStrictEqual({panes: [], mainPaneUrlId: null});
	});

	it("does nothing with no panes open", async () => {
		const store = await loadStore();
		expect(store.getState().closeMainPane()).toBeNull();
	});
});

describe("restorePanes", () => {
	const main = "AAAAAAAAAAA";
	const b = "BBBBBBBBBBB";
	const c = "CCCCCCCCCCC";

	it("opens every pane the URL names, in order, inactive, keeping main editing", async () => {
		const store = await loadStore();
		store.getState().resumeEditing("bob", 0);
		store.getState().restorePanes({
			mainPaneId: main,
			panes: [
				{id: b, zoomedId: "alice", query: null},
				{id: c, zoomedId: null, query: "todo"},
			],
			activePaneId: null,
		});
		const {panes, mainPaneUrlId, activePaneId, editingId} = store.getState();
		expect({panes, mainPaneUrlId, activePaneId, editingId}).toStrictEqual({
			panes: [pane(b, {zoomedId: "alice"}), pane(c, {query: "todo"})],
			mainPaneUrlId: main,
			activePaneId: "main",
			editingId: "bob",
		});
	});

	it("activates the named pane and stops editing", async () => {
		const store = await loadStore();
		store.getState().resumeEditing("bob", 0);
		store.getState().restorePanes({
			mainPaneId: main,
			panes: [
				{id: b, zoomedId: "alice", query: null},
				{id: c, zoomedId: null, query: null},
			],
			activePaneId: c,
		});
		const {activePaneId, editingId} = store.getState();
		expect({activePaneId, editingId}).toStrictEqual({activePaneId: c, editingId: null});
	});

	it("re-zooms open panes by id without touching their history and drops panes the URL no longer names", async () => {
		const store = await loadStore();
		store.getState().restorePanes({
			mainPaneId: main,
			panes: [
				{id: b, zoomedId: "alice", query: null},
				{id: c, zoomedId: "carol", query: null},
			],
			activePaneId: c,
		});
		store.getState().zoomPane(b, "bob");
		store.getState().restorePanes({
			mainPaneId: main,
			panes: [{id: b, zoomedId: "alice", query: null}],
			activePaneId: null,
		});
		const {panes, activePaneId} = store.getState();
		expect({panes, activePaneId}).toStrictEqual({
			panes: [pane(b, {zoomedId: "alice", backLocations: ["alice"]})],
			activePaneId: "main",
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

	it("seeds a new pane's expansion from the pane it opens from", async () => {
		stubFetch();
		const store = await loadStore();
		store.getState().setExpanded(new Set(["alice"]));
		const a = store.getState().openPane(null);
		store.getState().expand("bob");
		const b = store.getState().openPane(null, {sourcePaneId: a});
		const c = store.getState().openPane(null, {sourcePaneId: "main"});
		const byId = new Map(store.getState().panes.map((p) => [p.id, p.expandedIds]));
		expect([byId.get(a), byId.get(b), byId.get(c)]).toStrictEqual([
			new Set(["alice", "bob"]),
			new Set(["alice", "bob"]),
			new Set(["alice"]),
		]);
	});

	it("toggles a row only in the active pane and never saves a pane's expansion to the server", async () => {
		const bodies = stubFetch();
		const store = await loadStore();
		store.getState().setExpanded(new Set(["alice"]));
		const a = store.getState().openPane(null);
		const b = store.getState().openPane(null);
		store.getState().toggleExpand("alice");
		store.getState().expand("bob");
		store.getState().setActivePane(a);
		store.getState().expand("carol");
		const byId = new Map(store.getState().panes.map((p) => [p.id, p.expandedIds]));
		expect({main: store.getState().expandedIds, a: byId.get(a), b: byId.get(b), bodies}).toStrictEqual({
			main: new Set(["alice"]),
			a: new Set(["alice", "carol"]),
			b: new Set(["bob"]),
			bodies: [],
		});
	});

	it("toggles a row only in the main outline while it is active", async () => {
		stubFetch();
		const store = await loadStore();
		store.getState().openPane(null);
		store.getState().setActivePane("main");
		store.getState().toggleExpand("alice");
		expect({
			main: store.getState().expandedIds,
			pane: store.getState().panes[0]?.expandedIds,
		}).toStrictEqual({main: new Set(["alice"]), pane: new Set()});
	});

	it("keeps the pane's expansion across its zooms and history steps", async () => {
		stubFetch();
		const store = await loadStore();
		const a = store.getState().openPane(null);
		store.getState().expand("alice");
		store.getState().zoomPane(a, "bob");
		store.getState().paneBack(a);
		store.getState().paneForward(a);
		store.getState().setPaneQuery(a, "todo");
		expect(store.getState().panes[0]?.expandedIds).toStrictEqual(new Set(["alice"]));
	});

	it("reads each pane's expansion and the active pane's in its view", async () => {
		stubFetch();
		vi.resetModules();
		const {activePaneView, useOutlineStore: store} = await import("../src/client/stores/outline.js");
		const {paneExpandedIds} = await import("../src/client/pane-ids.js");
		store.getState().setExpanded(new Set(["main-row"]));
		const a = store.getState().openPane(null);
		store.getState().toggleExpand("main-row");
		store.getState().expand("pane-row");
		const paneView = activePaneView().expandedIds;
		store.getState().setActivePane("main");
		const state = store.getState();
		expect({
			main: paneExpandedIds(state, "main"),
			pane: paneExpandedIds(state, a),
			paneView,
			mainView: activePaneView().expandedIds,
		}).toStrictEqual({
			main: new Set(["main-row"]),
			pane: new Set(["pane-row"]),
			paneView: new Set(["pane-row"]),
			mainView: new Set(["main-row"]),
		});
	});

	it("reads the main expansion for a pane id that is not open", async () => {
		stubFetch();
		vi.resetModules();
		const {useOutlineStore: store} = await import("../src/client/stores/outline.js");
		const {paneExpandedIds} = await import("../src/client/pane-ids.js");
		store.getState().setExpanded(new Set(["alice"]));
		expect(paneExpandedIds(store.getState(), "BBBBBBBBBBB")).toStrictEqual(new Set(["alice"]));
	});

	it("seeds a pane restored from the URL from the main outline's expansion", async () => {
		stubFetch();
		const store = await loadStore();
		store.getState().setExpanded(new Set(["alice"]));
		store.getState().restorePanes({
			mainPaneId: "AAAAAAAAAAA",
			panes: [{id: "BBBBBBBBBBB", zoomedId: null, query: null}],
			activePaneId: null,
		});
		expect(store.getState().panes[0]?.expandedIds).toStrictEqual(new Set(["alice"]));
	});
});

describe("tag clicks route to the clicked pane's search", () => {
	async function load() {
		const store = await loadStore();
		const {togglePaneTagSearch} = await import("../src/client/hooks/use-commit-search.js");
		return {store, togglePaneTagSearch};
	}

	it("toggles a tag clicked in a pane into that pane's query, leaving the main search and other panes alone", async () => {
		const {store, togglePaneTagSearch} = await load();
		const a = store.getState().openPane("alice");
		const b = store.getState().openPane("bob");
		store.getState().setPaneQuery(b, "#work ");
		const navigate = vi.fn<(to: string) => void>();
		togglePaneTagSearch(b, "@bob", navigate);
		expect({
			queries: store.getState().panes.map((p) => [p.id, p.query]),
			main: store.getState().searchQuery,
			navigated: navigate.mock.calls,
		}).toStrictEqual({
			queries: [
				[a, ""],
				[b, "#work @bob "],
			],
			main: "",
			navigated: [],
		});
	});

	it("removes a tag clicked again in a pane from that pane's query", async () => {
		const {store, togglePaneTagSearch} = await load();
		const a = store.getState().openPane("alice");
		store.getState().setPaneQuery(a, "#work @bob ");
		togglePaneTagSearch(a, "@bob", vi.fn<(to: string) => void>());
		expect(store.getState().panes[0]?.query).toBe("#work ");
	});

	it("commits a tag clicked in the main pane as the main search, leaving the pane's query alone", async () => {
		const {store, togglePaneTagSearch} = await load();
		const a = store.getState().openPane("alice");
		store.getState().setPaneQuery(a, "#work ");
		const navigate = vi.fn<(to: string) => void>();
		togglePaneTagSearch("main", "@bob", navigate);
		const queries = navigate.mock.calls.map(([url]) => new URLSearchParams(url.split("#")[1]).get("q"));
		expect({pane: store.getState().panes[0]?.query, queries}).toStrictEqual({
			pane: "#work ",
			queries: ["@bob "],
		});
	});
});
