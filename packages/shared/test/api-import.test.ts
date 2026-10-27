import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {applyApiBatch, beginApiImport, finishApiImport, importFromApi} from "../src/cache/api-import.js";
import * as schema from "../src/db/schema.js";
import {FAR_FUTURE_DATE} from "../src/temporal/index.js";
import type {WorkflowyNode} from "../src/types/index.js";

const migrationsFolder = join(import.meta.dirname, "../src/db/migrations");
const T0 = new Date("2026-03-01T00:00:00.000Z");
const T1 = new Date("2026-03-02T00:00:00.000Z");

function apiNode(id: string, overrides: Partial<WorkflowyNode> = {}): WorkflowyNode {
	return {
		id,
		name: `Name ${id}`,
		note: null,
		parent_id: null,
		priority: 0,
		completed: false,
		createdAt: 1_700_000_000,
		modifiedAt: 1_700_000_100,
		completedAt: null,
		data: {layoutMode: "bullets"},
		...overrides,
	};
}

const FIXTURE: WorkflowyNode[] = [
	apiNode("a", {priority: 0}),
	apiNode("b", {parent_id: "a", priority: 1, note: "a note"}),
	apiNode("c", {parent_id: "a", priority: 2}),
	apiNode("d", {parent_id: "b", priority: 3}),
	apiNode("e", {priority: 4, completedAt: 1_700_000_200}),
	apiNode("f", {parent_id: "e", priority: 5}),
	apiNode("g", {priority: 6}),
];

describe("shared API import", () => {
	const open: DatabaseConstructor.Database[] = [];

	function createDb() {
		const sqlite = new DatabaseConstructor(":memory:");
		open.push(sqlite);
		const db = drizzle(sqlite, {schema});
		migrate(db, {migrationsFolder});
		return db;
	}

	function snapshot(db: ReturnType<typeof createDb>) {
		return {
			content: db
				.select()
				.from(schema.nodeContent)
				.all()
				.toSorted((x, y) => x.id.localeCompare(y.id)),
			metadata: db
				.select()
				.from(schema.nodeMetadata)
				.all()
				.toSorted((x, y) => x.nodeId.localeCompare(y.nodeId)),
		};
	}

	afterEach(() => {
		for (const sqlite of open.splice(0)) {
			sqlite.close();
		}
	});

	it("importing a 3-batch split gives the same rows as the one-shot import", () => {
		const oneShot = createDb();
		importFromApi(oneShot, FIXTURE, {timestamp: T0});

		const batched = createDb();
		const state = beginApiImport(batched, {timestamp: T0});
		applyApiBatch(state, FIXTURE.slice(0, 3));
		applyApiBatch(state, FIXTURE.slice(3, 5));
		applyApiBatch(state, FIXTURE.slice(5));
		const result = finishApiImport(state);

		expect(snapshot(batched)).toStrictEqual(snapshot(oneShot));
		expect({
			totalNodes: result.totalNodes,
			nodesAdded: result.nodesAdded,
			nodesUpdated: result.nodesUpdated,
			nodesUnchanged: result.nodesUnchanged,
			nodesDeleted: result.nodesDeleted,
		}).toStrictEqual({totalNodes: 7, nodesAdded: 7, nodesUpdated: 0, nodesUnchanged: 0, nodesDeleted: 0});
	});

	it("phases out nodes absent from every batch", () => {
		const db = createDb();
		importFromApi(db, FIXTURE, {timestamp: T0});

		const state = beginApiImport(db, {timestamp: T1});
		applyApiBatch(state, FIXTURE.slice(0, 4));
		applyApiBatch(state, FIXTURE.slice(4, 6));
		const result = finishApiImport(state);

		const current = db
			.select()
			.from(schema.nodeContent)
			.all()
			.filter((row) => row.systemTo === FAR_FUTURE_DATE)
			.map((row) => row.id)
			.toSorted();
		expect({current, nodesDeleted: result.nodesDeleted, nodesPhasedOut: result.nodesPhasedOut}).toStrictEqual({
			current: ["a", "b", "c", "d", "e", "f"],
			nodesDeleted: 1,
			nodesPhasedOut: 1,
		});
	});

	it("does not phase out a node in an earlier batch when a later batch is applied", () => {
		const db = createDb();
		const state = beginApiImport(db, {timestamp: T0});
		applyApiBatch(state, FIXTURE.slice(0, 2));
		applyApiBatch(state, FIXTURE.slice(2, 4));
		const ids = db
			.select()
			.from(schema.nodeContent)
			.all()
			.map((row) => row.id)
			.toSorted();
		expect(ids).toStrictEqual(["a", "b", "c", "d"]);
	});

	it("reports no changes when re-run with no changes", () => {
		const db = createDb();
		importFromApi(db, FIXTURE, {timestamp: T0});

		const state = beginApiImport(db, {timestamp: T1});
		applyApiBatch(state, FIXTURE.slice(0, 3));
		applyApiBatch(state, FIXTURE.slice(3));
		const result = finishApiImport(state);

		expect({
			nodesAdded: result.nodesAdded,
			nodesUpdated: result.nodesUpdated,
			nodesDeleted: result.nodesDeleted,
			nodesUnchanged: result.nodesUnchanged,
		}).toStrictEqual({nodesAdded: 0, nodesUpdated: 0, nodesDeleted: 0, nodesUnchanged: 7});
		expect(snapshot(db).content).toHaveLength(7);
	});
});
