import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {WorkflowyInternalClient} from "../src/api/workflowy-internal-client.js";
import {CacheService} from "../src/cache/cache-service.js";
import {replaceTreeTxId} from "../src/cache/tree-transaction.js";
import * as schema from "../src/db/schema.js";
import {WorkflowyInternalAdapter} from "../src/internal/adapter.js";
import type {WorkflowyNode} from "../src/types/index.js";
import {createFakeInternalApi, json, treeDataReads} from "./helpers/fake-internal-api.js";
import type {RecordedRequest} from "./helpers/fake-internal-api.js";

const migrationsFolder = join(import.meta.dirname, "../src/db/migrations");
const START_MS = 1_800_000_000_000;

const ALPHA = "1a2b3c4d-0000-4000-8000-000000000001";
const BRAVO = "5e6f7a8b-0000-4000-8000-000000000002";
/** Shares ALPHA's first 8 chars, so the server's key expands both, as upstream. */
const ALPHA_TWIN = "1a2b3c4d-0000-4000-8000-000000000003";
const CHARLIE = "9c9c9c9c-0000-4000-8000-000000000004";

function cachedNode(id: string): WorkflowyNode {
	return {id, name: id, note: null, parent_id: null, priority: 0, createdAt: 0, modifiedAt: 0};
}

function treeData(expandedKeys: string[]): Response {
	return json({
		items: [],
		shared_projects: {},
		most_recent_operation_transaction_id: "9999",
		server_expanded_projects_list: expandedKeys,
	});
}

function setup() {
	const sqlite = new DatabaseConstructor(":memory:");
	const db = drizzle(sqlite, {schema});
	migrate(db, {migrationsFolder});
	// A whole-tree import seeded the transaction-log position at the fake init's id.
	replaceTreeTxId(db, "4567", 0);
	const cacheService = new CacheService(db);
	for (const id of [ALPHA, BRAVO, ALPHA_TWIN, CHARLIE]) {
		cacheService.insertNode(cachedNode(id), null);
	}
	const api = createFakeInternalApi();
	const clock = {ms: START_MS};
	const newAdapter = () =>
		new WorkflowyInternalAdapter({
			client: new WorkflowyInternalClient({
				credentials: {username: "alice@example.com", password: "hunter2"},
				fetch: api.fetch,
				baseUrl: "https://workflowy.test",
				transientId: "6f1c1d1e-0000-4000-8000-000000000001",
			}),
			db,
			now: () => clock.ms,
			pushAndPoll: {randomId: () => "pollid01", timezone: "America/New_York", sleep: async () => {}},
		});
	return {sqlite, api, adapter: newAdapter(), newAdapter, clock};
}

function network(requests: RecordedRequest[]) {
	return requests.map((r) => [r.method, r.path]);
}

function pushedTrees(request: RecordedRequest | undefined): unknown {
	const fields = new URLSearchParams(request?.body ?? "");
	return JSON.parse(fields.get("push_poll_data") ?? "null");
}

describe("WorkflowyInternalAdapter expansion", () => {
	let open: DatabaseConstructor.Database[] = [];
	afterEach(() => {
		for (const sqlite of open) {
			sqlite.close();
		}
		open = [];
	});
	function tracked() {
		const result = setup();
		open.push(result.sqlite);
		return result;
	}

	it("reads the expanded keys from get_tree_data and resolves each to every cached id it prefixes", async () => {
		const {api, adapter} = tracked();
		api.respond("/get_tree_data/", () =>
			json({
				items: [],
				shared_projects: {},
				most_recent_operation_transaction_id: "9999",
				server_expanded_projects_list: ["1a2b3c4d", "5e6f7a8b", "ffffffff"],
			}),
		);

		await expect(adapter.getExpandedIds()).resolves.toStrictEqual([ALPHA, ALPHA_TWIN, BRAVO]);
		expect(network(api.requests)).toStrictEqual([
			["POST", "/ajax_login"],
			["GET", "/get_tree_data/"],
		]);
	});

	it("tests ids against the same cached keys, without a second fetch", async () => {
		const {api, adapter} = tracked();
		api.respond("/get_tree_data/", () => treeData(["1a2b3c4d"]));

		await adapter.getExpandedIds();
		const isExpanded = await adapter.expansionTest();

		expect({
			tested: [ALPHA, ALPHA_TWIN, BRAVO, "1a2b3c4d-not-cached"].map((id) => isExpanded(id)),
			network: network(api.requests),
		}).toStrictEqual({
			tested: [true, true, false, true],
			network: [
				["POST", "/ajax_login"],
				["GET", "/get_tree_data/"],
			],
		});
	});

	it("serves later reads from the cached keys, sharing one fetch between concurrent reads", async () => {
		const {api, adapter} = tracked();
		api.respond("/get_tree_data/", () => treeData(["1a2b3c4d"]));

		const concurrent = await Promise.all([adapter.getExpandedIds(), adapter.getExpandedIds()]);
		const later = await adapter.getExpandedIds();

		expect({concurrent, later, network: network(api.requests)}).toStrictEqual({
			concurrent: [
				[ALPHA, ALPHA_TWIN],
				[ALPHA, ALPHA_TWIN],
			],
			later: [ALPHA, ALPHA_TWIN],
			network: [
				["POST", "/ajax_login"],
				["GET", "/get_tree_data/"],
			],
		});
	});

	it("reads a mirror instance's v_ key back as the virtual ids it expands, directed by the key's path", async () => {
		const {api, adapter, sqlite} = tracked();
		const cache = new CacheService(drizzle(sqlite, {schema}));
		const ORIGINAL = "0a0a0a0a-0000-4000-8000-000000000010";
		const CHILD = "c0c0c0c0-0000-4000-8000-000000000011";
		const GRANDCHILD = "d1d1d1d1-0000-4000-8000-000000000012";
		const MIRROR = "bbbb0000-0000-4000-8000-000000000013";
		cache.insertNode(cachedNode(ORIGINAL), null);
		cache.insertNode({...cachedNode(CHILD), parent_id: ORIGINAL}, ORIGINAL);
		cache.insertNode({...cachedNode(GRANDCHILD), parent_id: CHILD}, CHILD);
		cache.insertNode(cachedNode(MIRROR), null);
		cache.insertMirror(ORIGINAL, MIRROR);
		api.respond("/get_tree_data/", () =>
			treeData(["v_c0c0bbbbbbbb", "v_d1d1bbbbbbbbc0c0", "v_d1d1bbbbbbbb", "5e6f7a8b"]),
		);

		await expect(adapter.getExpandedIds()).resolves.toStrictEqual([
			BRAVO,
			`virtual_${CHILD}_${MIRROR}_bbbb`,
			`virtual_${GRANDCHILD}_${MIRROR}_bbbbc0c0`,
		]);
	});

	it("keeps the cached keys across adapters over the same database", async () => {
		const {api, adapter, newAdapter} = tracked();
		api.respond("/get_tree_data/", () => treeData(["5e6f7a8b"]));
		await adapter.getExpandedIds();
		api.requests.length = 0;

		await expect(newAdapter().getExpandedIds()).resolves.toStrictEqual([BRAVO]);
		expect(api.requests).toStrictEqual([]);
	});

	it("answers a stale read from the cache and refreshes it in the background", async () => {
		const {api, adapter, clock} = tracked();
		api.respondOnce("/get_tree_data/", () => treeData(["1a2b3c4d"]));
		api.respond("/get_tree_data/", () => treeData(["9c9c9c9c"]));
		await adapter.getExpandedIds();
		clock.ms += 60_000;

		const stale = await adapter.getExpandedIds();
		await adapter.expandedKeysRefreshed();
		const refreshed = await adapter.getExpandedIds();

		expect({stale, refreshed, network: network(api.requests)}).toStrictEqual({
			stale: [ALPHA, ALPHA_TWIN],
			refreshed: [CHARLIE],
			network: [
				["POST", "/ajax_login"],
				["GET", "/get_tree_data/"],
				["GET", "/get_tree_data/"],
			],
		});
	});

	it("waits on get_tree_data for a fresh read once the cached keys are 5s old", async () => {
		const {api, adapter, clock} = tracked();
		api.respondOnce("/get_tree_data/", () => treeData(["1a2b3c4d"]));
		api.respond("/get_tree_data/", () => treeData(["9c9c9c9c"]));
		await adapter.getExpandedIds();
		clock.ms += 5000;

		const fresh = await adapter.getExpandedIds({fresh: true});
		const cached = await adapter.getExpandedIds();

		expect({fresh, cached, network: network(api.requests)}).toStrictEqual({
			fresh: [CHARLIE],
			cached: [CHARLIE],
			network: [
				["POST", "/ajax_login"],
				["GET", "/get_tree_data/"],
				["GET", "/get_tree_data/"],
			],
		});
	});

	it("reads the whole account tree once for a fresh expansion read with 6s-old keys", async () => {
		const {api, adapter, clock} = tracked();
		api.respond("/get_tree_data/", () => treeData(["1a2b3c4d"]));
		await adapter.getExpandedIds();
		api.requests.length = 0;
		clock.ms += 6000;

		await adapter.getExpansionState({fresh: true});

		expect(treeDataReads(api)).toBe(1);
	});

	it("reads the whole account tree once, in the background, for expansionTest with 31s-old keys", async () => {
		const {api, adapter, clock} = tracked();
		api.respond("/get_tree_data/", () => treeData(["1a2b3c4d"]));
		await adapter.getExpandedIds();
		api.requests.length = 0;
		clock.ms += 31_000;

		await adapter.expansionTest();
		await adapter.expandedKeysRefreshed();

		expect(treeDataReads(api)).toBe(1);
	});

	it("answers a fresh read from the cache within 5s of the last fetch", async () => {
		const {api, adapter, clock} = tracked();
		api.respondOnce("/get_tree_data/", () => treeData(["1a2b3c4d"]));
		api.respond("/get_tree_data/", () => treeData(["9c9c9c9c"]));
		await adapter.getExpandedIds();
		clock.ms += 4999;

		const fresh = await adapter.getExpandedIds({fresh: true});

		expect({fresh, network: network(api.requests)}).toStrictEqual({
			fresh: [ALPHA, ALPHA_TWIN],
			network: [
				["POST", "/ajax_login"],
				["GET", "/get_tree_data/"],
			],
		});
	});

	it("applies pushed changes to the cached keys, including ones pushed during a refresh", async () => {
		const {api, adapter, clock} = tracked();
		api.respondOnce("/get_tree_data/", () => treeData(["1a2b3c4d"]));
		await adapter.getExpandedIds();
		await adapter.setExpanded({[CHARLIE]: true, [ALPHA]: false});
		const afterPush = await adapter.getExpandedIds();

		// The refresh's snapshot predates the next push, so the push must survive it.
		api.respondOnce("/get_tree_data/", () => treeData(["9c9c9c9c"]));
		clock.ms += 60_000;
		await adapter.getExpandedIds();
		await adapter.setExpanded({[BRAVO]: true});
		await adapter.expandedKeysRefreshed();
		const afterRefresh = await adapter.getExpandedIds();

		expect({afterPush, afterRefresh}).toStrictEqual({
			afterPush: [CHARLIE],
			afterRefresh: [BRAVO, CHARLIE],
		});
	});

	it("pushes expansion changes as project_expansions_delta keyed by the first 8 chars, with no operations", async () => {
		const {api, adapter} = tracked();

		await adapter.setExpanded({[ALPHA]: true, [BRAVO]: false});

		expect(network(api.requests)).toStrictEqual([
			["POST", "/ajax_login"],
			["GET", "/get_initialization_data"],
			["POST", "/push_and_poll"],
		]);
		expect(pushedTrees(api.requests[2])).toStrictEqual([
			{
				most_recent_operation_transaction_id: "4567",
				project_expansions_delta: {"1a2b3c4d": true, "5e6f7a8b": false},
			},
		]);
	});

	it("keys a mirror instance's expansion as v_<child4><mirror4><path>", async () => {
		const {api, adapter} = tracked();

		await adapter.setExpanded({[`virtual_${ALPHA}_${BRAVO}_9c9c`]: true});

		expect(pushedTrees(api.requests[2])).toStrictEqual([
			{
				most_recent_operation_transaction_id: "4567",
				project_expansions_delta: {[`v_${ALPHA.slice(0, 4)}${BRAVO.slice(0, 4)}9c9c`]: true},
			},
		]);
	});

	it("answers a stale read with the old keys and refreshing, then the new keys once the refresh resolves", async () => {
		const {api, adapter, clock} = tracked();
		api.respondOnce("/get_tree_data/", () => treeData(["1a2b3c4d"]));
		await adapter.getExpandedIds();
		clock.ms += 31_000;
		let release: () => void = () => {};
		api.respond("/get_tree_data/", async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return treeData(["9c9c9c9c"]);
		});

		const stale = await adapter.getExpansionState();
		const waiting = adapter.getExpansionState({wait: true});
		await vi.waitFor(() => {
			expect(api.requests.filter((r) => r.path === "/get_tree_data/")).toHaveLength(2);
		});
		release();
		const settled = await waiting;

		expect({
			stale: {expandedIds: stale.expandedIds, refreshing: stale.refreshing, fetchedAt: stale.fetchedAt},
			settled: {expandedIds: settled.expandedIds, refreshing: settled.refreshing, fetchedAt: settled.fetchedAt},
		}).toStrictEqual({
			stale: {expandedIds: [ALPHA, ALPHA_TWIN], refreshing: true, fetchedAt: START_MS},
			settled: {expandedIds: [CHARLIE], refreshing: false, fetchedAt: START_MS + 31_000},
		});
	});

	it("fingerprints the keys: stable while unchanged, different once they change", async () => {
		const {api, adapter} = tracked();
		api.respond("/get_tree_data/", () => treeData(["1a2b3c4d"]));
		const first = await adapter.getExpansionState();
		const again = await adapter.getExpansionState();
		await adapter.setExpanded({[BRAVO]: true});
		const changed = await adapter.getExpansionState();

		expect({
			stable: first.fingerprint === again.fingerprint,
			changed: first.fingerprint !== changed.fingerprint,
			shape: /^[0-9a-f]{40}$/u.test(first.fingerprint),
		}).toStrictEqual({stable: true, changed: true, shape: true});
	});

	it("bounds a fresh read at 15s, answering the cached keys while the refresh keeps running", async () => {
		vi.useFakeTimers();
		try {
			const {api, adapter, clock} = tracked();
			api.respondOnce("/get_tree_data/", () => treeData(["1a2b3c4d"]));
			await adapter.getExpandedIds();
			clock.ms += 60_000;
			api.respond("/get_tree_data/", async () => new Promise<Response>(() => {}));

			let settled: Awaited<ReturnType<typeof adapter.getExpansionState>> | undefined;
			void adapter.getExpansionState({fresh: true}).then((state) => {
				settled = state;
				return state;
			});
			await vi.advanceTimersByTimeAsync(14_999);
			const early = settled;
			await vi.advanceTimersByTimeAsync(1);

			expect({early, expandedIds: settled?.expandedIds, refreshing: settled?.refreshing}).toStrictEqual({
				early: undefined,
				expandedIds: [ALPHA, ALPHA_TWIN],
				refreshing: true,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps a durable local copy of every pushed expansion key, never refreshed from the server", async () => {
		const {api, adapter, clock} = tracked();
		api.respond("/get_tree_data/", () => treeData(["1a2b3c4d"]));

		await adapter.setExpanded({[ALPHA]: true, [BRAVO]: false});
		await adapter.setRawExpansionKeys({"leftbar__home__None/x/__abcdefgh": true});
		await adapter.setExpanded({[BRAVO]: true});
		clock.ms += 60_000;
		await adapter.getExpandedIds({fresh: true});

		expect(adapter.localSettings()).toStrictEqual({
			"expansion:1a2b3c4d": true,
			"expansion:5e6f7a8b": true,
			"expansion:leftbar__home__None/x/__abcdefgh": true,
		});
	});

	it("sends nothing for no changes", async () => {
		const {api, adapter} = tracked();

		await adapter.setExpanded({});

		expect(api.requests).toStrictEqual([]);
	});
	it("lists only the leftbar__ keys, unresolved", async () => {
		const {api, adapter} = tracked();
		api.respond("/get_tree_data/", () =>
			treeData(["1a2b3c4d", "leftbar__home__None/x/__abcdefgh", "leftbar__starred__None/None/__None"]),
		);

		await expect(adapter.getLeftBarExpansionKeys()).resolves.toStrictEqual([
			"leftbar__home__None/x/__abcdefgh",
			"leftbar__starred__None/None/__None",
		]);
	});

	it("pushes raw expansion keys verbatim and applies them to the cached keys", async () => {
		const {api, adapter} = tracked();
		api.respond("/get_tree_data/", () => treeData(["leftbar__home__None/x/__old00000"]));
		await adapter.getLeftBarExpansionKeys();

		await adapter.setRawExpansionKeys({
			"leftbar__home__None/x/__abcdefgh": true,
			"leftbar__home__None/x/__old00000": false,
		});

		const push = api.requests.find((r) => r.path === "/push_and_poll");
		expect({
			delta: (pushedTrees(push) as {project_expansions_delta: unknown}[])[0]?.project_expansions_delta,
			keys: await adapter.getLeftBarExpansionKeys(),
		}).toStrictEqual({
			delta: {"leftbar__home__None/x/__abcdefgh": true, "leftbar__home__None/x/__old00000": false},
			keys: ["leftbar__home__None/x/__abcdefgh"],
		});
	});
});
