import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import type {InternalSession, WorkflowyInternalClient} from "../src/api/workflowy-internal-client.js";
import type {WorkflowyWriteThroughClient} from "../src/cache/workflowy-write-through-client.js";
import * as schema from "../src/db/schema.js";
import {WorkflowyInternalAdapter} from "../src/internal/adapter.js";
import type {CreateAtInput, MoveToInput} from "../src/internal/adapter.js";
import {CalendarRootMissing, calendarLevelName, parseDateId} from "../src/internal/calendar-day.js";
import {calendarNodeId} from "../src/internal/calendar-ids.js";
import {FAR_FUTURE_DATE} from "../src/temporal/constants.js";

const migrationsFolder = join(import.meta.dirname, "../src/db/migrations");
const ENTROPY = "e".repeat(64);
const CAL = "cal-root";
const Y2026 = calendarNodeId(ENTROPY, "year", 20_260_000);
const M09 = calendarNodeId(ENTROPY, "month", 20_260_900);
const M10 = calendarNodeId(ENTROPY, "month", 20_261_000);
const D1017 = calendarNodeId(ENTROPY, "day", 20_261_017);

const SESSION: InternalSession = {
	clientId: "client",
	clientVersion: "21",
	userId: 123,
	ownerId: 123,
	dateJoinedSec: 1_500_000_000,
	txId: "1",
	rootMetadata: {dateFormat: "YYYY-MM-DD ddd"},
	settings: {},
	expandedKeys: [],
	entropyKey: ENTROPY,
};

/**
 * A fake adapter world: `children` is the live tree the public API would
 * return, `node_internal_metadata` holds cached calendar metadata, and
 * `createAt`/`moveTo` are spies that edit the live tree.
 */
function setup(options: {
	children: Record<string, string[]>;
	metadata: Record<string, unknown>;
	session?: InternalSession;
}) {
	const sqlite = new DatabaseConstructor(":memory:");
	const db = drizzle(sqlite, {schema});
	migrate(db, {migrationsFolder});
	const children = new Map(Object.entries(options.children).map(([parent, ids]) => [parent, [...ids]]));
	const parentOf = (id: string) => [...children].find(([, ids]) => ids.includes(id))?.[0];
	for (const [parent, ids] of children) {
		for (const id of ids) {
			db.insert(schema.nodeContent)
				.values({
					id,
					name: id,
					parentId: parent === "home" ? null : parent,
					systemFrom: "2026-01-01",
					systemTo: FAR_FUTURE_DATE,
				})
				.run();
		}
	}
	for (const [nodeId, metadata] of Object.entries(options.metadata)) {
		db.insert(schema.nodeInternalMetadata)
			.values({nodeId, metadataJson: JSON.stringify(metadata), fetchedAt: 0})
			.run();
	}
	const session = options.session ?? SESSION;
	const client = {session, bootstrap: async () => Promise.resolve(session)} as unknown as WorkflowyInternalClient;
	const writeThrough = {
		liveChildren: async (parent: string | null) =>
			Promise.resolve((children.get(parent ?? "home") ?? []).map((id) => ({id}))),
	} as unknown as WorkflowyWriteThroughClient;
	const adapter = new WorkflowyInternalAdapter({client, db, writeThrough, now: () => 1_800_000_000_000});
	const calls: unknown[] = [];
	let generated = 0;
	vi.spyOn(adapter, "createAt").mockImplementation(async (input: CreateAtInput) => {
		calls.push(["createAt", input]);
		const id = input.id ?? `random-${++generated}`;
		const list = children.get(input.parentId) ?? [];
		list.splice(input.index, 0, id);
		children.set(input.parentId, list);
		return Promise.resolve({id});
	});
	vi.spyOn(adapter, "moveTo").mockImplementation(async (input: MoveToInput) => {
		calls.push(["moveTo", input]);
		for (const id of input.ids) {
			const from = parentOf(id);
			if (from !== undefined) {
				children.set(
					from,
					(children.get(from) ?? []).filter((child) => child !== id),
				);
			}
		}
		const list = children.get(input.parentId) ?? [];
		list.splice(input.index, 0, ...input.ids);
		children.set(input.parentId, list);
		return Promise.resolve();
	});
	return {sqlite, adapter, calls, children};
}

const ROOT_META = {
	calendar: {root: true, levels: {day: true, year: true, month: true}, day_prefix: true, found_dates: true},
};
const yearMeta = {
	calendar: {level: "year", value: "2026", timestamp: new Date(2026, 0, 1).getTime(), dateId: 20_260_000},
};
const sepMeta = {calendar: {level: "month", value: "9", timestamp: new Date(2026, 8, 1).getTime(), dateId: 20_260_900}};
const novMeta = {
	calendar: {level: "month", value: "11", timestamp: new Date(2026, 10, 1).getTime(), dateId: 20_261_100},
};

describe("calendar day helpers", () => {
	it("parses a YYYYMMDD dateId and rejects impossible dates", () => {
		expect([
			parseDateId(20_261_017),
			parseDateId(20_260_230),
			parseDateId(2_026_101),
			parseDateId(20_261_300),
		]).toStrictEqual([{year: 2026, month: 10, day: 17}, undefined, undefined, undefined]);
	});

	it("names levels from the account date format like upstream", () => {
		const date = {year: 2026, month: 9, day: 8};
		expect([
			calendarLevelName("year", date, "YYYY-MM-DD ddd"),
			calendarLevelName("month", date, "YYYY-MM-DD ddd"),
			calendarLevelName("month", date, ""),
			calendarLevelName("month", date, "[MM] MMMM"),
			calendarLevelName("year", date, "MM/DD/YY"),
			calendarLevelName("day", date, "YYYY-MM-DD ddd"),
		]).toStrictEqual([
			"2026",
			"09",
			"9",
			"September",
			"26",
			'<time startYear="2026" startMonth="9" startDay="8">Tue, Sep 8, 2026</time>',
		]);
	});
});

describe("WorkflowyInternalAdapter.ensureCalendarDay", () => {
	let open: DatabaseConstructor.Database[] = [];
	afterEach(() => {
		for (const sqlite of open) {
			sqlite.close();
		}
		open = [];
	});
	function tracked(options: Parameters<typeof setup>[0]) {
		const result = setup(options);
		open.push(result.sqlite);
		return result;
	}

	it("creates the missing month, the day and one empty child with deterministic ids in timestamp order", async () => {
		const {adapter, calls, children} = tracked({
			children: {home: [CAL], [CAL]: ["note", Y2026], [Y2026]: [M09, "loose", "nov"]},
			metadata: {[CAL]: ROOT_META, [Y2026]: yearMeta, [M09]: sepMeta, nov: novMeta},
		});

		const result = await adapter.ensureCalendarDay(20_261_017);

		expect({result, calls, months: children.get(Y2026)}).toStrictEqual({
			result: {dayId: D1017, firstChildId: "random-1", created: [M10, D1017, "random-1"]},
			calls: [
				[
					"createAt",
					{
						parentId: Y2026,
						index: 2,
						id: M10,
						name: "10",
						metadata: {
							restorableUniqueNode: true,
							calendar: {
								level: "month",
								value: "10",
								timestamp: new Date(2026, 9, 1).getTime(),
								dateId: 20_261_000,
							},
						},
					},
				],
				[
					"createAt",
					{
						parentId: M10,
						index: 0,
						id: D1017,
						name: '<time startYear="2026" startMonth="10" startDay="17">Sat, Oct 17, 2026</time>',
						metadata: {
							restorableUniqueNode: true,
							calendar: {
								level: "day",
								value: "17",
								timestamp: new Date(2026, 9, 17).getTime(),
								dateId: 20_261_017,
							},
						},
					},
				],
				["createAt", {parentId: D1017, index: 0, name: ""}],
			],
			months: [M09, "loose", M10, "nov"],
		});
	});

	it("creates nothing when the day already has children", async () => {
		const dayMeta = {calendar: {level: "day", value: "17", timestamp: 0, dateId: 20_261_017}};
		const octMeta = {calendar: {level: "month", value: "10", timestamp: 0, dateId: 20_261_000}};
		const {adapter, calls} = tracked({
			children: {
				home: [CAL],
				[CAL]: [Y2026],
				[Y2026]: [M09, "oct"],
				oct: ["legacy-day"],
				"legacy-day": ["entry", "other"],
			},
			metadata: {[CAL]: ROOT_META, [Y2026]: yearMeta, [M09]: sepMeta, oct: octMeta, "legacy-day": dayMeta},
		});

		const result = await adapter.ensureCalendarDay(20_261_017);

		expect({result, calls}).toStrictEqual({
			result: {dayId: "legacy-day", firstChildId: "entry", created: []},
			calls: [],
		});
	});

	it("moves a deterministic node that exists elsewhere back under its parent instead of creating it", async () => {
		const {adapter, calls} = tracked({
			children: {home: [CAL, M10], [CAL]: [Y2026], [Y2026]: [M09], [M10]: [D1017], [D1017]: ["entry"]},
			metadata: {[CAL]: ROOT_META, [Y2026]: yearMeta, [M09]: sepMeta},
		});

		const result = await adapter.ensureCalendarDay(20_261_017);

		expect({result, calls}).toStrictEqual({
			result: {dayId: D1017, firstChildId: "entry", created: []},
			calls: [["moveTo", {ids: [M10], parentId: Y2026, index: 1}]],
		});
	});

	it("refuses when no calendar root is cached", async () => {
		const {adapter} = tracked({children: {home: ["a"]}, metadata: {}});

		await expect(adapter.ensureCalendarDay(20_261_017)).rejects.toThrow(CalendarRootMissing);
	});
});
