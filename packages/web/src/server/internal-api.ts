import type {Context} from "hono";
import {createMiddleware} from "hono/factory";
import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import type {AppEnv} from "./context.js";

export const INTERNAL_API_NOT_CONFIGURED =
	"Workflowy internal API is not configured (set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD, or run './bin/run.js internal login')";

/**
 * Gate a route on Workflowy internal-API auth: answers 503 when neither
 * `WORKFLOWY_USERNAME`/`WORKFLOWY_PASSWORD` nor a saved session cookie exist.
 */
export const internalApiRequired = createMiddleware<AppEnv>(async (c, next) => {
	if (!c.get("ctx").internalAuth) {
		return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	}
	return next();
});

type AdapterHandler<P extends string> = (c: Context<AppEnv, P>, adapter: WorkflowyInternalAdapter) => Promise<Response>;

/** Run `handler` with the internal adapter, or answer 503 when it is not configured. */
export function withAdapter<P extends string>(handler: AdapterHandler<P>) {
	return async (c: Context<AppEnv, P>) => {
		const adapter = c.get("ctx").internalAdapter?.();
		return adapter ? handler(c, adapter) : c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	};
}
