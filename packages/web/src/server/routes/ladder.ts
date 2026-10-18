/**
 * The asap ladder: read both ladders, drop a row into another tier, complete a
 * row, and stream every write to whoever is watching.
 *
 * The handlers are deliberately thin. Everything worth testing lives in
 * {@link LadderService}, and the router is injectable so a test can drive
 * `app.fetch(...)` against a fake service with no database and no API key.
 */

import {WorkflowyApiClient} from "@workflowy/shared/api";
import {NodeTreeReader, WorkflowyWriteThroughClient} from "@workflowy/shared/cache";
import type {NodeTree} from "@workflowy/shared/cache";
import {Hono} from "hono";
import {z} from "zod";
import type {AppEnv, ServerContext} from "../context.js";
import {ladderEvents} from "../ladder-events.js";
import {LadderService} from "../ladder-service.js";
import type {LadderBuckets} from "../ladder-service.js";
import type {RawNode} from "../ladder-model.js";

/** Where each ladder lives. Both buckets sit four levels down, under their root. */
const BUCKET_PATHS: Record<string, string[]> = {
	work: ["Work", "☑️ Next (Work)", "✅ Tasks", "📌 Tasks (asap) (work)"],
	personal: ["Personal", "☑️ Next (Personal)", "✅ Tasks", "📌 Tasks (asap) (personal)"],
};

/** The part of {@link LadderService} the router calls. */
export type LadderOperations = Pick<LadderService, "read" | "move" | "complete">;

export interface LadderRouterOptions {
	createService?: (ctx: ServerContext) => LadderOperations;
}

export function createLadderRouter(options: LadderRouterOptions = {}): Hono<AppEnv> {
	const createService = options.createService ?? defaultService;
	const router = new Hono<AppEnv>();

	router.get("/", async (c) => {
		const ladders = await createService(c.get("ctx")).read();
		return c.json({ladders});
	});

	router.post("/move", async (c) => {
		const body = await readBody(c.req.raw);
		const root = text(body.root);
		const nodeId = text(body.node_id);
		const toTier = text(body.to_tier);
		if (!root || !nodeId || !toTier) {
			return c.json({error: "root, node_id and to_tier are required"}, 400);
		}
		if (body.before_id !== undefined && typeof body.before_id !== "string") {
			return c.json({error: "before_id must be a string"}, 400);
		}
		const beforeNodeId = text(body.before_id);
		try {
			const event = await createService(c.get("ctx")).move({
				root,
				nodeId,
				toTier,
				...(beforeNodeId === undefined ? {} : {beforeNodeId}),
			});
			return c.json({event});
		} catch (error) {
			return c.json({error: messageOf(error), reconcile: true}, 400);
		}
	});

	router.post("/complete", async (c) => {
		const body = await readBody(c.req.raw);
		const root = text(body.root);
		const nodeId = text(body.node_id);
		if (!root || !nodeId) {
			return c.json({error: "root and node_id are required"}, 400);
		}
		try {
			const event = await createService(c.get("ctx")).complete({root, nodeId});
			return c.json({event});
		} catch (error) {
			return c.json({error: messageOf(error)}, 400);
		}
	});

	return router;
}

const JsonObjectSchema = z.record(z.string(), z.unknown());

async function readBody(request: Request): Promise<Record<string, unknown>> {
	try {
		const result = JsonObjectSchema.safeParse(await request.json());
		return result.success ? result.data : {};
	} catch {
		return {};
	}
}

function text(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function toRawNode(tree: NodeTree): RawNode {
	return {
		id: tree.id,
		name: tree.name,
		completedAt: tree.completedAt?.toISOString() ?? null,
		children: tree.children?.map(toRawNode),
	};
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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
		events: ladderEvents,
	});
}

function apiClient(ctx: ServerContext): WorkflowyApiClient {
	if (!ctx.apiKey) {
		throw new Error("WORKFLOWY_API_KEY environment variable is required");
	}
	return new WorkflowyApiClient(ctx.apiKey, undefined, process.env.WORKFLOWY_API_URL);
}

function writeClient(ctx: ServerContext): WorkflowyWriteThroughClient {
	return new WorkflowyWriteThroughClient(apiClient(ctx), ctx.cacheService);
}
