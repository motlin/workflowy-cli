import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {WorkflowyInternalClient} from "../src/api/workflowy-internal-client.js";
import * as schema from "../src/db/schema.js";
import {accountState} from "../src/db/schema.js";
import {WorkflowyInternalAdapter} from "../src/internal/adapter.js";
import {OperationRejected} from "../src/internal/errors.js";
import {createFakeInternalApi, FAKE_CLIENT_ID, initializationData, json} from "./helpers/fake-internal-api.js";
import type {RecordedRequest} from "./helpers/fake-internal-api.js";

const migrationsFolder = join(import.meta.dirname, "../src/db/migrations");
const START_MS = 1_800_000_000_000;

const SERVER_RUN = JSON.stringify({ops: [{type: "edit", data: {projectid: "None"}}], client_timestamp: 300_000_000});

function pushOk() {
	return json({
		results: [
			{
				new_most_recent_operation_transaction_id: "4568",
				server_run_operation_transaction_json: SERVER_RUN,
				concurrent_remote_operation_transactions: [],
			},
		],
	});
}

function setup() {
	const sqlite = new DatabaseConstructor(":memory:");
	const db = drizzle(sqlite, {schema});
	migrate(db, {migrationsFolder});
	const api = createFakeInternalApi();
	const client = new WorkflowyInternalClient({
		credentials: {username: "alice@example.com", password: "hunter2"},
		fetch: api.fetch,
		baseUrl: "https://workflowy.test",
		transientId: "6f1c1d1e-0000-4000-8000-000000000001",
	});
	const clock = {ms: START_MS};
	const adapter = new WorkflowyInternalAdapter({
		client,
		db,
		now: () => clock.ms,
		pushAndPoll: {randomId: () => "pollid01", timezone: "America/New_York", sleep: async () => {}},
	});
	return {sqlite, db, api, adapter, clock};
}

function network(requests: RecordedRequest[]) {
	return requests.map((r) => [r.method, r.path]);
}

function pushedTrees(request: RecordedRequest | undefined): unknown {
	const fields = new URLSearchParams(request?.body ?? "");
	return JSON.parse(fields.get("push_poll_data") ?? "null");
}

describe("WorkflowyInternalAdapter account state", () => {
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

	it("returns the account's user id and join date from the initialization data", async () => {
		const {adapter} = tracked();

		await expect(adapter.getAccount()).resolves.toStrictEqual({userId: 123, joinedAt: new Date(1_500_000_000_000)});
	});

	it("sets a root metadata path with one edit on None built against the fresh metadata, then reads it from the cache", async () => {
		const {api, adapter} = tracked();
		api.respond("/push_and_poll", pushOk);

		await adapter.setRootMeta(["color", "tags", "alice"], 3);

		expect(network(api.requests)).toStrictEqual([
			["POST", "/ajax_login"],
			["GET", "/get_initialization_data"],
			["POST", "/push_and_poll"],
		]);
		expect(pushedTrees(api.requests[2])).toStrictEqual([
			{
				most_recent_operation_transaction_id: "4567",
				operations: [
					{
						type: "edit",
						data: {
							projectid: "None",
							metadataPatches: [{op: "add", path: ["color"], value: {tags: {alice: 3}}}],
							metadataInversePatches: [{op: "remove", path: ["color"]}],
						},
						client_timestamp: 300_000_000,
						undo_data: {
							previous_last_modified: null,
							previous_last_modified_by: null,
							metadataPatches: [{op: "remove", path: ["color"]}],
						},
					},
				],
			},
		]);

		const requestsBefore = api.requests.length;
		await expect(adapter.getRootMeta(["color", "tags"])).resolves.toStrictEqual({alice: 3});
		await expect(adapter.getRootMeta(["starring", "locations"])).resolves.toStrictEqual({abc: "None"});
		expect(api.requests).toHaveLength(requestsBefore);
	});

	it("leaves account_state unchanged when the push is rejected", async () => {
		const {api, adapter, db, clock} = tracked();
		await adapter.getRootMeta([]);
		const before = db.select().from(accountState).all();
		clock.ms += 31_000;
		api.respond("/push_and_poll", () =>
			json({results: [{new_most_recent_operation_transaction_id: "4568", error: "bad op"}]}),
		);

		await expect(adapter.setRootMeta(["color", "tags", "alice"], 3)).rejects.toBeInstanceOf(OperationRejected);

		expect(db.select().from(accountState).all()).toStrictEqual(before);
	});

	it("serves reads from the cache for 30s, then refreshes with one initialization GET", async () => {
		const {api, adapter, clock} = tracked();
		await expect(adapter.getSetting("theme")).resolves.toBe("dark");
		api.respond("/get_initialization_data", () =>
			json(
				{...initializationData(), settings: {theme: "light", show_completed: true}},
				{headers: {wfclientid: FAKE_CLIENT_ID}},
			),
		);

		clock.ms += 30_000;
		await expect(adapter.getSetting("theme")).resolves.toBe("dark");
		const requestsBefore = api.requests.length;

		clock.ms += 1000;
		await expect(adapter.getSetting("theme")).resolves.toBe("light");
		expect(network(api.requests.slice(requestsBefore))).toStrictEqual([["GET", "/get_initialization_data"]]);
	});

	it("reads the entropy key from the initialization data once, then serves it from account_state", async () => {
		const {api, adapter, db, clock} = tracked();
		api.respond("/get_initialization_data", () =>
			json(
				{...initializationData(), user: {id: 123, email: "alice@example.com", entropyKey: "k".repeat(64)}},
				{headers: {wfclientid: FAKE_CLIENT_ID}},
			),
		);

		await expect(adapter.getEntropyKey()).resolves.toBe("k".repeat(64));
		const requestsBefore = api.requests.length;
		clock.ms += 365 * 24 * 60 * 60 * 1000;
		const fresh = new WorkflowyInternalAdapter({
			client: new WorkflowyInternalClient({
				credentials: {username: "a", password: "b"},
				fetch: api.fetch,
				baseUrl: "https://workflowy.test",
			}),
			db,
			now: () => clock.ms,
		});

		await expect(fresh.getEntropyKey()).resolves.toBe("k".repeat(64));
		expect(api.requests.slice(requestsBefore)).toStrictEqual([]);
	});

	it("answers undefined for the entropy key when the account data has none", async () => {
		const {adapter} = tracked();

		await expect(adapter.getEntropyKey()).resolves.toBeUndefined();
	});

	it("posts a setting change with yes/no flags and the client id, then caches the new value", async () => {
		const {api, adapter} = tracked();

		await adapter.setSetting("show_completed", false);

		const post = api.requests.find((r) => r.path === "/change_settings");
		expect(Object.fromEntries(new URLSearchParams(post?.body ?? ""))).toStrictEqual({
			show_completed: "no",
			clientId: FAKE_CLIENT_ID,
			crosscheck_user_id: "123",
		});
		const requestsBefore = api.requests.length;
		await expect(adapter.getSetting("show_completed")).resolves.toBe(false);
		expect(api.requests).toHaveLength(requestsBefore);
	});

	it("leaves the cached setting unchanged when the settings POST fails", async () => {
		const {api, adapter, db} = tracked();
		await adapter.getSetting("theme");
		const before = db.select().from(accountState).all();
		api.respond("/change_settings", () => new Response("boom", {status: 500}));

		await expect(adapter.setSetting("theme", "light")).rejects.toThrow("/change_settings returned 500");

		expect(db.select().from(accountState).all()).toStrictEqual(before);
	});
});
