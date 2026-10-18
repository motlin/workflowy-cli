import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

const fetchMock = vi.fn<typeof fetch>();

function stubGlobals(): void {
	vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}, removeItem: () => {}});
	vi.stubGlobal("innerWidth", 1272);
	vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
	vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
	vi.stubGlobal("addEventListener", () => {});
	vi.stubGlobal("fetch", fetchMock);
}

async function loadModules() {
	vi.resetModules();
	const {useOutlineStore} = await import("../src/client/stores/outline.js");
	const {loadExpansion} = await import("../src/client/hooks/use-expansion-sync.js");
	return {store: useOutlineStore, loadExpansion};
}

function calls(): {url: unknown; method: unknown; body: unknown}[] {
	return fetchMock.mock.calls.map(([url, init]) => ({url, method: init?.method, body: init?.body}));
}

function patch(changes: Record<string, boolean>) {
	return {url: "/api/v1/expansion", method: "PATCH", body: JSON.stringify({changes})};
}

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockImplementation(async () => Promise.resolve(new Response(null, {status: 204})));
	stubGlobals();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("expansion deltas", () => {
	it("expand then toggleExpand send one delta each", async () => {
		const {store} = await loadModules();
		store.getState().expand("a");
		store.getState().toggleExpand("a");
		expect({expandedIds: store.getState().expandedIds, calls: calls()}).toStrictEqual({
			expandedIds: new Set(),
			calls: [patch({a: true}), patch({a: false})],
		});
	});

	it("collapseAll sends false for every expanded id", async () => {
		const {store} = await loadModules();
		store.getState().expandAll(["a", "b"]);
		fetchMock.mockClear();
		store.getState().collapseAll();
		expect(calls()).toStrictEqual([patch({a: false, b: false})]);
	});

	it("sends nothing when the set does not change", async () => {
		const {store} = await loadModules();
		store.getState().expand("a");
		fetchMock.mockClear();
		store.getState().expand("a");
		store.getState().collapse("b");
		expect(calls()).toStrictEqual([]);
	});

	it("stops sending after a 503 PATCH", async () => {
		const {store} = await loadModules();
		fetchMock.mockImplementation(async () =>
			Promise.resolve(Response.json({error: "not configured"}, {status: 503})),
		);
		store.getState().expand("a");
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalledOnce();
		});
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
		store.getState().expand("b");
		expect({expandedIds: store.getState().expandedIds, calls: calls()}).toStrictEqual({
			expandedIds: new Set(["a", "b"]),
			calls: [patch({a: true})],
		});
	});
});

describe("loadExpansion", () => {
	it("hydrates expandedIds from GET without sending a PATCH", async () => {
		const {store, loadExpansion} = await loadModules();
		fetchMock.mockImplementation(async () => Promise.resolve(Response.json({expandedIds: ["a", "b"]})));
		await loadExpansion();
		expect({expandedIds: store.getState().expandedIds, calls: calls()}).toStrictEqual({
			expandedIds: new Set(["a", "b"]),
			calls: [{url: "/api/v1/expansion", method: undefined, body: undefined}],
		});
	});

	it("shares one GET between repeated loads, as StrictMode's double effect does", async () => {
		const {store, loadExpansion} = await loadModules();
		fetchMock.mockImplementation(async () => Promise.resolve(Response.json({expandedIds: ["a"]})));
		await Promise.all([loadExpansion(), loadExpansion()]);
		await loadExpansion();
		expect({expandedIds: store.getState().expandedIds, calls: calls()}).toStrictEqual({
			expandedIds: new Set(["a"]),
			calls: [{url: "/api/v1/expansion", method: undefined, body: undefined}],
		});
	});

	it("leaves an empty set on 503 and keeps later changes in memory", async () => {
		const {store, loadExpansion} = await loadModules();
		fetchMock.mockImplementation(async () =>
			Promise.resolve(Response.json({error: "not configured"}, {status: 503})),
		);
		await loadExpansion();
		const afterLoad = new Set(store.getState().expandedIds);
		store.getState().expand("a");
		expect({afterLoad, expandedIds: store.getState().expandedIds, calls: calls()}).toStrictEqual({
			afterLoad: new Set(),
			expandedIds: new Set(["a"]),
			calls: [{url: "/api/v1/expansion", method: undefined, body: undefined}],
		});
	});
});
