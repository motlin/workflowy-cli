/**
 * `GET /api/v1/tags/autocomplete?root=<id|empty>&prefix=<#..>&limit=8&fallback=<0|1>&item=<id>&name=..&note=..`
 * -> `{tags: {tag, count}[]}`.
 *
 * `item` with a live `name` and/or `note` counts that item's unsaved editor text in place of its
 * saved text, as upstream's tag counts follow every keystroke (so an in-progress tag counts and a
 * saved partial it replaced does not).
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

interface LiveText {
	id: string;
	name: string | undefined;
	note: string | undefined;
}

type IdRow = TagRow & {id: string};

function withLive(rows: IdRow[], live: LiveText | null): TagRow[] {
	if (live === null) {
		return rows;
	}
	return rows.map((row) =>
		row.id === live.id ? {id: row.id, name: live.name ?? row.name, note: live.note ?? row.note} : row,
	);
}

function subtreeRows(ctx: ServerContext, rootId: string): IdRow[] {
	return ctx.db.all<IdRow>(sql`
		WITH RECURSIVE subtree(id, name, note) AS (
			SELECT id, name, note FROM node_content
			WHERE id = ${rootId}
			AND system_to = ${FAR_FUTURE_DATE}
			UNION ALL
			SELECT n.id, n.name, n.note FROM node_content n
			INNER JOIN subtree s ON n.parent_id = s.id
			WHERE n.system_to = ${FAR_FUTURE_DATE}
		)
		SELECT id, name, note FROM subtree
	`);
}

function allRows(ctx: ServerContext): IdRow[] {
	return ctx.db
		.select({id: nodeContent.id, name: nodeContent.name, note: nodeContent.note})
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
		const rawItem = c.req.query("item") ?? "";
		const live: LiveText | null =
			rawItem === ""
				? null
				: {
						id: ctx.cacheService.resolveShortIdToUuid(rawItem) ?? rawItem,
						name: c.req.query("name"),
						note: c.req.query("note"),
					};

		if (rawRoot === "") {
			return c.json({tags: rankTags(withLive(allRows(ctx), live), {prefix, limit})});
		}

		const rootId = ctx.cacheService.resolveShortIdToUuid(rawRoot) ?? rawRoot;
		const tags = rankTags(withLive(subtreeRows(ctx, rootId), live), {prefix, limit});
		if (tags.length >= limit || c.req.query("fallback") === "0") {
			return c.json({tags});
		}
		const global = rankTags(withLive(allRows(ctx), live), {prefix, limit: limit * 2});
		return c.json({tags: mergeFallback(tags, global, limit)});
	});

	return router;
}
