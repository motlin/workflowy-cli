/**
 * Account feature flags (upstream `WF.Features`): the server's visible feature list and the
 * enabled dict, plus the enable/disable write.
 *
 * `GET /` -> `{visible, enabled, available}`; without the internal API it answers from the durable
 * `local_settings` copy (`setting:features`) with `available: false`.
 * `POST /:codename` with `{on}` -> `{enabled}`; writes need the account, so no adapter means 503.
 */

import {Hono} from "hono";
import {eq} from "drizzle-orm";
import {z} from "zod";
import {localSettings} from "@workflowy/shared/db";
import type {AppEnv} from "../context.js";
import {withAdapter} from "../internal-api.js";

const CODENAME = /^[a-z0-9_-]+$/u;
const BodySchema = z.object({on: z.boolean()}).strict();
const EnabledSchema = z.record(z.string(), z.literal(true));

export function createFeaturesRouter(): Hono<AppEnv> {
	const router = new Hono<AppEnv>();

	router.get("/", async (c) => {
		const ctx = c.get("ctx");
		const adapter = ctx.internalAdapter?.();
		if (adapter) {
			return c.json({
				visible: await adapter.visibleFeatures(),
				enabled: await adapter.enabledFeatures(),
				available: true,
			});
		}
		const row = ctx.db.select().from(localSettings).where(eq(localSettings.key, "setting:features")).get();
		const stored = row ? EnabledSchema.safeParse(JSON.parse(row.json)) : undefined;
		return c.json({visible: [], enabled: stored?.success ? stored.data : {}, available: false});
	});

	router.post(
		"/:codename",
		withAdapter<"/:codename">(async (c, adapter) => {
			const codename = c.req.param("codename");
			const body = BodySchema.safeParse(await c.req.json().catch(() => {}));
			if (!CODENAME.test(codename) || !body.success) {
				return c.json({error: "expected a feature codename and {on: boolean}"}, 400);
			}
			return c.json({enabled: await adapter.setFeature(codename, body.data.on)});
		}),
	);

	return router;
}
