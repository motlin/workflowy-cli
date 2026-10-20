/**
 * 📆 Calendar date nodes, created the way upstream's Today does so
 * workflowy.com recognises them (deterministic ids and calendar metadata).
 *
 * `GET /api/v1/calendar/day/:dateId[?level=month|year]` -> 200 `{id, firstChildId}` / 404 (read-only lookup of the
 * day, or the month or year node holding it; `firstChildId` is the first live, non-references-root child, or null
 * when the node has none).
 * `GET /api/v1/calendar/days?year=&month=` -> 200 `{days}`: the month's days with
 * journal content, for the date picker's event dots.
 * `GET /api/v1/calendar/dots?from=YYYYMMDD&to=YYYYMMDD` -> 200 `{dateIds}`: the days in the range with journal
 * content, for the day strip's dots.
 * `POST /api/v1/calendar/day/:dateId/ensure[?level=month|year][&createChild=false]` -> 200
 * `{dayId, firstChildId, created}` (`dayId` is the month or year node with `level`), or 403 when
 * `CALENDAR_ENSURE_ENABLED=false`.
 */

import {CalendarRootMissing, parseDateId} from "@workflowy/shared/internal";
import type {CalendarLevel} from "@workflowy/shared/internal";
import {Hono} from "hono";
import {findCalendarDay} from "../calendar-day.js";
import type {CalendarDayDeps} from "../calendar-day.js";
import type {AppEnv, ServerContext} from "../context.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";

const ENSURE_DISABLED = "Calendar day ensure is disabled (CALENDAR_ENSURE_ENABLED=false)";
const INVALID_DATE_ID = "dateId must be a YYYYMMDD calendar day";
const INVALID_MONTH = "year and month must be a calendar year and a 1-12 month";
const INVALID_LEVEL = "level must be day, month or year";
const MAX_DOT_RANGE_DAYS = 100;
const INVALID_RANGE = `from and to must be YYYYMMDD days at most ${MAX_DOT_RANGE_DAYS} days apart, from first`;
const DAY_MS = 86_400_000;

/** The `?level=` query parameter (default day), else undefined. */
function levelParam(raw: string | undefined): CalendarLevel | undefined {
	return raw === undefined ? "day" : raw === "day" || raw === "month" || raw === "year" ? raw : undefined;
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
		const deps = await calendarDayDeps(c.get("ctx"));
		const id = findCalendarDay(deps, dateId, level);
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
		const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
		const days = Array.from({length}, (_, index) => index + 1).filter((day) => {
			const id = findCalendarDay(deps, year * 10_000 + month * 100 + day);
			return id !== null && hasJournalContent(deps, id);
		});
		return c.json({days});
	});

	router.get("/dots", async (c) => {
		const from = dayDateId(c.req.query("from") ?? "");
		const to = dayDateId(c.req.query("to") ?? "");
		const days = from === undefined || to === undefined ? undefined : dayRange(from, to);
		if (days === undefined) {
			return c.json({error: INVALID_RANGE}, 400);
		}
		const deps = await calendarDayDeps(c.get("ctx"));
		const dateIds = days.filter((dateId) => {
			const id = findCalendarDay(deps, dateId);
			return id !== null && hasJournalContent(deps, id);
		});
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
