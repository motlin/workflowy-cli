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

	it("replaceExpanded sends the whole delta in one PATCH", async () => {
		const {store} = await loadModules();
		store.getState().replaceExpanded(new Set(["a", "b"]));
		fetchMock.mockClear();
		store.getState().replaceExpanded(new Set(["c"]));
		expect(calls()).toStrictEqual([patch({c: true, a: false, b: false})]);
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

describe("refreshExpansion", () => {
	const GET = {url: "/api/v1/expansion", method: undefined, body: undefined};

	async function loaded(ids: string[]) {
		const modules = await loadModules();
		const {refreshExpansion} = await import("../src/client/hooks/use-expansion-sync.js");
		fetchMock.mockImplementation(async () => Promise.resolve(Response.json({expandedIds: ids})));
		await modules.loadExpansion(0);
		fetchMock.mockClear();
		return {...modules, refreshExpansion};
	}

	function serve(ids: string[]): void {
		fetchMock.mockImplementation(async () => Promise.resolve(Response.json({expandedIds: ids})));
	}

	it("applies server-side changes without PATCHing them back", async () => {
		const {store, refreshExpansion} = await loaded(["a", "b"]);
		serve(["b", "c"]);
		await refreshExpansion(30_000);
		expect({expandedIds: store.getState().expandedIds, calls: calls()}).toStrictEqual({
			expandedIds: new Set(["b", "c"]),
			calls: [GET],
		});
	});

	it("keeps the same set instance when nothing changed", async () => {
		const {store, refreshExpansion} = await loaded(["a"]);
		const before = store.getState().expandedIds;
		await refreshExpansion(30_000);
		expect({same: store.getState().expandedIds === before, calls: calls()}).toStrictEqual({
			same: true,
			calls: [GET],
		});
	});

	it("fetches at most once per 30s, counting the initial load", async () => {
		const {refreshExpansion} = await loaded(["a"]);
		await refreshExpansion(29_999);
		await refreshExpansion(30_000);
		await refreshExpansion(59_999);
		await refreshExpansion(60_000);
		expect(calls()).toStrictEqual([GET, GET]);
	});

	it("discards a response when a local change happened while it was in flight", async () => {
		const {store, refreshExpansion} = await loaded(["a"]);
		let resolve: (response: Response) => void = () => {};
		fetchMock.mockImplementationOnce(
			async () =>
				new Promise<Response>((r) => {
					resolve = r;
				}),
		);
		const refreshing = refreshExpansion(30_000);
		store.getState().expand("z");
		resolve(Response.json({expandedIds: []}));
		await refreshing;
		expect(store.getState().expandedIds).toStrictEqual(new Set(["a", "z"]));
	});

	it("skips the fetch shortly after a local change the server may not have pushed yet", async () => {
		vi.spyOn(Date, "now").mockReturnValue(28_000);
		const {store, refreshExpansion} = await loaded(["a"]);
		store.getState().expand("z");
		fetchMock.mockClear();
		await refreshExpansion(30_000);
		vi.restoreAllMocks();
		expect({expandedIds: store.getState().expandedIds, calls: calls()}).toStrictEqual({
			expandedIds: new Set(["a", "z"]),
			calls: [],
		});
	});

	it("does nothing once expansion persistence is disabled", async () => {
		const {refreshExpansion} = await loadModules().then(async (m) => ({
			...m,
			...(await import("../src/client/hooks/use-expansion-sync.js")),
		}));
		fetchMock.mockImplementation(async () =>
			Promise.resolve(Response.json({error: "not configured"}, {status: 503})),
		);
		await refreshExpansion(0);
		fetchMock.mockClear();
		await refreshExpansion(60_000);
		expect(calls()).toStrictEqual([]);
	});
});
