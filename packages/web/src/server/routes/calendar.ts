/**
 * 📆 Calendar date nodes, created the way upstream's Today does so
 * workflowy.com recognises them (deterministic ids and calendar metadata).
 *
 * `GET /api/v1/calendar/day/:dateId[?level=week|month|year]` -> 200 `{id, firstChildId}` / 404 (read-only lookup of the
 * day, or the week, month or year node holding it; `firstChildId` is the first live, non-references-root child, or null
 * when the node has none).
 * `GET /api/v1/calendar/days?year=&month=[&found=1]` -> 200 `{days}`: the month's days with
 * journal content, for the date picker's event dots; with `found=1` (the strip's picker) also the existing days a
 * dated node elsewhere covers, unless the root turns Found Dates off.
 * `GET /api/v1/calendar/settings` -> 200 `{foundDates, dayPrefix}`: the root's picker toggles, each default true.
 * `PUT /api/v1/calendar/settings` `{foundDates?, dayPrefix?}` -> 200 the new settings; writes the root's
 * `calendar.found_dates` / `calendar.day_prefix` metadata (409 when its internal metadata is not cached).
 * `GET /api/v1/calendar/layout` -> 200 `{levels, customLevels, needsConfirm, applyEnabled}`: what the Calendar Layout
 * dialog opens with (upstream `P10`): the root's levels, the levels whose nodes hold custom text or notes, whether
 * Update Layout first asks "Move nodes into your Calendar?", and whether Update Layout applies or only previews (409
 * without the root's cached internal metadata).
 * `PUT /api/v1/calendar/layout` `{levels, rootId?}` -> 200 `{rootId, writes}`: restructure the calendar (the tagged
 * root, or `rootId`, such as a sandbox copy) in one push, planned from the cache with only the written parents read
 * fresh, reporting each phase's time in `Server-Timing` (403 when `CALENDAR_LAYOUT_ENABLED=false`).
 * `POST /api/v1/calendar/layout/undo` `{rootId?}` -> 200 `{rootId, writes}`: undo the last applied layout once (409 when
 * there is none; 403 like PUT). PUT and undo resolve their root (409 when it is not cached), log it, and hand it to the
 * adapter, which refuses any write outside it.
 * `POST /api/v1/calendar/layout/preview` `{levels, rootId?}` -> 200 `{steps}`: the tree writes upstream's restructure
 * (`JX4`) would make for those levels, planned from the cache (under `rootId` when given); nothing is written.
 * `GET /api/v1/calendar/dots?from=YYYYMMDD&to=YYYYMMDD` -> 200 `{dateIds}`: the days in the range with journal
 * content, for the day strip's dots.
 * `POST /api/v1/calendar/day/:dateId/ensure[?level=week|month|year][&createChild=false]` -> 200
 * `{dayId, firstChildId, created}` (`dayId` is the week, month or year node with `level`), or 403 when
 * `CALENDAR_ENSURE_ENABLED=false`.
 */

import {
	CALENDAR_LEVELS,
	CalendarRootMissing,
	calendarLayoutCustomLevels,
	calendarLayoutNeedsConfirm,
	parseDateId,
	planCalendarLayout,
} from "@workflowy/shared/internal";
import type {CalendarLevel, LayoutTimings} from "@workflowy/shared/internal";
import {Hono} from "hono";
import {z} from "zod";
import {findCalendarDay, findCalendarDays, findTaggedCalendarRoot, readCalendarSettings} from "../calendar-day.js";
import {foundDaysInMonth} from "../calendar-found.js";
import {loadCalendarLayout} from "../calendar-layout.js";
import type {CalendarDayDeps} from "../calendar-day.js";
import type {AppEnv, ServerContext} from "../context.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";

const ENSURE_DISABLED = "Calendar day ensure is disabled (CALENDAR_ENSURE_ENABLED=false)";
const INVALID_DATE_ID = "dateId must be a YYYYMMDD calendar day";
const INVALID_MONTH = "year and month must be a calendar year and a 1-12 month";
const INVALID_LEVEL = "level must be day, week, month or year";
const INVALID_SETTINGS = "foundDates and dayPrefix must be booleans, and at least one is required";
const ROOT_METADATA_MISSING = "The 📆 Calendar root's internal metadata is not cached";
const MAX_DOT_RANGE_DAYS = 100;
const INVALID_RANGE = `from and to must be YYYYMMDD days at most ${MAX_DOT_RANGE_DAYS} days apart, from first`;
const DAY_MS = 86_400_000;
const SettingsBody = z.object({foundDates: z.boolean().optional(), dayPrefix: z.boolean().optional()});
const LAYOUT_DISABLED = "Applying calendar layouts is disabled (CALENDAR_LAYOUT_ENABLED)";
const NOTHING_TO_UNDO = "There is no calendar layout to undo";
const LAYOUT_ROOT_MISSING = "No calendar root is cached for this layout";
const INVALID_LEVELS = "levels must be an object of year, month, week and day booleans";
const LayoutBody = z.object({
	levels: z.strictObject({
		year: z.boolean().optional(),
		month: z.boolean().optional(),
		week: z.boolean().optional(),
		day: z.boolean().optional(),
	}),
	rootId: z.string().min(1).optional(),
});
const UndoBody = z.object({rootId: z.string().min(1).optional()});
/**
 * The calendar root a layout write targets: `explicitRootId` (a sandbox copy) or the tagged root, and only when that
 * node is cached; undefined otherwise. The adapter is always handed this id, never left to fall back on its own.
 */
function resolveLayoutRoot(ctx: ServerContext, explicitRootId: string | undefined): string | undefined {
	const rootId = explicitRootId ?? findTaggedCalendarRoot({db: ctx.db});
	return rootId !== undefined && ctx.cacheService.getNode(rootId) !== undefined ? rootId : undefined;
}

/** Upstream `I10`'s levels when the root has none. */
const DEFAULT_LAYOUT_LEVELS = {year: true, month: true, day: true};

/** The account date format, which names year and month nodes; empty (upstream's defaults) without the internal API. */
async function accountDateFormat(ctx: ServerContext): Promise<string> {
	const dateFormat = await ctx.internalAdapter?.()?.getRootMeta(["dateFormat"]);
	return typeof dateFormat === "string" ? dateFormat : "";
}

/** The account's `weekStartDay`, which places weeks; undefined (Sunday) when unset or without the internal API. */
async function accountWeekStartDay(ctx: ServerContext): Promise<number | undefined> {
	const weekStartDay = await ctx.internalAdapter?.()?.getRootMeta(["weekStartDay"]);
	return typeof weekStartDay === "number" ? weekStartDay : undefined;
}

/** The `?level=` query parameter (default day), else undefined. */
function levelParam(raw: string | undefined): CalendarLevel | undefined {
	return raw === undefined ? "day" : CALENDAR_LEVELS.find((level) => level === raw);
}

/** A day dateId's UTC midnight. */
function utcOf(dateId: number): number {
	return Date.UTC(Math.floor(dateId / 10_000), (Math.floor(dateId / 100) % 100) - 1, dateId % 100);
}

/** The days from `from` to `to` inclusive as dateIds, or undefined when the range is reversed or too long. */
function dayRange(from: number, to: number): number[] | undefined {
	const start = utcOf(from);
	const length = Math.round((utcOf(to) - start) / DAY_MS) + 1;
	if (length < 1 || length > MAX_DOT_RANGE_DAYS) {
		return undefined;
	}
	return Array.from({length}, (_, index) => {
		const date = new Date(start + index * DAY_MS);
		return date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
	});
}

/** A `YYYYMMDD` path segment as a real calendar day's dateId, else undefined. */
function dayDateId(raw: string): number | undefined {
	const dateId = Number(raw);
	return /^\d{8}$/u.test(raw) && parseDateId(dateId) !== undefined ? dateId : undefined;
}

/** A query parameter as an integer in `[min, max]`, else undefined. */
function intParam(raw: string | undefined, min: number, max: number): number | undefined {
	const value = Number(raw);
	return raw !== undefined && /^\d+$/u.test(raw) && value >= min && value <= max ? value : undefined;
}

/** The lookup deps, with the account entropy key when the internal API can supply it. */
async function calendarDayDeps(ctx: ServerContext): Promise<CalendarDayDeps> {
	try {
		const entropyKey = await ctx.internalAdapter?.()?.getEntropyKey();
		return {db: ctx.db, cache: ctx.cacheService, ...(entropyKey === undefined ? {} : {entropyKey})};
	} catch (error) {
		// The metadata and name lookups still find most days without it.
		console.error("Failed to read the account entropy key", error);
		return {db: ctx.db, cache: ctx.cacheService};
	}
}

/** Upstream's event-dot test: two or more children, or a first child with a name or a note. */
function hasJournalContent(deps: CalendarDayDeps, dayId: string): boolean {
	const children = deps.cache.getChildren(dayId);
	const [first] = children;
	return children.length >= 2 || Boolean(first?.name) || Boolean(first?.note);
}

/** The day's first live child that is not its references root, or null; Today puts the caret there. */
function firstDayChild(deps: CalendarDayDeps, dayId: string): string | null {
	return deps.cache.getChildrenWithMergedData(dayId).find((child) => child.referencesRoot == null)?.id ?? null;
}

export function createCalendarRouter(): Hono<AppEnv> {
	const router = new Hono<AppEnv>();

	router.get("/day/:dateId", async (c) => {
		const dateId = dayDateId(c.req.param("dateId"));
		if (dateId === undefined) {
			return c.json({error: INVALID_DATE_ID}, 400);
		}
		const level = levelParam(c.req.query("level"));
		if (level === undefined) {
			return c.json({error: INVALID_LEVEL}, 400);
		}
		const ctx = c.get("ctx");
		const deps = await calendarDayDeps(ctx);
		const weekStartDay = level === "week" ? await accountWeekStartDay(ctx) : undefined;
		const id = findCalendarDay(weekStartDay === undefined ? deps : {...deps, weekStartDay}, dateId, level);
		return id === null
			? c.json({error: "Calendar day not found"}, 404)
			: c.json({id, firstChildId: firstDayChild(deps, id)});
	});

	router.get("/days", async (c) => {
		const year = intParam(c.req.query("year"), 1, 9999);
		const month = intParam(c.req.query("month"), 1, 12);
		if (year === undefined || month === undefined) {
			return c.json({error: INVALID_MONTH}, 400);
		}
		const deps = await calendarDayDeps(c.get("ctx"));
		// Upstream `S10`: a found date dots only a day whose node exists.
		const found =
			c.req.query("found") === "1" && readCalendarSettings(deps).foundDates
				? foundDaysInMonth(deps, year, month)
				: new Set<number>();
		const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
		const dayIds = findCalendarDays(
			deps,
			Array.from({length}, (_, index) => year * 10_000 + month * 100 + index + 1),
		);
		const days = [...dayIds]
			.filter(([dateId, id]) => hasJournalContent(deps, id) || found.has(dateId % 100))
			.map(([dateId]) => dateId % 100);
		return c.json({days});
	});

	router.get("/settings", (c) => {
		const ctx = c.get("ctx");
		return c.json(readCalendarSettings({db: ctx.db, cache: ctx.cacheService}));
	});

	router.put("/settings", async (c) => {
		const ctx = c.get("ctx");
		const body = SettingsBody.safeParse(await c.req.json().catch(() => null));
		const changes = body.success
			? [
					...(body.data.foundDates === undefined
						? []
						: [{path: ["calendar", "found_dates"], value: body.data.foundDates}]),
					...(body.data.dayPrefix === undefined
						? []
						: [{path: ["calendar", "day_prefix"], value: body.data.dayPrefix}]),
				]
			: [];
		if (changes.length === 0) {
			return c.json({error: INVALID_SETTINGS}, 400);
		}
		const adapter = ctx.apiKey ? ctx.internalAdapter?.() : undefined;
		if (!adapter) {
			return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
		}
		const rootId = findTaggedCalendarRoot({db: ctx.db});
		if (rootId === undefined) {
			return c.json({error: ROOT_METADATA_MISSING}, 409);
		}
		await adapter.setNodeMetaValues(rootId, changes);
		return c.json(readCalendarSettings({db: ctx.db, cache: ctx.cacheService}));
	});

	router.get("/layout", async (c) => {
		const ctx = c.get("ctx");
		const snapshot = loadCalendarLayout({db: ctx.db, cache: ctx.cacheService});
		if (snapshot === undefined) {
			return c.json({error: ROOT_METADATA_MISSING}, 409);
		}
		return c.json({
			levels: snapshot.levels ?? DEFAULT_LAYOUT_LEVELS,
			customLevels: calendarLayoutCustomLevels(snapshot.root, await accountDateFormat(ctx)),
			needsConfirm: calendarLayoutNeedsConfirm(snapshot.root),
			applyEnabled: ctx.calendarLayoutEnabled !== false,
		});
	});

	router.put("/layout", async (c) => {
		const ctx = c.get("ctx");
		if (ctx.calendarLayoutEnabled === false) {
			return c.json({error: LAYOUT_DISABLED}, 403);
		}
		const body = LayoutBody.safeParse(await c.req.json().catch(() => null));
		if (!body.success) {
			return c.json({error: INVALID_LEVELS}, 400);
		}
		const adapter = ctx.apiKey ? ctx.internalAdapter?.() : undefined;
		if (!adapter) {
			return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
		}
		const {levels} = body.data;
		const rootId = resolveLayoutRoot(ctx, body.data.rootId);
		if (rootId === undefined) {
			return c.json({error: LAYOUT_ROOT_MISSING}, 409);
		}
		console.info(`calendar layout: applying under root ${rootId}`);
		const timings: LayoutTimings = {};
		try {
			const applied = await adapter.applyCalendarLayout(levels, {
				rootId,
				loadSnapshot: () => loadCalendarLayout({db: ctx.db, cache: ctx.cacheService}, rootId),
				timings,
			});
			const phases = Object.entries(timings).map(([phase, ms]) => `${phase};dur=${ms.toFixed(1)}`);
			console.info(
				`calendar layout: ${applied.writes} writes under root ${applied.rootId} (${phases.join(", ")})`,
			);
			c.header("Server-Timing", phases.join(", "));
			return c.json(applied);
		} catch (error) {
			if (error instanceof CalendarRootMissing) {
				return c.json({error: error.message}, 409);
			}
			throw error;
		}
	});

	router.post("/layout/undo", async (c) => {
		const ctx = c.get("ctx");
		if (ctx.calendarLayoutEnabled === false) {
			return c.json({error: LAYOUT_DISABLED}, 403);
		}
		const adapter = ctx.apiKey ? ctx.internalAdapter?.() : undefined;
		if (!adapter) {
			return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
		}
		const body = UndoBody.safeParse(await c.req.json().catch(() => ({})));
		const rootId = resolveLayoutRoot(ctx, body.data?.rootId);
		if (rootId === undefined) {
			return c.json({error: LAYOUT_ROOT_MISSING}, 409);
		}
		console.info(`calendar layout: undoing under root ${rootId}`);
		const undone = await adapter.undoCalendarLayout(rootId);
		return undone === undefined ? c.json({error: NOTHING_TO_UNDO}, 409) : c.json(undone);
	});

	router.post("/layout/preview", async (c) => {
		const ctx = c.get("ctx");
		const body = LayoutBody.safeParse(await c.req.json().catch(() => null));
		if (!body.success) {
			return c.json({error: INVALID_LEVELS}, 400);
		}
		const {rootId} = body.data;
		const snapshot = loadCalendarLayout({db: ctx.db, cache: ctx.cacheService}, rootId);
		if (snapshot === undefined) {
			return c.json({error: ROOT_METADATA_MISSING}, 409);
		}
		// An explicit (sandbox) root gets random ids, as applying it does: deterministic ids belong to the real calendar.
		const {entropyKey} = rootId === undefined ? await calendarDayDeps(ctx) : {entropyKey: undefined};
		const weekStartDay = await accountWeekStartDay(ctx);
		const steps = planCalendarLayout(snapshot.root, body.data.levels, {
			...(snapshot.levels === undefined ? {} : {currentLevels: snapshot.levels}),
			dateFormat: await accountDateFormat(ctx),
			...(weekStartDay === undefined ? {} : {weekStartDay}),
			...(entropyKey === undefined ? {} : {entropyKey}),
		});
		return c.json({steps});
	});

	router.get("/dots", async (c) => {
		const from = dayDateId(c.req.query("from") ?? "");
		const to = dayDateId(c.req.query("to") ?? "");
		const days = from === undefined || to === undefined ? undefined : dayRange(from, to);
		if (days === undefined) {
			return c.json({error: INVALID_RANGE}, 400);
		}
		const deps = await calendarDayDeps(c.get("ctx"));
		const dateIds = [...findCalendarDays(deps, days)]
			.filter(([, id]) => hasJournalContent(deps, id))
			.map(([dateId]) => dateId);
		return c.json({dateIds});
	});

	router.post("/day/:dateId/ensure", async (c) => {
		const ctx = c.get("ctx");
		if (ctx.calendarEnsureEnabled !== true) {
			return c.json({error: ENSURE_DISABLED}, 403);
		}
		// Tree writes refresh the cache through the public API, so they need its key too.
		const adapter = ctx.apiKey ? ctx.internalAdapter?.() : undefined;
		if (!adapter) {
			return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
		}
		const dateId = dayDateId(c.req.param("dateId"));
		if (dateId === undefined) {
			return c.json({error: INVALID_DATE_ID}, 400);
		}
		const stopAt = levelParam(c.req.query("level"));
		if (stopAt === undefined) {
			return c.json({error: INVALID_LEVEL}, 400);
		}
		try {
			return c.json(
				await adapter.ensureCalendarDay(dateId, {stopAt, createChild: c.req.query("createChild") !== "false"}),
			);
		} catch (error) {
			if (error instanceof CalendarRootMissing) {
				return c.json({error: error.message}, 409);
			}
			throw error;
		}
	});

	return router;
}
