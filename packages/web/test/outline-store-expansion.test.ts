import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

const fetchMock = vi.fn<typeof fetch>();

function stubGlobals(): void {
	vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}, removeItem: () => {}});
	vi.stubGlobal("innerWidth", 1272);
	vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
	vi.stubGlobal("document", {
		documentElement: {dataset: {}},
		body: {classList: {toggle: () => true, contains: () => false}},
	});
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

	it("retries a page-load GET through an API restart (502, refused connection) without logging", async () => {
		const {store, loadExpansion} = await loadModules();
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.useFakeTimers();
		fetchMock
			.mockImplementationOnce(async () => Promise.resolve(new Response("Bad Gateway", {status: 502})))
			.mockImplementationOnce(async () => Promise.reject(new TypeError("Failed to fetch")))
			.mockImplementationOnce(async () => Promise.resolve(Response.json({expandedIds: ["a"]})));
		const loading = loadExpansion();
		await vi.runAllTimersAsync();
		await loading;
		const logged = [...errors.mock.calls];
		vi.useRealTimers();
		errors.mockRestore();
		expect({expandedIds: store.getState().expandedIds, calls: calls(), errors: logged}).toStrictEqual({
			expandedIds: new Set(["a"]),
			calls: [
				{url: "/api/v1/expansion", method: undefined, body: undefined},
				{url: "/api/v1/expansion", method: undefined, body: undefined},
				{url: "/api/v1/expansion", method: undefined, body: undefined},
			],
			errors: [],
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
	/** Focus asks for fresh keys so a change made on workflowy.com shows on the first focus. */
	const GET = {url: "/api/v1/expansion?fresh=1", method: undefined, body: undefined};

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

describe("expansion refresh follow-ups", () => {
	const GET = {url: "/api/v1/expansion", method: undefined, body: undefined};
	const WAIT = {url: "/api/v1/expansion?wait=1", method: undefined, body: undefined};

	it("collects a background refresh with one ?wait=1 follow-up when the page-load answer is refreshing", async () => {
		const {store, loadExpansion} = await loadModules();
		fetchMock
			.mockImplementationOnce(async () => Promise.resolve(Response.json({expandedIds: ["a"], refreshing: true})))
			.mockImplementationOnce(async () => Promise.resolve(Response.json({expandedIds: ["a", "b"]})));
		await loadExpansion();
		expect({expandedIds: store.getState().expandedIds, calls: calls()}).toStrictEqual({
			expandedIds: new Set(["a", "b"]),
			calls: [GET, WAIT],
		});
	});

	it("does not apply the follow-up when a local change landed between the two GETs", async () => {
		const {store, loadExpansion} = await loadModules();
		fetchMock
			.mockImplementationOnce(async () => Promise.resolve(Response.json({expandedIds: ["a"], refreshing: true})))
			.mockImplementationOnce(async () => {
				store.getState().expand("z");
				return Promise.resolve(Response.json({expandedIds: ["a", "b"]}));
			});
		await loadExpansion();
		const afterLoad = store.getState().expandedIds;
		expect(afterLoad).toStrictEqual(new Set(["a", "z"]));
	});

	it("sends the last ETag on refresh GETs and treats a 304 as a no-op", async () => {
		const {store, loadExpansion} = await loadModules();
		const {refreshExpansion} = await import("../src/client/hooks/use-expansion-sync.js");
		fetchMock.mockImplementationOnce(async () =>
			Promise.resolve(Response.json({expandedIds: ["a"]}, {headers: {etag: '"f1"'}})),
		);
		await loadExpansion(0);
		fetchMock.mockClear();
		fetchMock.mockImplementationOnce(async () => Promise.resolve(new Response(null, {status: 304})));
		await refreshExpansion(30_000);
		const [[, init]] = fetchMock.mock.calls;
		expect({
			expandedIds: store.getState().expandedIds,
			ifNoneMatch: new Headers(init?.headers).get("if-none-match"),
			count: fetchMock.mock.calls.length,
		}).toStrictEqual({expandedIds: new Set(["a"]), ifNoneMatch: '"f1"', count: 1});
	});

	it("aborts a GET that has not answered in 30s and keeps the expanded set", async () => {
		const {store, loadExpansion} = await loadModules();
		const {refreshExpansion} = await import("../src/client/hooks/use-expansion-sync.js");
		fetchMock.mockImplementationOnce(async () => Promise.resolve(Response.json({expandedIds: ["a"]})));
		await loadExpansion(0);
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.useFakeTimers();
		fetchMock.mockImplementationOnce(
			async (_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(new DOMException("aborted", "AbortError"));
					});
				}),
		);
		let settled = false;
		const refreshing = refreshExpansion(30_000).then(() => {
			settled = true;
			return settled;
		});
		await vi.advanceTimersByTimeAsync(29_999);
		const early = settled;
		await vi.advanceTimersByTimeAsync(1);
		await refreshing;
		vi.useRealTimers();
		const logged = errors.mock.calls.length;
		errors.mockRestore();
		expect({early, settled, expandedIds: store.getState().expandedIds, logged}).toStrictEqual({
			early: false,
			settled: true,
			expandedIds: new Set(["a"]),
			logged: 1,
		});
	});
});

describe("expansion polling", () => {
	async function polling(hasFocus: boolean) {
		const modules = await loadModules();
		const {startExpansionPolling, EXPANSION_POLL_MS} = await import("../src/client/hooks/use-expansion-sync.js");
		vi.stubGlobal("document", {visibilityState: "visible", hasFocus: () => hasFocus});
		fetchMock.mockImplementation(async () => Promise.resolve(Response.json({expandedIds: ["a"]})));
		await modules.loadExpansion(0);
		fetchMock.mockClear();
		return {startExpansionPolling, EXPANSION_POLL_MS};
	}

	it("refreshes with ?fresh=1 every 120s while the tab is visible and focused", async () => {
		const {startExpansionPolling, EXPANSION_POLL_MS} = await polling(true);
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		const stop = startExpansionPolling();
		await vi.advanceTimersByTimeAsync(EXPANSION_POLL_MS);
		stop();
		vi.useRealTimers();
		expect({period: EXPANSION_POLL_MS, calls: calls().map((c) => c.url)}).toStrictEqual({
			period: 120_000,
			calls: ["/api/v1/expansion?fresh=1"],
		});
	});

	it("does not refresh while the tab lacks focus", async () => {
		const {startExpansionPolling, EXPANSION_POLL_MS} = await polling(false);
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		const stop = startExpansionPolling();
		await vi.advanceTimersByTimeAsync(EXPANSION_POLL_MS * 2);
		stop();
		vi.useRealTimers();
		expect(calls()).toStrictEqual([]);
	});
});
