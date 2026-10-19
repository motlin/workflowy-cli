import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import * as schema from "@workflowy/shared/db";
import {mirrors, nodeContent, nodeMetadata, referencesRoots} from "@workflowy/shared/db";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {eq} from "drizzle-orm";
import {loadTreeRows, loadTreeSearchRows} from "../src/server/tree-snapshot.js";

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
const tempDirs: string[] = [];
afterEach(() => {
	for (const sqlite of open.splice(0)) {
		sqlite.close();
	}
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, {recursive: true, force: true});
	}
});

function connect(path: string) {
	const sqlite = new DatabaseConstructor(path);
	open.push(sqlite);
	return drizzle(sqlite, {schema});
}

function setup(path = ":memory:") {
	const sqlite = new DatabaseConstructor(path);
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

function insertNode(db: ReturnType<typeof setup>, id: string, parentId: string | null, name: string) {
	db.insert(nodeContent)
		.values({id, name, note: null, parentId, systemFrom: SEEDED_AT, systemTo: FAR_FUTURE_DATE})
		.run();
}

function idSet(rows: {id: string}[]): Set<string> {
	return new Set(rows.map((row) => row.id));
}

describe("loadTreeRows", () => {
	it("answers the same rows as loadTreeSearchRows for the whole tree and for a subtree", () => {
		const db = setup();
		expect(loadTreeRows(db, null)).toStrictEqual(loadTreeSearchRows(db, null));
		expect(new Set(loadTreeRows(db, "root"))).toStrictEqual(new Set(loadTreeSearchRows(db, "root")));
		expect(idSet(loadTreeRows(db, "a"))).toStrictEqual(new Set(["a", "a1"]));
		expect(idSet(loadTreeRows(db, "refs"))).toStrictEqual(idSet(loadTreeSearchRows(db, "refs")));
		expect(loadTreeRows(db, "missing")).toStrictEqual([]);
	});

	it("reuses one snapshot while the database is unchanged", () => {
		const db = setup();
		const first = loadTreeRows(db, null);
		expect(loadTreeRows(db, null)).toBe(first);
		expect(loadTreeRows(db, "root")[0]).toBe(first.find((row) => row.id === "root"));
	});

	it("reloads after a write on the same connection", () => {
		const db = setup();
		const first = loadTreeRows(db, null);
		insertNode(db, "new", "root", "New");
		const second = loadTreeRows(db, null);
		expect(second).not.toBe(first);
		expect(idSet(second)).toStrictEqual(new Set(["a", "a1", "mirror", "new", "other", "root"]));
	});

	it("keeps unchanged row objects across a reload so their derived search text stays cached", () => {
		const db = setup();
		const first = loadTreeRows(db, null);
		db.update(nodeContent).set({name: "Alpha renamed"}).where(eq(nodeContent.id, "a")).run();
		const second = loadTreeRows(db, null);
		const byId = (rows: typeof first, id: string) => rows.find((row) => row.id === id);
		expect(byId(second, "a1")).toBe(byId(first, "a1"));
		expect(byId(second, "a")).not.toBe(byId(first, "a"));
		expect(byId(second, "a")?.name).toBe("Alpha renamed");
	});

	it("reloads after a write from another connection", () => {
		const dir = mkdtempSync(join(tmpdir(), "tree-snapshot-"));
		tempDirs.push(dir);
		const path = join(dir, "cache.sqlite");
		const db = setup(path);
		const first = loadTreeRows(db, null);
		insertNode(connect(path), "new", "root", "New");
		expect(idSet(loadTreeRows(db, null))).toStrictEqual(new Set(["a", "a1", "mirror", "new", "other", "root"]));
		expect(loadTreeRows(db, null)).not.toBe(first);
	});
});
