/**
 * The asap ladder: read both ladders, drop a row into another tier, complete a
 * row, and stream every write to whoever is watching.
 *
 * The handlers are deliberately thin. Everything worth testing lives in
 * {@link LadderService}, and the router is injectable so a test can drive
 * `app.fetch(...)` against a fake service with no database and no API key.
 */

import {WorkflowyApiClient} from '@workflowy/shared/api';
import {NodeTreeReader, WorkflowyWriteThroughClient} from '@workflowy/shared/cache';
import {Hono} from 'hono';
import {type AppEnv, type ServerContext} from '../context.js';
import {ladderEvents} from '../ladder-events.js';
import {LadderService} from '../ladder-service.js';

/** Where each ladder lives. Both buckets sit four levels down, under their root. */
const BUCKET_PATHS: Record<string, string[]> = {
	work: ['Work', '☑️ Next (Work)', '✅ Tasks', '📌 Tasks (asap) (work)'],
	personal: ['Personal', '☑️ Next (Personal)', '✅ Tasks', '📌 Tasks (asap) (personal)'],
};

export interface LadderRouterOptions {
	createService?: (ctx: ServerContext) => LadderService;
}

export function createLadderRouter(options: LadderRouterOptions = {}): Hono<AppEnv> {
	const createService = options.createService ?? defaultService;
	const router = new Hono<AppEnv>();

	router.get('/', async (c) => {
		const ladders = await createService(c.get('ctx')).read();
		return c.json({ladders});
	});

	router.post('/move', async (c) => {
		const {root, node_id: nodeId, to_tier: toTier, before_id: beforeNodeId} = await readBody(c.req.raw);
		if (!root || !nodeId || !toTier) {
			return c.json({error: 'root, node_id and to_tier are required'}, 400);
		}
		if (beforeNodeId !== undefined && typeof beforeNodeId !== 'string')
			return c.json({error: 'before_id must be a string'}, 400);
		try {
			const event = await createService(c.get('ctx')).move({
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

	router.post('/complete', async (c) => {
		const {root, node_id: nodeId} = await readBody(c.req.raw);
		if (!root || !nodeId) {
			return c.json({error: 'root and node_id are required'}, 400);
		}
		try {
			const event = await createService(c.get('ctx')).complete({root, nodeId});
			return c.json({event});
		} catch (error) {
			return c.json({error: messageOf(error)}, 400);
		}
	});

	return router;
}

async function readBody(request: Request): Promise<Record<string, string | undefined>> {
	try {
		const body: unknown = await request.json();
		return typeof body === 'object' && body !== null ? (body as Record<string, string | undefined>) : {};
	} catch {
		return {};
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Build the real service: read the buckets out of the cache, write through the
 * Workflowy API, and announce every write on the process-wide bus.
 */
function defaultService(ctx: ServerContext): LadderService {
	return new LadderService({
		readBuckets: async () => {
			const reader = new NodeTreeReader(ctx.cacheService);
			const buckets: Record<string, {id: string; name?: string | null; children?: never[]}> = {};
			for (const [root, path] of Object.entries(BUCKET_PATHS)) {
				const bucket = await ctx.cacheService.findNodeByPath(path);
				if (!bucket) {
					throw new Error(`no ${root} asap bucket at ${path.join(' > ')}`);
				}
				const [tree] = await reader.readNodes([bucket.id], {depth: 3});
				if (!tree) {
					throw new Error(`could not read the ${root} asap bucket`);
				}
				buckets[root] = tree as never;
			}
			return buckets as never;
		},
		moveNode: async (nodeId, parentId, position) => {
			await writeClient(ctx).moveNode(nodeId, parentId, position);
			// Reordering can renumber siblings, so refresh their cached priorities too.
			const children = await apiClient(ctx).getChildNodes(parentId);
			for (const child of children) await ctx.cacheService.insertNode(child, parentId);
		},
		completeNode: async (nodeId) => writeClient(ctx).completeNode(nodeId),
		events: ladderEvents,
	});
}

function apiClient(ctx: ServerContext): WorkflowyApiClient {
	if (!ctx.apiKey) {
		throw new Error('WORKFLOWY_API_KEY environment variable is required');
	}
	return new WorkflowyApiClient(ctx.apiKey, undefined, process.env.WORKFLOWY_API_URL);
}

function writeClient(ctx: ServerContext): WorkflowyWriteThroughClient {
	return new WorkflowyWriteThroughClient(apiClient(ctx), ctx.cacheService);
}
