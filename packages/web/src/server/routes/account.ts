/** The signed-in Workflowy account: `GET /` -> `{userId, joinedAt, fullName, email}` (ISO date). `email` is the OPML export's ownerEmail, from
 * `WORKFLOWY_USERNAME` (the session does not carry it), and "" when unset. */

import {Hono} from "hono";
import type {AppEnv} from "../context.js";
import {withAdapter} from "../internal-api.js";

export function createAccountRouter(): Hono<AppEnv> {
	const router = new Hono<AppEnv>();

	router.get(
		"/",
		withAdapter(async (c, adapter) => {
			const {userId, joinedAt, fullName} = await adapter.getAccount();
			return c.json({
				userId,
				joinedAt: joinedAt.toISOString(),
				fullName,
				email: c.get("ctx").config.accountEmail,
			});
		}),
	);

	return router;
}
