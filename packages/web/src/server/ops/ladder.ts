/**
 * The asap ladder ops: read both ladders, drop a row into another tier, complete a
 * row. Every write publishes on the context's event bus, which the host fans out to its sockets.
 *
 * Everything worth testing lives in {@link LadderService}, and the ops are built by
 * {@link createLadderOps} so a test can drive them against a fake service with no database and no API key.
 */

import {WorkflowyApiClient} from "@workflowy/shared/api";
import {NodeTreeReader, WorkflowyWriteThroughClient} from "@workflowy/shared/cache";
import type {NodeTree} from "@workflowy/shared/cache";
import {z} from "zod";
import type {ServerContext} from "../context.js";
import {LadderService} from "../ladder-service.js";
import type {LadderBuckets} from "../ladder-service.js";
import type {RawNode} from "../ladder-model.js";
import {defineOp, fail, jsonOf, ok} from "./define.js";

/** Where each ladder lives. Both buckets sit four levels down, under their root. */
const BUCKET_PATHS: Record<string, string[]> = {
	work: ["Work", "☑️ Next (Work)", "✅ Tasks", "📌 Tasks (asap) (work)"],
	personal: ["Personal", "☑️ Next (Personal)", "✅ Tasks", "📌 Tasks (asap) (personal)"],
};

/** The part of {@link LadderService} the ops call. */
export type LadderOperations = Pick<LadderService, "read" | "move" | "complete">;

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The HTTP layer passes the body's fields through untouched; the checks and their exact 400 bodies live here. */
const MoveInput = z.object({
	root: z.unknown().optional(),
	node_id: z.unknown().optional(),
	to_tier: z.unknown().optional(),
	before_id: z.unknown().optional(),
});
const CompleteInput = z.object({root: z.unknown().optional(), node_id: z.unknown().optional()});

/** Build the three ladder ops over a service factory; a test injects a fake service. */
export function createLadderOps(createService: (ctx: ServerContext) => LadderOperations) {
	return {
		"ladder.read": defineOp({
			input: z.object({}),
			async run(ctx) {
				return ok(jsonOf({ladders: await createService(ctx).read()}));
			},
		}),
		"ladder.move": defineOp({
			input: MoveInput,
			async run(ctx, body) {
				const root = text(body.root);
				const nodeId = text(body.node_id);
				const toTier = text(body.to_tier);
				if (!root || !nodeId || !toTier) {
					return fail(400, {error: "root, node_id and to_tier are required"});
				}
				if (body.before_id !== undefined && typeof body.before_id !== "string") {
					return fail(400, {error: "before_id must be a string"});
				}
				const beforeNodeId = text(body.before_id);
				try {
					const event = await createService(ctx).move({
						root,
						nodeId,
						toTier,
						...(beforeNodeId === undefined ? {} : {beforeNodeId}),
					});
					return ok(jsonOf({event}));
				} catch (error) {
					return fail(400, {error: messageOf(error), reconcile: true});
				}
			},
		}),
		"ladder.complete": defineOp({
			input: CompleteInput,
			async run(ctx, body) {
				const root = text(body.root);
				const nodeId = text(body.node_id);
				if (!root || !nodeId) {
					return fail(400, {error: "root and node_id are required"});
				}
				try {
					return ok(jsonOf({event: await createService(ctx).complete({root, nodeId})}));
				} catch (error) {
					return fail(400, {error: messageOf(error)});
				}
			},
		}),
	};
}

function toRawNode(tree: NodeTree): RawNode {
	return {
		id: tree.id,
		name: tree.name,
		completedAt: tree.completedAt?.toISOString() ?? null,
		children: tree.children?.map(toRawNode),
	};
}

/**
 * Build the real service: read the buckets out of the cache, write through the
 * Workflowy API, and announce every write on the process-wide bus.
 */
function defaultService(ctx: ServerContext): LadderService {
	const adapter = ctx.apiKey ? ctx.internalAdapter?.() : undefined;
	return new LadderService({
		readBuckets: async () => {
			const reader = new NodeTreeReader(ctx.cacheService);
			const buckets: LadderBuckets = {};
			for (const [root, path] of Object.entries(BUCKET_PATHS)) {
				const bucket = ctx.cacheService.findNodeByPath(path);
				if (!bucket) {
					throw new Error(`no ${root} asap bucket at ${path.join(" > ")}`);
				}
				const [tree] = await reader.readNodes([bucket.id], {depth: 3});
				if (tree === undefined) {
					throw new Error(`could not read the ${root} asap bucket`);
				}
				buckets[root] = toRawNode(tree);
			}
			return buckets;
		},
		moveNode: async (nodeId, parentId, position) => writeClient(ctx).moveNode(nodeId, parentId, position),
		// With the internal API a landing is one exact-index move; without it, the service rotates the suffix.
		...(adapter && {moveTo: async (nodeId, parentId, index) => adapter.moveTo({ids: [nodeId], parentId, index})}),
		// Reordering can renumber siblings, so refresh their cached priorities too.
		refreshTier: async (parentId) => {
			const children = await apiClient(ctx).getChildNodes(parentId);
			for (const child of children) {
				ctx.cacheService.insertNode(child, parentId);
			}
		},
		completeNode: async (nodeId) => writeClient(ctx).completeNode(nodeId),
		events: ctx.ladderEvents,
	});
}

function apiClient(ctx: ServerContext): WorkflowyApiClient {
	if (!ctx.apiKey) {
		throw new Error("WORKFLOWY_API_KEY environment variable is required");
	}
	return new WorkflowyApiClient(ctx.apiKey, undefined, ctx.config.apiUrl);
}

function writeClient(ctx: ServerContext): WorkflowyWriteThroughClient {
	return new WorkflowyWriteThroughClient(apiClient(ctx), ctx.cacheService);
}

export const ladderOps = createLadderOps(defaultService);
