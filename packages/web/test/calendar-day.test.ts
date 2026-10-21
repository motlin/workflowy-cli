import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {Hono} from "hono";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {CacheService} from "@workflowy/shared/cache";
import * as schema from "@workflowy/shared/db";
import {calendarNodeId} from "@workflowy/shared/internal";
import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {findCalendarDay} from "../src/server/calendar-day.js";
import type {AppEnv, ServerContext} from "../src/server/context.js";
import {createCalendarRouter} from "../src/server/routes/calendar.js";

const migrationsFolder = join(import.meta.dirname, "../../shared/src/db/migrations");
const KEY = "k";
const D1017 = calendarNodeId(KEY, "day", 20_261_017);
const D1005_ELSEWHERE = calendarNodeId(KEY, "day", 20_261_005);
const W0906 = calendarNodeId(KEY, "week", 20_260_906, 2026);

function time(year: number, month: number, day: number): string {
	return `<time startYear="${year}" startMonth="${month}" startDay="${day}">${month}/${day}/${year}</time>`;
}

/** [id, parent, name, metadata?]: a 📆 Calendar root with legacy, metadata-tagged and deterministic days, and month-level entries that mention a date. */
const TREE: [string, string | null, string, unknown?][] = [
	["cal", null, "📆 Calendar", {calendar: {root: true, levels: {year: true, month: true, day: true}}}],
	["other", null, "Other"],
	[D1005_ELSEWHERE, "other", time(2026, 10, 5)],
	["y2026", "cal", "2026"],
	["m09", "y2026", "9"],
	["d0902", "m09", time(2026, 9, 2)],
	["d0930", "m09", "Sept 30", {calendar: {level: "day", value: "30", timestamp: 0, dateId: 20_260_930}}],
	[W0906, "m09", "Week 37"],
	["m10", "y2026", "10"],
	[
		"a-entry-1001",
		"m10",
		'<time startYear="2026" startMonth="10" startDay="1" startHour="9">Oct 1 at 9am</time> Standup',
	],
	["b-kickoff-1001", "m10", `Kickoff ${time(2026, 10, 1)}`],
	["d1001", "m10", time(2026, 10, 1)],
	[D1017, "m10", "Today"],
	["w1011", "m10", "Week 42", {calendar: {level: "week", value: "42", timestamp: 0, dateId: 20_261_011}}],
];

/** [id, priority, kind]: today's children, inserted out of priority order; the references root and the deleted child sort first. */
const D1017_CHILDREN: [string, number, "live" | "referencesRoot" | "deleted"][] = [
	["second", 3, "live"],
	["refs", 0, "referencesRoot"],
	["deleted", 1, "deleted"],
	["first", 2, "live"],
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
	for (const [id, parentId, name, metadata] of TREE) {
		db.insert(schema.nodeContent)
			.values({id, name, parentId, systemFrom: "2026-01-01", systemTo: FAR_FUTURE_DATE})
			.run();
		if (metadata !== undefined) {
			db.insert(schema.nodeInternalMetadata)
				.values({nodeId: id, metadataJson: JSON.stringify(metadata), fetchedAt: 0})
				.run();
		}
	}
	for (const [id, priority, kind] of D1017_CHILDREN) {
		const systemTo = kind === "deleted" ? "2026-02-01" : FAR_FUTURE_DATE;
		db.insert(schema.nodeContent).values({id, name: id, parentId: D1017, systemFrom: "2026-01-01", systemTo}).run();
		db.insert(schema.nodeMetadata).values({nodeId: id, priority, systemFrom: "2026-01-01", systemTo}).run();
		if (kind === "referencesRoot") {
			db.insert(schema.referencesRoots).values({nodeId: id, systemFrom: "2026-01-01", systemTo}).run();
		}
	}
	return {db, cache: new CacheService(db)};
}

describe("findCalendarDay", () => {
	it("finds a day by deterministic id, calendar metadata, then the year > month > <time> name walk", () => {
		const deps = {...setup(), entropyKey: KEY};

		expect(
			[20_261_017, 20_260_930, 20_261_001, 20_260_902, 20_261_005].map((dateId) => findCalendarDay(deps, dateId)),
		).toStrictEqual([D1017, "d0930", "d1001", "d0902", null]);
	});

	it("finds the month or year node holding a day by the name walk", () => {
		const deps = {...setup(), entropyKey: KEY};

		expect([
			findCalendarDay(deps, 20_261_017, "month"),
			findCalendarDay(deps, 20_260_902, "month"),
			findCalendarDay(deps, 20_261_017, "year"),
			findCalendarDay(deps, 20_271_017, "year"),
		]).toStrictEqual(["m10", "m09", "y2026", null]);
	});

	it("finds the week holding a day by deterministic id or calendar metadata, its start per weekStartDay", () => {
		const deps = {...setup(), entropyKey: KEY};

		expect([
			findCalendarDay(deps, 20_260_909, "week"),
			findCalendarDay(deps, 20_261_015, "week"),
			findCalendarDay({...deps, weekStartDay: 1}, 20_261_015, "week"),
			findCalendarDay(deps, 20_261_020, "week"),
		]).toStrictEqual([W0906, "w1011", null, null]);
	});

	it("skips the deterministic id without an entropy key and still walks names", () => {
		const deps = setup();

		expect([20_261_017, 20_261_001].map((dateId) => findCalendarDay(deps, dateId))).toStrictEqual([null, "d1001"]);
	});
});

describe("GET /api/v1/calendar/day/:dateId", () => {
	function app(entropyKey: string | undefined) {
		const {db, cache} = setup();
		const adapter = {
			getEntropyKey: async () => Promise.resolve(entropyKey),
			getRootMeta: async () => Promise.resolve(undefined),
		};
		const ctx = {
			db,
			cacheService: cache,
			internalAdapter: () =>
				entropyKey === undefined ? undefined : (adapter as unknown as WorkflowyInternalAdapter),
		} as unknown as ServerContext;
		const hono = new Hono<AppEnv>();
		hono.use("*", async (c, next) => {
			c.set("ctx", ctx);
			await next();
		});
		hono.route("/api/v1/calendar", createCalendarRouter());
		return async (dateId: string, query = "") => {
			const res = await hono.fetch(new Request(`http://x/api/v1/calendar/day/${dateId}${query}`));
			return {status: res.status, body: (await res.json()) as unknown};
		};
	}

	it("answers the day's id and first live, non-references-root child, using the account entropy key when the internal API is configured", async () => {
		const get = app(KEY);

		await expect(Promise.all([get("20261017"), get("20261005"), get("20260230")])).resolves.toStrictEqual([
			{status: 200, body: {id: D1017, firstChildId: "first"}},
			{status: 404, body: {error: "Calendar day not found"}},
			{status: 400, body: {error: "dateId must be a YYYYMMDD calendar day"}},
		]);
	});

	it("falls back to metadata and names without the internal API", async () => {
		const get = app(undefined);

		await expect(Promise.all([get("20261017"), get("20260930")])).resolves.toStrictEqual([
			{status: 404, body: {error: "Calendar day not found"}},
			{status: 200, body: {id: "d0930", firstChildId: null}},
		]);
	});

	it("answers the week, month or year node holding the day for ?level=, and rejects other levels", async () => {
		const get = app(KEY);

		await expect(
			Promise.all([
				get("20260902", "?level=month"),
				get("20260902", "?level=year"),
				get("20261015", "?level=week"),
				get("20260902", "?level=hour"),
			]),
		).resolves.toStrictEqual([
			{status: 200, body: {id: "m09", firstChildId: "d0902"}},
			{status: 200, body: {id: "y2026", firstChildId: "m09"}},
			{status: 200, body: {id: "w1011", firstChildId: null}},
			{status: 400, body: {error: "level must be day, week, month or year"}},
		]);
	});
});
