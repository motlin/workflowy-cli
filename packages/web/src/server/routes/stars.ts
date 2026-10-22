/**
 * Stars (starred pages and saved searches), stored in upstream's account-global root
 * metadata through the internal API, so they match workflowy.com.
 *
 * `GET /` -> `{stars, nodes}` (each starred node once, as `GET /nodes/:id` returns it, so the left bar's rows need no
 * request of their own); `PUT /:key` `{nodeId, query}` -> 201 star; `DELETE /:key` -> 204;
 * `PATCH /:key` `{name}` -> 204; `PUT /order` `{keys}` -> 204.
 */

import type {Context} from "hono";
import {Hono} from "hono";
import {z} from "zod";
import {locationKey} from "@workflowy/shared";
import type {Star} from "@workflowy/shared";
import {stripHtmlTags} from "@workflowy/shared/html";
import {orderChanges, renameChanges, starChanges, starsFromRootMeta, unstarChanges} from "@workflowy/shared/internal";
import type {StarNodes, WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import type {AppEnv, ServerContext} from "../context.js";
import {withAdapter} from "../internal-api.js";
import type {NodeResponse} from "../../node-types.js";
import {readNodeDto} from "./nodes.js";

type ReadNode = (ctx: ServerContext, id: string) => Promise<NodeResponse | undefined>;

const LocationSchema = z.object({nodeId: z.string().nullable(), query: z.string().nullable()});
const RenameSchema = z.object({name: z.string().nullable()});
const OrderSchema = z.object({keys: z.array(z.string())});

function starNodes(ctx: ServerContext): StarNodes {
	return {
		exists: (nodeId) => ctx.cacheService.getNode(nodeId) !== undefined,
		nameText: (nodeId) =>
			nodeId === null ? "Home" : stripHtmlTags(ctx.cacheService.getNode(nodeId)?.name ?? null),
	};
}

async function readStars(ctx: ServerContext, adapter: WorkflowyInternalAdapter) {
	return starsFromRootMeta(await adapter.getRootMeta([]), starNodes(ctx));
}

async function jsonBody(c: Context<AppEnv>): Promise<unknown> {
	return c.req.json().catch(() => {});
}

/** Each starred node once, in star order, skipping Home and nodes the cache no longer holds. */
async function starredNodes(ctx: ServerContext, stars: readonly Star[], readNode: ReadNode): Promise<NodeResponse[]> {
	const ids = [...new Set(stars.flatMap((star) => (star.nodeId === null ? [] : [star.nodeId])))];
	const nodes = await Promise.all(ids.map(async (id) => readNode(ctx, id)));
	return nodes.filter((node) => node !== undefined);
}

export function createStarsRouter(readNode: ReadNode = readNodeDto): Hono<AppEnv> {
	const router = new Hono<AppEnv>();

	router.get(
		"/",
		withAdapter(async (c, adapter) => {
			const ctx = c.get("ctx");
			const stars = await readStars(ctx, adapter);
			return c.json({stars, nodes: await starredNodes(ctx, stars, readNode)});
		}),
	);

	router.put(
		"/order",
		withAdapter(async (c, adapter) => {
			const body = OrderSchema.safeParse(await jsonBody(c));
			if (!body.success) {
				return c.json({error: "body must be {keys: string[]}"}, 400);
			}
			await adapter.setRootMetaValues(orderChanges(body.data.keys));
			return c.body(null, 204);
		}),
	);

	router.put(
		"/:key",
		withAdapter<"/:key">(async (c, adapter) => {
			const key = c.req.param("key");
			const body = LocationSchema.safeParse(await jsonBody(c));
			if (!body.success) {
				return c.json({error: "body must be {nodeId: string | null, query: string | null}"}, 400);
			}
			if (locationKey(body.data) !== key) {
				return c.json({error: "key must equal the location key of {nodeId, query}"}, 400);
			}
			const ctx = c.get("ctx");
			const {nodeId} = body.data;
			if (nodeId !== null && !starNodes(ctx).exists(nodeId)) {
				return c.json({error: `Node not found: ${nodeId}`}, 404);
			}
			await adapter.setRootMetaValues(starChanges(await adapter.getRootMeta([]), key));
			const star = (await readStars(ctx, adapter)).find((s) => s.key === key);
			return c.json(star, 201);
		}),
	);

	router.delete(
		"/:key",
		withAdapter<"/:key">(async (c, adapter) => {
			await adapter.setRootMetaValues(unstarChanges(await adapter.getRootMeta([]), c.req.param("key")));
			return c.body(null, 204);
		}),
	);

	router.patch(
		"/:key",
		withAdapter<"/:key">(async (c, adapter) => {
			const body = RenameSchema.safeParse(await jsonBody(c));
			if (!body.success) {
				return c.json({error: "body must be {name: string | null}"}, 400);
			}
			await adapter.setRootMetaValues(renameChanges(c.req.param("key"), body.data.name));
			return c.body(null, 204);
		}),
	);

	return router;
}
