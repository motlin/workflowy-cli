/**
 * Expansion state, synced with workflowy.com through the internal API.
 *
 * `GET /api/v1/expansion` -> `{expandedIds, fetchedAt, refreshing}`, possibly from cached keys, with an `ETag` of
 * the keys (`If-None-Match` answers 304); `refreshing` says a background re-read of upstream's keys is still
 * running, and `?wait=1` collects its result. `?fresh=1` waits on a re-read of upstream's keys (throttled and
 * bounded by the adapter). `PATCH /api/v1/expansion` with `{changes: {[nodeId]: boolean}}` -> 204. PATCHes are
 * debounced like upstream: one push 500ms after the last PATCH, the latest value per id winning. A failed push is
 * retried on a backoff with its changes merged under newer PATCHes.
 */

import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import {Hono} from "hono";
import {z} from "zod";
import type {AppEnv} from "../context.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";

const FLUSH_DELAY_MS = 500;

/** Waits before each retry of a failed push; once exhausted the changes are dropped with a log. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

const PatchSchema = z.object({changes: z.record(z.string(), z.boolean())});

const LeftBarPatchSchema = z.object({
	changes: z.record(z.string().regex(/^leftbar__(home|starred)__/u), z.boolean()),
});

export function createExpansionRouter(): Hono<AppEnv> {
	const router = new Hono<AppEnv>();
	let pending: Record<string, boolean> = {};
	let timer: ReturnType<typeof setTimeout> | undefined;

	let failures = 0;

	const flush = (adapter: WorkflowyInternalAdapter) => {
		const changes = pending;
		pending = {};
		adapter.setExpanded(changes).then(
			() => {
				failures = 0;
				return;
			},
			(error: unknown) => {
				pending = {...changes, ...pending};
				const delay = RETRY_DELAYS_MS[failures];
				failures += 1;
				if (delay === undefined) {
					console.error("Failed to push expansion changes; giving up", error);
					failures = 0;
					pending = {};
					return;
				}
				console.error(`Failed to push expansion changes; retrying in ${delay}ms`, error);
				clearTimeout(timer);
				timer = setTimeout(() => {
					flush(adapter);
				}, delay);
			},
		);
	};

	router.get("/", async (c) => {
		const adapter = c.get("ctx").internalAdapter?.();
		if (!adapter) {
			return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
		}
		const {fingerprint, ...state} = await adapter.getExpansionState({
			fresh: c.req.query("fresh") === "1",
			wait: c.req.query("wait") === "1",
		});
		const etag = `"${fingerprint}"`;
		c.header("ETag", etag);
		if (c.req.header("if-none-match") === etag) {
			return c.body(null, 304);
		}
		return c.json(state);
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
