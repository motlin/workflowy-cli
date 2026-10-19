/**
 * 📆 Calendar date nodes, created the way upstream's Today does so
 * workflowy.com recognises them (deterministic ids and calendar metadata).
 *
 * `GET /api/v1/calendar/day/:dateId` -> 200 `{id}` / 404 (read-only lookup).
 * `POST /api/v1/calendar/day/:dateId/ensure` -> 200 `{dayId, firstChildId, created}`,
 * or 403 unless `CALENDAR_ENSURE_ENABLED` is on.
 */

import {CalendarRootMissing, parseDateId} from "@workflowy/shared/internal";
import {Hono} from "hono";
import {findCalendarDay} from "../calendar-day.js";
import type {AppEnv} from "../context.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";

const ENSURE_DISABLED = "Calendar day ensure is disabled (set CALENDAR_ENSURE_ENABLED=true to enable it)";
const INVALID_DATE_ID = "dateId must be a YYYYMMDD calendar day";

/** A `YYYYMMDD` path segment as a real calendar day's dateId, else undefined. */
function dayDateId(raw: string): number | undefined {
	const dateId = Number(raw);
	return /^\d{8}$/u.test(raw) && parseDateId(dateId) !== undefined ? dateId : undefined;
}

export function createCalendarRouter(): Hono<AppEnv> {
	const router = new Hono<AppEnv>();

	router.get("/day/:dateId", async (c) => {
		const dateId = dayDateId(c.req.param("dateId"));
		if (dateId === undefined) {
			return c.json({error: INVALID_DATE_ID}, 400);
		}
		const ctx = c.get("ctx");
		let entropyKey: string | undefined;
		try {
			entropyKey = await ctx.internalAdapter?.()?.getEntropyKey();
		} catch (error) {
			// The metadata and name lookups still find most days without it.
			console.error("Failed to read the account entropy key", error);
		}
		const id = findCalendarDay(
			{db: ctx.db, cache: ctx.cacheService, ...(entropyKey === undefined ? {} : {entropyKey})},
			dateId,
		);
		return id === null ? c.json({error: "Calendar day not found"}, 404) : c.json({id});
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
