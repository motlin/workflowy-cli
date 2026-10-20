/**
 * 📆 Calendar date nodes, created the way upstream's Today does so
 * workflowy.com recognises them (deterministic ids and calendar metadata).
 *
 * `GET /api/v1/calendar/day/:dateId` -> 200 `{id, firstChildId}` / 404 (read-only lookup; `firstChildId` is the
 * first live, non-references-root child, or null when the day has none).
 * `GET /api/v1/calendar/days?year=&month=` -> 200 `{days}`: the month's days with
 * journal content, for the date picker's event dots.
 * `POST /api/v1/calendar/day/:dateId/ensure` -> 200 `{dayId, firstChildId, created}`,
 * or 403 when `CALENDAR_ENSURE_ENABLED=false`.
 */

import {CalendarRootMissing, parseDateId} from "@workflowy/shared/internal";
import {Hono} from "hono";
import {findCalendarDay} from "../calendar-day.js";
import type {CalendarDayDeps} from "../calendar-day.js";
import type {AppEnv, ServerContext} from "../context.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";

const ENSURE_DISABLED = "Calendar day ensure is disabled (CALENDAR_ENSURE_ENABLED=false)";
const INVALID_DATE_ID = "dateId must be a YYYYMMDD calendar day";
const INVALID_MONTH = "year and month must be a calendar year and a 1-12 month";

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
		const deps = await calendarDayDeps(c.get("ctx"));
		const id = findCalendarDay(deps, dateId);
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
		try {
			return c.json(await adapter.ensureCalendarDay(dateId));
		} catch (error) {
			if (error instanceof CalendarRootMissing) {
				return c.json({error: error.message}, 409);
			}
			throw error;
		}
	});

	return router;
}
