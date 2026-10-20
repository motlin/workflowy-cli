import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {Hono} from "hono";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {z} from "zod";
import {CacheService} from "@workflowy/shared/cache";
import * as schema from "@workflowy/shared/db";
import {CalendarWeekUnsupported, calendarNodeId} from "@workflowy/shared/internal";
import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import type {AppEnv, ServerContext} from "../src/server/context.js";
import {createCalendarRouter} from "../src/server/routes/calendar.js";

const migrationsFolder = join(import.meta.dirname, "../../shared/src/db/migrations");

function time(year: number, month: number, day: number): string {
	return `<time startYear="${year}" startMonth="${month}" startDay="${day}">x</time>`;
}

/** [id, parent, name] in sibling order: one month of the calendar plus a dated note outside it. */
const TREE: [string, string | null, string][] = [
	["cal", null, "📆 Calendar"],
	["y2026", "cal", "2026"],
	["m09", "y2026", "09"],
	["d0910", "m09", time(2026, 9, 10)],
	["entry", "d0910", "Journal entry"],
	["notes", "cal", "Notes"],
	["call", "notes", `Call ${time(2026, 9, 11)}`],
];

const METADATA: Record<string, unknown> = {
	cal: {calendar: {root: true, levels: {year: true, month: true, day: true}}},
	y2026: {calendar: {level: "year", value: "2026", timestamp: 1, dateId: 20_260_000}},
	m09: {calendar: {level: "month", value: "9", timestamp: 1, dateId: 20_260_900}},
	d0910: {calendar: {level: "day", value: "10", timestamp: 1, dateId: 20_260_910}},
};

const open: DatabaseConstructor.Database[] = [];
afterEach(() => {
	for (const sqlite of open.splice(0)) {
		sqlite.close();
	}
});

function app({
	names = {},
	rootTagged = true,
	layoutEnabled = false,
}: {names?: Record<string, string>; rootTagged?: boolean; layoutEnabled?: boolean} = {}) {
	const sqlite = new DatabaseConstructor(":memory:");
	open.push(sqlite);
	const db = drizzle(sqlite, {schema});
	migrate(db, {migrationsFolder});
	for (const [id, parentId, name] of TREE) {
		db.insert(schema.nodeContent)
			.values({
				id,
				name: names[id] ?? name,
				parentId,
				systemFrom: "2026-01-01",
				systemTo: FAR_FUTURE_DATE,
			})
			.run();
	}
	for (const [nodeId, metadata] of Object.entries(METADATA)) {
		if (nodeId !== "cal" || rootTagged) {
			db.insert(schema.nodeInternalMetadata)
				.values({nodeId, metadataJson: JSON.stringify(metadata), fetchedAt: 1})
				.run();
		}
	}
	const calls: string[] = [];
	const fake = {
		getEntropyKey: async () => Promise.resolve("k"),
		getRootMeta: async (path: string[]) => {
			calls.push(`getRootMeta ${path.join(".")}`);
			return Promise.resolve(path[0] === "dateFormat" ? "YYYY-MM-DD ddd" : undefined);
		},
		applyCalendarLayout: async (levels: unknown, options: unknown) => {
			calls.push(`applyCalendarLayout ${JSON.stringify(levels)} ${JSON.stringify(options)}`);
			if (JSON.stringify(levels).includes("week")) {
				throw new CalendarWeekUnsupported();
			}
			return Promise.resolve({rootId: "cal", writes: 3});
		},
		undoCalendarLayout: async () => {
			calls.push("undoCalendarLayout");
			return Promise.resolve(undoes++ === 0 ? {rootId: "cal", writes: 3} : undefined);
		},
	};
	let undoes = 0;
	const ctx = {
		db,
		cacheService: new CacheService(db),
		apiKey: "key",
		calendarLayoutEnabled: layoutEnabled,
		internalAdapter: () => fake as unknown as WorkflowyInternalAdapter,
	} as unknown as ServerContext;
	const hono = new Hono<AppEnv>();
	hono.use("*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});
	hono.route("/api/v1/calendar", createCalendarRouter());
	const request = async (path: string, init?: RequestInit) => {
		const res = await hono.fetch(new Request(`http://x/api/v1/calendar/${path}`, init));
		return {status: res.status, body: (await res.json()) as unknown};
	};
	const preview = async (body: unknown) =>
		request("layout/preview", {
			method: "POST",
			headers: {"content-type": "application/json"},
			body: JSON.stringify(body),
		});
	const send = async (method: string, path: string, body?: unknown) =>
		request(path, {
			method,
			headers: {"content-type": "application/json"},
			...(body === undefined ? {} : {body: JSON.stringify(body)}),
		});
	return {request, preview, send, calls};
}

describe("GET /api/v1/calendar/layout", () => {
	it("returns the root's levels, the levels with custom text, and whether Update Layout must confirm", async () => {
		const {request} = app();
		await expect(request("layout")).resolves.toStrictEqual({
			status: 200,
			body: {
				levels: {year: true, month: true, day: true},
				customLevels: [],
				needsConfirm: true,
				applyEnabled: false,
			},
		});
	});

	it("flags a month renamed away from the date format's name", async () => {
		const {request} = app({names: {m09: "September plans"}});
		await expect(request("layout")).resolves.toStrictEqual({
			status: 200,
			body: {
				levels: {year: true, month: true, day: true},
				customLevels: ["month"],
				needsConfirm: true,
				applyEnabled: false,
			},
		});
	});

	it("is 409 when the calendar root's internal metadata is not cached", async () => {
		const {request} = app({rootTagged: false});
		await expect(request("layout")).resolves.toStrictEqual({
			status: 409,
			body: {error: "The 📆 Calendar root's internal metadata is not cached"},
		});
	});
});

describe("POST /api/v1/calendar/layout/preview", () => {
	it("plans the restructure without writing anything", async () => {
		const {preview, calls} = app();
		await expect(preview({levels: {year: true, month: false, week: false}})).resolves.toStrictEqual({
			status: 200,
			body: {
				steps: [
					{
						op: "set-calendar",
						id: "call",
						calendar: {
							level: "day",
							value: "11",
							timestamp: new Date(2026, 8, 11).getTime(),
							dateId: 20_260_911,
						},
					},
					{op: "set-levels", id: "cal", levels: {year: true, day: true}},
					{op: "move", id: "d0910", parentId: "y2026", index: 0, from: {parentId: "m09", index: 0}},
					{op: "move", id: "call", parentId: "y2026", index: 1, from: {parentId: "notes", index: 0}},
					{op: "delete", id: "m09", from: {parentId: "y2026", index: 2}},
				],
			},
		});
		expect(calls).toStrictEqual(["getRootMeta dateFormat"]);
	});

	it("plans under an explicit root with random ids for new level nodes, not the account's deterministic ones", async () => {
		const {preview} = app();
		const {status, body} = await preview({levels: {year: true, month: true}, rootId: "notes"});
		const steps = z.object({steps: z.array(z.object({op: z.string(), id: z.string()}).loose())}).parse(body).steps;
		const created = steps.filter((step) => step.op === "create").map((step) => step.id);
		expect({
			status,
			ops: steps.map((step) => `${step.op} ${step.op === "create" ? "" : step.id}`),
			deterministic: created.filter(
				(id) =>
					id === calendarNodeId("k", "year", 20_260_000) || id === calendarNodeId("k", "month", 20_260_900),
			),
		}).toStrictEqual({
			status: 200,
			ops: ["set-calendar call", "set-levels notes", "create ", "create ", "move call"],
			deterministic: [],
		});
	});

	it("is 422 for week levels and 400 for a malformed body", async () => {
		const {preview} = app();
		expect([await preview({levels: {week: true}}), await preview({levels: "year"})]).toStrictEqual([
			{status: 422, body: {error: "Calendar week levels are not supported"}},
			{status: 400, body: {error: "levels must be an object of year, month, week and day booleans"}},
		]);
	});
});

describe("PUT /api/v1/calendar/layout and POST /api/v1/calendar/layout/undo", () => {
	it("are 403 while CALENDAR_LAYOUT_ENABLED is off, and write nothing", async () => {
		const {send, calls} = app();
		const disabled = {
			status: 403,
			body: {error: "Applying calendar layouts is disabled (CALENDAR_LAYOUT_ENABLED)"},
		};
		expect({
			put: await send("PUT", "layout", {levels: {year: true}}),
			undo: await send("POST", "layout/undo"),
			calls,
		}).toStrictEqual({put: disabled, undo: disabled, calls: []});
	});

	it("applies the levels (to an explicit root when given), reports enabled, and undoes once", async () => {
		const {request, send, calls} = app({layoutEnabled: true});
		expect({
			layout: await request("layout"),
			tagged: await send("PUT", "layout", {levels: {year: true, month: false}}),
			sandbox: await send("PUT", "layout", {levels: {year: true}, rootId: "sandbox-cal"}),
			week: await send("PUT", "layout", {levels: {week: true}}),
			bad: await send("PUT", "layout", {levels: {year: true}, rootId: 7}),
			undo: await send("POST", "layout/undo"),
			nothing: await send("POST", "layout/undo"),
			calls,
		}).toStrictEqual({
			layout: {
				status: 200,
				body: {
					levels: {year: true, month: true, day: true},
					customLevels: [],
					needsConfirm: true,
					applyEnabled: true,
				},
			},
			tagged: {status: 200, body: {rootId: "cal", writes: 3}},
			sandbox: {status: 200, body: {rootId: "cal", writes: 3}},
			week: {status: 422, body: {error: "Calendar week levels are not supported"}},
			bad: {status: 400, body: {error: "levels must be an object of year, month, week and day booleans"}},
			undo: {status: 200, body: {rootId: "cal", writes: 3}},
			nothing: {status: 409, body: {error: "There is no calendar layout to undo"}},
			calls: [
				"getRootMeta dateFormat",
				'applyCalendarLayout {"year":true,"month":false} {}',
				'applyCalendarLayout {"year":true} {"rootId":"sandbox-cal"}',
				'applyCalendarLayout {"week":true} {}',
				"undoCalendarLayout",
				"undoCalendarLayout",
			],
		});
	});
});
