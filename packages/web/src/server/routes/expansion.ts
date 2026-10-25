/**
 * Expansion state, synced with workflowy.com through the internal API.
 *
 * `GET /api/v1/expansion` -> `{expandedIds}`, possibly from cached keys;
 * `?fresh=1` waits on a re-read of upstream's keys (throttled by the adapter). `PATCH /api/v1/expansion` with
 * `{changes: {[nodeId]: boolean}}` -> 204. PATCHes are debounced like
 * upstream: one push 500ms after the last PATCH, the latest value per id winning.
 */

import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import {Hono} from "hono";
import {z} from "zod";
import type {AppEnv} from "../context.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";

const FLUSH_DELAY_MS = 500;

const PatchSchema = z.object({changes: z.record(z.string(), z.boolean())});

const LeftBarPatchSchema = z.object({
	changes: z.record(z.string().regex(/^leftbar__(home|starred)__/u), z.boolean()),
});

export function createExpansionRouter(): Hono<AppEnv> {
	const router = new Hono<AppEnv>();
	let pending: Record<string, boolean> = {};
	let timer: ReturnType<typeof setTimeout> | undefined;

	const flush = (adapter: WorkflowyInternalAdapter) => {
		const changes = pending;
		pending = {};
		adapter.setExpanded(changes).catch((error: unknown) => {
			console.error("Failed to push expansion changes", error);
		});
	};

	router.get("/", async (c) => {
		const adapter = c.get("ctx").internalAdapter?.();
		if (!adapter) {
			return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
		}
		return c.json({expandedIds: await adapter.getExpandedIds({fresh: c.req.query("fresh") === "1"})});
	});

	router.patch("/", async (c) => {
		const adapter = c.get("ctx").internalAdapter?.();
		if (!adapter) {
			return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
		}
		const body = PatchSchema.safeParse(await c.req.json().catch(() => {}));
		if (!body.success) {
			return c.json({error: "body must be {changes: {[nodeId]: boolean}}"}, 400);
		}
		pending = {...pending, ...body.data.changes};
		clearTimeout(timer);
		timer = setTimeout(() => {
			flush(adapter);
		}, FLUSH_DELAY_MS);
		return c.body(null, 204);
	});

	let pendingRaw: Record<string, boolean> = {};
	let rawTimer: ReturnType<typeof setTimeout> | undefined;

	router.get("/left-bar", async (c) => {
		const adapter = c.get("ctx").internalAdapter?.();
		if (!adapter) {
			return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
		}
		return c.json({keys: await adapter.getLeftBarExpansionKeys()});
	});

	router.patch("/left-bar", async (c) => {
		const adapter = c.get("ctx").internalAdapter?.();
		if (!adapter) {
			return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
		}
		const body = LeftBarPatchSchema.safeParse(await c.req.json().catch(() => {}));
		if (!body.success) {
			return c.json({error: "body must be {changes: {[leftbar__home__|leftbar__starred__ key]: boolean}}"}, 400);
		}
		pendingRaw = {...pendingRaw, ...body.data.changes};
		clearTimeout(rawTimer);
		rawTimer = setTimeout(() => {
			const changes = pendingRaw;
			pendingRaw = {};
			adapter.setRawExpansionKeys(changes).catch((error: unknown) => {
				console.error("Failed to push left-bar expansion changes", error);
			});
		}, FLUSH_DELAY_MS);
		return c.body(null, 204);
	});

	return router;
}
