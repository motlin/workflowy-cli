import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {applyExpansionDelta, readExpansion, replaceExpansion} from "../src/cache/expansion-store.js";
import * as schema from "../src/db/schema.js";

const migrationsFolder = join(import.meta.dirname, "../src/db/migrations");

describe("expansion store", () => {
	let open: DatabaseConstructor.Database[] = [];
	afterEach(() => {
		for (const sqlite of open) {
			sqlite.close();
		}
		open = [];
	});
	function database() {
		const sqlite = new DatabaseConstructor(":memory:");
		open.push(sqlite);
		const db = drizzle(sqlite, {schema});
		migrate(db, {migrationsFolder});
		return db;
	}

	it("reads nothing before any import seeds the keys", () => {
		expect(readExpansion(database())).toBeUndefined();
	});

	it("replaces the keys and marks them with the change time", () => {
		const db = database();

		const mark = replaceExpansion(db, ["b", "a", "a"], 1000);

		expect({mark, stored: readExpansion(db)}).toStrictEqual({
			mark: 1000,
			stored: {keys: new Set(["a", "b"]), mark: 1000},
		});
	});

	it("applies a delta onto the stored keys and advances the mark", () => {
		const db = database();
		replaceExpansion(db, ["a", "b"], 1000);

		const applied = applyExpansionDelta(db, {a: false, c: true}, 2000);

		expect({applied, stored: readExpansion(db)}).toStrictEqual({
			applied: {keys: new Set(["b", "c"]), mark: 2000},
			stored: {keys: new Set(["b", "c"]), mark: 2000},
		});
	});

	it("advances the mark past the stored one even when the change time is not later", () => {
		const db = database();
		replaceExpansion(db, ["a"], 5000);

		const sameTime = applyExpansionDelta(db, {b: true}, 5000);
		const earlier = replaceExpansion(db, ["c"], 10);

		expect({sameTime: sameTime?.mark, earlier, stored: readExpansion(db)}).toStrictEqual({
			sameTime: 5001,
			earlier: 5002,
			stored: {keys: new Set(["c"]), mark: 5002},
		});
	});

	it("leaves an unseeded store unseeded on a delta", () => {
		const db = database();

		const applied = applyExpansionDelta(db, {a: true}, 1000);

		expect({applied, stored: readExpansion(db)}).toStrictEqual({applied: undefined, stored: undefined});
	});
});
