import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import * as schema from "@workflowy/shared/db";
import {mirrors, nodeContent, nodeMetadata, referencesRoots} from "@workflowy/shared/db";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {loadTreeSearchRows} from "../src/server/routes/search.js";

const migrationsFolder = join(import.meta.dirname, "../../shared/src/db/migrations");
const SEEDED_AT = "2026-01-01 00:00:00.000";
const CREATED = new Date("2026-02-01T00:00:00Z");
const MODIFIED = new Date("2026-03-01T00:00:00Z");
const COMPLETED = new Date("2026-04-01T00:00:00Z");

/*
 * root
 *   a         (todo layout, timestamps)
 *     a1
 *   mirror    (mirror of other; its own stale text is ignored)
 *   refs      (references root, excluded with its children)
 *     bl
 *   deleted   (no longer live)
 * other       (outside root)
 */
const TREE: [id: string, parentId: string | null, name: string][] = [
	["root", null, "Root"],
	["a", "root", "Alpha"],
	["a1", "a", "Alpha child"],
	["mirror", "root", "stale"],
	["refs", "root", ""],
	["bl", "refs", ""],
	["other", null, "Other"],
];

const open: DatabaseConstructor.Database[] = [];
afterEach(() => {
	for (const sqlite of open.splice(0)) {
		sqlite.close();
	}
});

function setup() {
	const sqlite = new DatabaseConstructor(":memory:");
	open.push(sqlite);
	const db = drizzle(sqlite, {schema});
	migrate(db, {migrationsFolder});
	TREE.forEach(([id, parentId, name], priority) => {
		db.insert(nodeContent)
			.values({
				id,
				name,
				note: id === "other" ? "other note" : null,
				parentId,
				systemFrom: SEEDED_AT,
				systemTo: FAR_FUTURE_DATE,
			})
			.run();
		db.insert(nodeMetadata)
			.values({
				nodeId: id,
				priority,
				createdAt: id === "a" ? CREATED : null,
				modifiedAt: id === "a" ? MODIFIED : null,
				completedAt: id === "a" ? COMPLETED : null,
				layoutMode: id === "a" ? "todo" : null,
				systemFrom: SEEDED_AT,
				systemTo: FAR_FUTURE_DATE,
			})
			.run();
	});
	db.insert(nodeContent)
		.values({id: "deleted", name: "Gone", note: null, parentId: "root", systemFrom: SEEDED_AT, systemTo: SEEDED_AT})
		.run();
	db.insert(referencesRoots).values({nodeId: "refs", systemFrom: SEEDED_AT, systemTo: FAR_FUTURE_DATE}).run();
	db.insert(mirrors)
		.values({mirrorId: "mirror", originalId: "other", systemFrom: SEEDED_AT, systemTo: FAR_FUTURE_DATE})
		.run();
	return db;
}

const NO_META = {createdAt: null, modifiedAt: null, completedAt: null, layoutMode: null};

describe("loadTreeSearchRows", () => {
	it("loads the live subtree with metadata, mirror text and no references content", () => {
		expect(new Set(loadTreeSearchRows(setup(), "root"))).toStrictEqual(
			new Set([
				{
					id: "a",
					parentId: "root",
					priority: 1,
					name: "Alpha",
					note: null,
					createdAt: CREATED.getTime(),
					modifiedAt: MODIFIED.getTime(),
					completedAt: COMPLETED.getTime(),
					layoutMode: "todo",
					isMirror: false,
				},
				{id: "a1", parentId: "a", priority: 2, name: "Alpha child", note: null, ...NO_META, isMirror: false},
				{
					id: "mirror",
					parentId: "root",
					priority: 3,
					name: "Other",
					note: "other note",
					...NO_META,
					isMirror: true,
				},
				{id: "root", parentId: null, priority: 0, name: "Root", note: null, ...NO_META, isMirror: false},
			]),
		);
	});

	it("loads every live row when rootId is null", () => {
		const ids = loadTreeSearchRows(setup(), null).map((row) => row.id);
		expect(new Set(ids)).toStrictEqual(new Set(["a", "a1", "mirror", "other", "root"]));
	});
});
