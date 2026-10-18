/** The signed-in Workflowy account: `GET /` -> `{userId, joinedAt}` (ISO date). */

import {Hono} from "hono";
import type {AppEnv} from "../context.js";
import {withAdapter} from "../internal-api.js";

export function createAccountRouter(): Hono<AppEnv> {
	const router = new Hono<AppEnv>();

	router.get(
		"/",
		withAdapter(async (c, adapter) => {
			const {userId, joinedAt} = await adapter.getAccount();
			return c.json({userId, joinedAt: joinedAt.toISOString()});
		}),
	);

	return router;
}
