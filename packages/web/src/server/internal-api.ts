import {createMiddleware} from "hono/factory";
import type {AppEnv} from "./context.js";

/**
 * Gate a route on Workflowy internal-API auth: answers 503 when neither
 * `WORKFLOWY_USERNAME`/`WORKFLOWY_PASSWORD` nor a saved session cookie exist.
 */
export const internalApiRequired = createMiddleware<AppEnv>(async (c, next) => {
	if (!c.get("ctx").internalAuth) {
		return c.json(
			{
				error: "Workflowy internal API is not configured (set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD, or run './bin/run.js internal login')",
			},
			503,
		);
	}
	return next();
});
