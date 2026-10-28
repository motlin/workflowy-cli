/**
 * Expansion state, synced with workflowy.com through the internal API.
 *
 * `expansion.get` -> `{expandedIds, fetchedAt, refreshing}`, possibly from cached keys, with an `ETag` of the keys
 * (`ifNoneMatch` equal to it answers not-modified, so the body never crosses RPC); `refreshing` says a background
 * re-read of upstream's keys is still running, and `wait` collects its result. `fresh` waits on a re-read of
 * upstream's keys (throttled and bounded by the adapter). `expansion.patch` with `{changes: {[nodeId]: boolean}}` ->
 * null (204). PATCHes are debounced like upstream: one push 500ms after the last PATCH, the latest value per id
 * winning. A failed push is retried on a backoff with its changes merged under newer PATCHes. The debounce state
 * lives per server context, i.e. per Durable Object or Node host.
 */

import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import {z} from "zod";
import type {ServerContext} from "../context.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api-error.js";
import {defineOp, fail, jsonOf, ok} from "./define.js";

const FLUSH_DELAY_MS = 500;

/** Waits before each retry of a failed push; once exhausted the changes are dropped with a log. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

const ExpansionPatchSchema = z.object({changes: z.record(z.string(), z.boolean())});

const LeftBarPatchSchema = z.object({
	changes: z.record(z.string().regex(/^leftbar__(home|starred)__/u), z.boolean()),
});

interface ExpansionState {
	pending: Record<string, boolean>;
	timer: ReturnType<typeof setTimeout> | undefined;
	failures: number;
	pendingRaw: Record<string, boolean>;
	rawTimer: ReturnType<typeof setTimeout> | undefined;
}

const states = new WeakMap<ServerContext, ExpansionState>();

function stateOf(ctx: ServerContext): ExpansionState {
	let state = states.get(ctx);
	if (state === undefined) {
		state = {pending: {}, timer: undefined, failures: 0, pendingRaw: {}, rawTimer: undefined};
		states.set(ctx, state);
	}
	return state;
}

function flush(state: ExpansionState, adapter: WorkflowyInternalAdapter) {
	const changes = state.pending;
	state.pending = {};
	adapter.setExpanded(changes).then(
		() => {
			state.failures = 0;
			return;
		},
		(error: unknown) => {
			state.pending = {...changes, ...state.pending};
			const delay = RETRY_DELAYS_MS[state.failures];
			state.failures += 1;
			if (delay === undefined) {
				console.error("Failed to push expansion changes; giving up", error);
				state.failures = 0;
				state.pending = {};
				return;
			}
			console.error(`Failed to push expansion changes; retrying in ${delay}ms`, error);
			clearTimeout(state.timer);
			state.timer = setTimeout(() => {
				flush(state, adapter);
			}, delay);
		},
	);
}

const notConfigured = () => fail(503, {error: INTERNAL_API_NOT_CONFIGURED});

export const expansionGet = defineOp({
	input: z.object({
		fresh: z.boolean().default(false),
		wait: z.boolean().default(false),
		ifNoneMatch: z.string().optional(),
	}),
	async run(ctx, {fresh, wait, ifNoneMatch}) {
		const adapter = ctx.internalAdapter?.();
		if (!adapter) {
			return notConfigured();
		}
		const {fingerprint, ...state} = await adapter.getExpansionState({fresh, wait});
		const etag = `"${fingerprint}"`;
		if (ifNoneMatch === etag) {
			return ok(null, {etag, notModified: true});
		}
		return ok(jsonOf(state), {etag});
	},
});

export const expansionPatch = defineOp({
	input: ExpansionPatchSchema,
	run(ctx, {changes}) {
		const adapter = ctx.internalAdapter?.();
		if (!adapter) {
			return notConfigured();
		}
		const state = stateOf(ctx);
		state.pending = {...state.pending, ...changes};
		clearTimeout(state.timer);
		state.timer = setTimeout(() => {
			flush(state, adapter);
		}, FLUSH_DELAY_MS);
		return ok(null);
	},
});

export const expansionLeftBarGet = defineOp({
	input: z.object({}),
	async run(ctx) {
		const adapter = ctx.internalAdapter?.();
		if (!adapter) {
			return notConfigured();
		}
		return ok({keys: await adapter.getLeftBarExpansionKeys()});
	},
});

export const expansionLeftBarPatch = defineOp({
	input: LeftBarPatchSchema,
	run(ctx, {changes}) {
		const adapter = ctx.internalAdapter?.();
		if (!adapter) {
			return notConfigured();
		}
		const state = stateOf(ctx);
		state.pendingRaw = {...state.pendingRaw, ...changes};
		clearTimeout(state.rawTimer);
		state.rawTimer = setTimeout(() => {
			const raw = state.pendingRaw;
			state.pendingRaw = {};
			adapter.setRawExpansionKeys(raw).catch((error: unknown) => {
				console.error("Failed to push left-bar expansion changes", error);
			});
		}, FLUSH_DELAY_MS);
		return ok(null);
	},
});
