import {beforeEach, vi, afterEach, describe, expect, it} from "vite-plus/test";
import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import os from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {CacheService} from "../src/cache/cache-service.js";
import * as schema from "../src/db/schema.js";
import {nodeContent} from "../src/db/schema.js";
import type {WorkflowyNode} from "../src/types/workflowy.js";
import {FAR_FUTURE_DATE} from "../src/temporal/constants.js";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");

function apiNode(name: string): WorkflowyNode {
	return {id: "node-1", name, priority: 0, createdAt: 1_767_225_600, modifiedAt: 1_767_225_600};
}

describe("system time shared across writers", () => {
	let tempDir: string;
	let connections: DatabaseConstructor.Database[];

	beforeEach(() => {
		tempDir = fs.mkdtempSync(join(os.tmpdir(), "workflowy-system-clock-test-"));
		connections = [];
	});

	afterEach(() => {
		vi.useRealTimers();
		for (const connection of connections) {
			connection.close();
		}
		fs.rmSync(tempDir, {recursive: true, force: true});
	});

	/** A separate connection to one database file, as another process would open it. */
	function openDatabase() {
		const sqlite = new DatabaseConstructor(join(tempDir, "cache.sqlite"));
		connections.push(sqlite);
		const database = drizzle(sqlite, {schema});
		migrate(database, {migrationsFolder});
		return database;
	}

	it("gives two cache instances on separate connections distinct system times for one node within a millisecond", async () => {
		vi.useFakeTimers({toFake: ["Date"], now: new Date("2026-02-01T00:00:00.000Z")});
		const first = openDatabase();
		const second = openDatabase();

		await new CacheService(first).insertNode(apiNode("Original"), null);
		await new CacheService(second).insertNode(apiNode("Renamed"), null);

		expect(first.select().from(nodeContent).all()).toStrictEqual([
			{
				id: "node-1",
				name: "Original",
				note: null,
				parentId: null,
				systemFrom: "2026-02-01 00:00:00.000",
				systemTo: "2026-02-01 00:00:00.001",
			},
			{
				id: "node-1",
				name: "Renamed",
				note: null,
				parentId: null,
				systemFrom: "2026-02-01 00:00:00.001",
				systemTo: FAR_FUTURE_DATE,
			},
		]);
	});
});
