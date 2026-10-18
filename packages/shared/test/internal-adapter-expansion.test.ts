import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {WorkflowyInternalClient} from "../src/api/workflowy-internal-client.js";
import {CacheService} from "../src/cache/cache-service.js";
import * as schema from "../src/db/schema.js";
import {WorkflowyInternalAdapter} from "../src/internal/adapter.js";
import type {WorkflowyNode} from "../src/types/index.js";
import {createFakeInternalApi, json} from "./helpers/fake-internal-api.js";
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

	it("sends nothing for no changes", async () => {
		const {api, adapter} = tracked();

		await adapter.setExpanded({});

		expect(api.requests).toStrictEqual([]);
	});
});
