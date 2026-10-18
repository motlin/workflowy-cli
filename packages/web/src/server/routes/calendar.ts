/**
 * 📆 Calendar date nodes, created the way upstream's Today does so
 * workflowy.com recognises them (deterministic ids and calendar metadata).
 *
 * `POST /api/v1/calendar/day/:dateId/ensure` -> 200 `{dayId, firstChildId, created}`.
 */

import {CalendarRootMissing, parseDateId} from "@workflowy/shared/internal";
import {Hono} from "hono";
import type {AppEnv} from "../context.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";

export function createCalendarRouter(): Hono<AppEnv> {
	const router = new Hono<AppEnv>();

	router.post("/day/:dateId/ensure", async (c) => {
		const ctx = c.get("ctx");
		// Tree writes refresh the cache through the public API, so they need its key too.
		const adapter = ctx.apiKey ? ctx.internalAdapter?.() : undefined;
		if (!adapter) {
			return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
		}
		const raw = c.req.param("dateId");
		const dateId = Number(raw);
		if (!/^\d{8}$/u.test(raw) || parseDateId(dateId) === undefined) {
			return c.json({error: "dateId must be a YYYYMMDD calendar day"}, 400);
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
