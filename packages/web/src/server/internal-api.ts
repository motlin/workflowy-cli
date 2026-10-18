import {createMiddleware} from "hono/factory";
import type {AppEnv} from "./context.js";

/**
 * Gate a route on Workflowy internal-API credentials: answers 503 when
 * `WORKFLOWY_USERNAME`/`WORKFLOWY_PASSWORD` were not configured.
 */
export const internalApiRequired = createMiddleware<AppEnv>(async (c, next) => {
	if (!c.get("ctx").internalCredentials) {
		return c.json(
			{error: "Workflowy internal API is not configured (set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD)"},
			503,
		);
	}
	return next();
});
