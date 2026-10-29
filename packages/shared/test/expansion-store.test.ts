import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {applyExpansionDelta, expansionVersion, readExpansion, replaceExpansion} from "../src/cache/expansion-store.js";
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

	it("marks each change with its own time, even when it equals or precedes the stored mark", () => {
		const db = database();
		replaceExpansion(db, ["a"], 5000);

		const sameTime = applyExpansionDelta(db, {b: true}, 5000);
		const earlier = replaceExpansion(db, ["c"], 10);

		expect({sameTime: sameTime?.mark, earlier, stored: readExpansion(db)}).toStrictEqual({
			sameTime: 5000,
			earlier: 10,
			stored: {keys: new Set(["c"]), mark: 10},
		});
	});

	it("versions the keys by their content, not their order, duplicates or change time", () => {
		const versions = [
			expansionVersion(new Set(["a", "b"])),
			expansionVersion(new Set(["b", "a"])),
			expansionVersion(new Set(["a"])),
			expansionVersion(new Set()),
		];

		expect({
			sameKeys: versions[0] === versions[1],
			distinct: new Set([versions[0], versions[2], versions[3]]).size,
			shape: versions.every((version) => /^[0-9a-f]{16}$/u.test(version)),
		}).toStrictEqual({sameKeys: true, distinct: 3, shape: true});
	});

	it("leaves an unseeded store unseeded on a delta", () => {
		const db = database();

		const applied = applyExpansionDelta(db, {a: true}, 1000);

		expect({applied, stored: readExpansion(db)}).toStrictEqual({applied: undefined, stored: undefined});
	});
});
