import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {WorkflowyInternalClient} from "../src/api/workflowy-internal-client.js";
import {importInternalMetadata, keptInternalMetadata} from "../src/cache/importer.js";
import * as schema from "../src/db/schema.js";
import {FAR_FUTURE_DATE} from "../src/temporal/index.js";
import {createFakeInternalApi, json} from "./helpers/fake-internal-api.js";

const migrationsFolder = join(import.meta.dirname, "../src/db/migrations");
const FETCHED_AT = 1_800_000_000_000;

const CALENDAR = {root: true, levels: {day: true, week: false, month: true, year: true}};

function setup(cachedIds: string[]) {
	const sqlite = new DatabaseConstructor(":memory:");
	const db = drizzle(sqlite, {schema});
	migrate(db, {migrationsFolder});
	for (const id of cachedIds) {
		db.insert(schema.nodeContent)
			.values({
				id,
				name: id,
				note: null,
				parentId: null,
				systemFrom: "2026-01-01 00:00:00",
				systemTo: FAR_FUTURE_DATE,
			})
			.run();
	}
	const rows = () =>
		db
			.select()
			.from(schema.nodeInternalMetadata)
			.all()
			.map((row) => ({
				nodeId: row.nodeId,
				metadata: JSON.parse(row.metadataJson) as unknown,
				fetchedAt: row.fetchedAt,
			}))
			.toSorted((a, b) => a.nodeId.localeCompare(b.nodeId));
	const content = () => db.select().from(schema.nodeContent).all();
	return {sqlite, db, rows, content};
}

describe("importInternalMetadata", () => {
	let open: DatabaseConstructor.Database[] = [];
	afterEach(() => {
		for (const sqlite of open) {
			sqlite.close();
		}
		open = [];
	});

	function tracked(cachedIds: string[]) {
		const context = setup(cachedIds);
		open.push(context.sqlite);
		return context;
	}

	it("writes the kept metadata keys for cached nodes, skips uncached ones, and leaves node rows untouched", () => {
		const {db, rows, content} = tracked(["a", "b", "c"]);
		const contentBefore = content();

		const result = importInternalMetadata(
			db,
			[
				{id: "a", metadata: {numbered_start: 5, layoutMode: "numbered", mirror: {originalId: "z"}}},
				{id: "b", metadata: {calendar: CALENDAR, priority: {defaultToBottom: true, other: 1}}},
				{id: "c", metadata: {}},
				{id: "c2"},
				{id: "missing", metadata: {numbered_start: 2}},
			],
			FETCHED_AT,
		);

		expect({result, rows: rows(), content: content()}).toStrictEqual({
			result: {written: 2, skipped: 1},
			rows: [
				{nodeId: "a", metadata: {numbered_start: 5, layoutMode: "numbered"}, fetchedAt: FETCHED_AT},
				{
					nodeId: "b",
					metadata: {calendar: CALENDAR, priority: {defaultToBottom: true}},
					fetchedAt: FETCHED_AT,
				},
			],
			content: contentBefore,
		});
	});

	it("replaces earlier rows, dropping metadata the server no longer reports", () => {
		const {db, rows} = tracked(["a", "b"]);
		importInternalMetadata(
			db,
			[
				{id: "a", metadata: {numbered_start: 5}},
				{id: "b", metadata: {numbered_start: 1}},
			],
			1,
		);

		const result = importInternalMetadata(db, [{id: "a", metadata: {numbered_start: 7}}], FETCHED_AT);

		expect({result, rows: rows()}).toStrictEqual({
			result: {written: 1, skipped: 0},
			rows: [{nodeId: "a", metadata: {numbered_start: 7}, fetchedAt: FETCHED_AT}],
		});
	});
});

describe("WorkflowyInternalClient.getTreeData", () => {
	it("returns each item's id and metadata from /get_tree_data/", async () => {
		const api = createFakeInternalApi();
		api.respond("/get_tree_data/", () =>
			json({
				items: [
					{id: "a", prnt: null, pr: 0, nm: "a", ct: 1, lm: 2, metadata: {numbered_start: 5}},
					{id: "b", prnt: "a", pr: 1, nm: "b", ct: 1, lm: 2},
				],
				most_recent_operation_transaction_id: "9999",
			}),
		);
		const client = new WorkflowyInternalClient({
			credentials: {username: "alice@example.com", password: "hunter2"},
			fetch: api.fetch,
			baseUrl: "https://workflowy.test",
			transientId: "6f1c1d1e-0000-4000-8000-000000000001",
		});
		await client.login();

		const items = await client.getTreeData();

		expect(items).toStrictEqual([{id: "a", metadata: {numbered_start: 5}}, {id: "b"}]);
	});
});

describe("keptInternalMetadata table", () => {
	it("keeps the table key and drops unknown keys", () => {
		expect(
			keptInternalMetadata({layoutMode: "table", table: {headers: true, sizes: {c1: 200}}, foo: 1}),
		).toStrictEqual({layoutMode: "table", table: {headers: true, sizes: {c1: 200}}});
	});
});
