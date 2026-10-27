import {describe, expect, it} from "vite-plus/test";
import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {nodeTreeHost} from "../src/server/node-host.js";
import {bindTreeHost} from "../src/server/tree-snapshot.js";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {Hono} from "hono";
import {join} from "node:path";
import {CacheService} from "@workflowy/shared/cache";
import * as schema from "@workflowy/shared/db";
import {nodeContent, nodeMetadata} from "@workflowy/shared/db";
import {and, eq} from "drizzle-orm";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import type {AppEnv, ServerContext} from "../src/server/context.js";
import {
	mergeFallback,
	peekWholeTreeTagCountsBuild,
	rankCounts,
	rankTags,
	wholeTreeTagCounts,
} from "../src/server/tag-index.js";
import type {TagCount} from "../src/server/tag-index.js";
import {createTagIndexRouter} from "../src/server/routes/tag-index.js";

const FIXTURE_NAMES = [
	"Alpha #taZebra item",
	"Beta #taZebra #taApple",
	"Gamma #taApple @taPerson",
	"Delta #TaZebra upper, #ta:sub:key end",
	"Numbers #123 #1234 #12a",
	"Edge (#taParen) #taDot. foo#taNo",
	"Bold <b>#taBold</b> tag",
	"Type here",
];

const FIXTURE_ROWS = FIXTURE_NAMES.map((name) => ({name, note: null}));

function asPairs(tags: TagCount[]): string[] {
	return tags.map(({tag, count}) => `${tag}:${count}`);
}

describe("rankTags in code blocks", () => {
	it("leaves a code block's tags out of the counts", () => {
		expect(
			asPairs(
				rankTags(
					[
						{name: "#a", note: null, layoutMode: "code-block"},
						{name: "#b", note: null},
					],
					{prefix: "#", limit: 8},
				),
			),
		).toStrictEqual(["#b:1"]);
	});
});

describe("rankTags", () => {
	it("ranks every tag by count, then non-digit before digit, then plain string order, capped at the limit", () => {
		expect(asPairs(rankTags(FIXTURE_ROWS, {prefix: "#", limit: 8}))).toStrictEqual([
			"#taZebra:3",
			"#taApple:2",
			"#ta:sub:key:1",
			"#taBold:1",
			"#taDot:1",
			"#taParen:1",
			"#1234:1",
			"#12a:1",
		]);
	});

	it("matches the prefix case-insensitively", () => {
		expect(asPairs(rankTags(FIXTURE_ROWS, {prefix: "#taA", limit: 8}))).toStrictEqual(["#taApple:2"]);
		expect(asPairs(rankTags(FIXTURE_ROWS, {prefix: "#TA", limit: 8}))).toStrictEqual([
			"#taZebra:3",
			"#taApple:2",
			"#ta:sub:key:1",
			"#taBold:1",
			"#taDot:1",
			"#taParen:1",
		]);
	});

	it("counts tags in notes and skips #use-template tags", () => {
		const rows = [
			{name: "One", note: "#taNote and #use-template:x"},
			{name: "Two #taNote", note: null},
		];

		expect(rankTags(rows, {prefix: "#", limit: 8})).toStrictEqual([{tag: "#taNote", count: 2}]);
	});
});

describe("mergeFallback", () => {
	it("fills from the fallback list with tags not already listed", () => {
		expect(
			mergeFallback(
				[{tag: "#a", count: 2}],
				[
					{tag: "#a", count: 5},
					{tag: "#b", count: 1},
				],
				8,
			),
		).toStrictEqual([
			{tag: "#a", count: 2},
			{tag: "#b", count: 1},
		]);
	});

	it("stops at the limit", () => {
		expect(
			mergeFallback(
				[{tag: "#a", count: 2}],
				[
					{tag: "#b", count: 5},
					{tag: "#c", count: 1},
				],
				2,
			),
		).toStrictEqual([
			{tag: "#a", count: 2},
			{tag: "#b", count: 5},
		]);
	});
});

/*
 * root ("TA root #taRoot")
 *   one per FIXTURE_NAMES entry
 * outside ("Outside #taOutside #taZebra")
 * deleted ("Deleted #taGone", no longer live)
 */
function setupDb() {
	const sqlite = new DatabaseConstructor(":memory:");
	const db = drizzle(sqlite, {schema});
	bindTreeHost(db, nodeTreeHost(sqlite));
	migrate(db, {migrationsFolder: join(import.meta.dirname, "../../shared/src/db/migrations")});
	const seededAt = "2026-01-01 00:00:00.000";
	const rows: {id: string; parentId: string | null; name: string; systemTo?: string}[] = [
		{id: "root", parentId: null, name: "TA root #taRoot"},
		...FIXTURE_NAMES.map((name, index) => ({id: `child-${index}`, parentId: "root", name})),
		{id: "outside", parentId: null, name: "Outside #taOutside #taZebra"},
		{id: "deleted", parentId: "root", name: "Deleted #taGone", systemTo: "2026-02-01 00:00:00.000"},
	];
	for (const {id, parentId, name, systemTo = FAR_FUTURE_DATE} of rows) {
		db.insert(nodeContent).values({id, name, note: null, parentId, systemFrom: seededAt, systemTo}).run();
	}
	return db;
}

function setup(db = setupDb()) {
	const ctx = {db, cacheService: new CacheService(db)} as unknown as ServerContext;
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});
	app.route("/api/v1/tags/autocomplete", createTagIndexRouter());
	return app;
}

async function getTags(app: Hono<AppEnv>, query: string): Promise<string[]> {
	const response = await app.fetch(new Request(`http://x/api/v1/tags/autocomplete?${query}`));
	if (response.status !== 200) {
		throw new Error(await response.text());
	}
	const body = (await response.json()) as {tags: TagCount[]};
	return asPairs(body.tags);
}

describe("GET /api/v1/tags/autocomplete", () => {
	it("ranks the zoomed subtree including the root's own text, without fallback", async () => {
		await expect(getTags(setup(), "root=root&prefix=%23&limit=8&fallback=0")).resolves.toStrictEqual([
			"#taZebra:3",
			"#taApple:2",
			"#ta:sub:key:1",
			"#taBold:1",
			"#taDot:1",
			"#taParen:1",
			"#taRoot:1",
			"#1234:1",
		]);
	});

	it("fills from the whole tree when the subtree has fewer than the limit", async () => {
		await expect(getTags(setup(), "root=root&prefix=%23taZ&limit=8")).resolves.toStrictEqual(["#taZebra:3"]);
		await expect(getTags(setup(), "root=child-0&prefix=%23ta&limit=3")).resolves.toStrictEqual([
			"#taZebra:1",
			"#taApple:2",
			"#ta:sub:key:1",
		]);
	});

	it("ranks the whole live tree at Home", async () => {
		await expect(getTags(setup(), "prefix=%23taO")).resolves.toStrictEqual(["#taOutside:1"]);
		await expect(getTags(setup(), "prefix=%23taZ")).resolves.toStrictEqual(["#taZebra:4"]);
		await expect(getTags(setup(), "prefix=%23taG")).resolves.toStrictEqual([]);
	});
});

describe("GET /api/v1/tags/autocomplete and code blocks", () => {
	it("counts no tag from a code-block row, in the subtree or the whole tree", async () => {
		const db = setupDb();
		const at = "2026-01-02 00:00:00.000";
		db.insert(nodeContent)
			.values({
				id: "code",
				name: "#taCodeOnly #taZebra",
				note: null,
				parentId: "root",
				systemFrom: at,
				systemTo: FAR_FUTURE_DATE,
			})
			.run();
		db.insert(nodeMetadata)
			.values({nodeId: "code", layoutMode: "code-block", systemFrom: at, systemTo: FAR_FUTURE_DATE})
			.run();
		expect([
			await getTags(setup(db), "prefix=%23taC"),
			await getTags(setup(db), "root=root&prefix=%23taC&fallback=0"),
			await getTags(setup(db), "prefix=%23taZ"),
		]).toStrictEqual([[], [], ["#taZebra:4"]]);
	});
});

describe("GET /api/v1/tags/autocomplete with the edited item's live text", () => {
	it("counts the edited item's live name instead of its saved one, as upstream's per-keystroke tag counts do", async () => {
		const live = new URLSearchParams({
			root: "root",
			prefix: "#taZ",
			fallback: "0",
			item: "child-0",
			name: "Alpha #taZoo",
		});
		await expect(getTags(setup(), live.toString())).resolves.toStrictEqual(["#taZebra:2", "#taZoo:1"]);
	});

	it("counts the edited item's live note alongside its saved name", async () => {
		const live = new URLSearchParams({prefix: "#taZ", item: "child-0", note: "#taZoo"});
		await expect(getTags(setup(), live.toString())).resolves.toStrictEqual(["#taZebra:4", "#taZoo:1"]);
	});

	it("swaps a saved tag for the in-progress one the live name has instead", async () => {
		const live = new URLSearchParams({prefix: "#taA", item: "child-1", name: "Beta #taZebra #taA"});
		await expect(getTags(setup(), live.toString())).resolves.toStrictEqual(["#taA:1", "#taApple:1"]);
	});
});

describe("wholeTreeTagCounts", () => {
	it("reuses one whole-tree count across autocompletes until a write, so per-keystroke requests do not stall saves", async () => {
		const db = setupDb();
		const app = setup(db);
		const first = wholeTreeTagCounts(db);

		await expect(getTags(app, "prefix=%23taZ")).resolves.toStrictEqual(["#taZebra:4"]);
		expect(wholeTreeTagCounts(db)).toBe(first);

		db.insert(nodeContent)
			.values({
				id: "added",
				name: "Added #taZebra",
				note: null,
				parentId: null,
				systemFrom: "2026-03-01 00:00:00.000",
				systemTo: FAR_FUTURE_DATE,
			})
			.run();

		expect(wholeTreeTagCounts(db)).not.toBe(first);
		await expect(getTags(app, "prefix=%23taZ")).resolves.toStrictEqual(["#taZebra:5"]);
	});
});

describe("wholeTreeTagCounts patches", () => {
	function liveRows(db: ReturnType<typeof setupDb>) {
		return db
			.select({name: nodeContent.name, note: nodeContent.note})
			.from(nodeContent)
			.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
			.all();
	}

	function rename(db: ReturnType<typeof setupDb>, id: string, name: string, at: string) {
		const live = and(eq(nodeContent.id, id), eq(nodeContent.systemTo, FAR_FUTURE_DATE));
		const current = db.select().from(nodeContent).where(live).get();
		db.update(nodeContent).set({systemTo: at}).where(live).run();
		if (current !== undefined && name !== "") {
			db.insert(nodeContent)
				.values({...current, name, systemFrom: at, systemTo: FAR_FUTURE_DATE})
				.run();
		}
	}

	it("patches the counts after each write to equal a full recount", () => {
		const db = setupDb();
		wholeTreeTagCounts(db);
		expect(peekWholeTreeTagCountsBuild(db)).toBe("full");
		const writes: [step: string, write: () => void][] = [
			[
				"drop a tag",
				() => {
					rename(db, "child-0", "Alpha item", "2026-03-01 00:00:00.001");
				},
			],
			[
				"add a tag",
				() => {
					rename(db, "child-7", "Type here #taNew #taApple", "2026-03-01 00:00:00.002");
				},
			],
			[
				"delete a tagged item",
				() => {
					rename(db, "child-1", "", "2026-03-01 00:00:00.003");
				},
			],
		];
		const all = {prefix: "#", limit: 100};
		for (const [step, write] of writes) {
			write();
			expect({step, tags: rankCounts(wholeTreeTagCounts(db), all)}).toStrictEqual({
				step,
				tags: rankTags(liveRows(db), all),
			});
			expect({step, build: peekWholeTreeTagCountsBuild(db)}).toStrictEqual({step, build: "patch"});
		}
	});
});
