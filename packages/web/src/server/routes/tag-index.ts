/**
 * `GET /api/v1/tags/autocomplete?root=<id|empty>&prefix=<#..>&limit=8&fallback=<0|1>`
 * -> `{tags: {tag, count}[]}`.
 *
 * Ranks the tags in the zoomed item's live subtree, including the zoom root's
 * own name and note (the whole tree at Home). When a root is given and it yields
 * fewer than `limit` tags, the list is filled from the whole tree unless
 * `fallback=0`.
 */

import {Hono} from "hono";
import {nodeContent} from "@workflowy/shared/db";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {eq, sql} from "drizzle-orm";
import type {AppEnv, ServerContext} from "../context.js";
import {mergeFallback, rankTags} from "../tag-index.js";
import type {TagRow} from "../tag-index.js";

const DEFAULT_LIMIT = 8;

function subtreeRows(ctx: ServerContext, rootId: string): TagRow[] {
	return ctx.db.all<TagRow>(sql`
		WITH RECURSIVE subtree(id, name, note) AS (
			SELECT id, name, note FROM node_content
			WHERE id = ${rootId}
			AND system_to = ${FAR_FUTURE_DATE}
			UNION ALL
			SELECT n.id, n.name, n.note FROM node_content n
			INNER JOIN subtree s ON n.parent_id = s.id
			WHERE n.system_to = ${FAR_FUTURE_DATE}
		)
		SELECT name, note FROM subtree
	`);
}

function allRows(ctx: ServerContext): TagRow[] {
	return ctx.db
		.select({name: nodeContent.name, note: nodeContent.note})
		.from(nodeContent)
		.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
		.all();
}

function parseLimit(raw: string | undefined): number {
	const limit = Math.trunc(Number(raw ?? ""));
	return Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
}

export function createTagIndexRouter(): Hono<AppEnv> {
	const router = new Hono<AppEnv>();

	router.get("/", (c) => {
		const ctx = c.get("ctx");
		const rawRoot = c.req.query("root") ?? "";
		const prefix = c.req.query("prefix") ?? "#";
		const limit = parseLimit(c.req.query("limit"));

		if (rawRoot === "") {
			return c.json({tags: rankTags(allRows(ctx), {prefix, limit})});
		}

		const rootId = ctx.cacheService.resolveShortIdToUuid(rawRoot) ?? rawRoot;
		const tags = rankTags(subtreeRows(ctx, rootId), {prefix, limit});
		if (tags.length >= limit || c.req.query("fallback") === "0") {
			return c.json({tags});
		}
		const global = rankTags(allRows(ctx), {prefix, limit: limit * 2});
		return c.json({tags: mergeFallback(tags, global, limit)});
	});

	return router;
}
