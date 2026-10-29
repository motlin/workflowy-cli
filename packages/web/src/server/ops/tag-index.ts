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

import {nodeContent, nodeMetadata} from "@workflowy/shared/db";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {and, eq, sql} from "drizzle-orm";
import {z} from "zod";
import type {ServerContext} from "../context.js";
import {mergeFallback, rankCounts, rankTags, swapItemText, wholeTreeTagCounts} from "../tag-index.js";
import type {TagCount, TagRow} from "../tag-index.js";
import {defineOp, ok} from "./define.js";

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
		row.id === live.id ? {...row, name: live.name ?? row.name, note: live.note ?? row.note} : row,
	);
}

function subtreeRows(ctx: ServerContext, rootId: string): IdRow[] {
	return ctx.db.all<IdRow>(sql`
		WITH RECURSIVE subtree(id, name, note, layoutMode) AS (
			SELECT c.id, c.name, c.note, m.layout_mode FROM node_content c
			LEFT JOIN node_metadata m ON m.node_id = c.id AND m.system_to = ${FAR_FUTURE_DATE}
			WHERE c.id = ${rootId}
			AND c.system_to = ${FAR_FUTURE_DATE}
			UNION ALL
			SELECT n.id, n.name, n.note, m.layout_mode FROM node_content n
			LEFT JOIN node_metadata m ON m.node_id = n.id AND m.system_to = ${FAR_FUTURE_DATE}
			INNER JOIN subtree s ON n.parent_id = s.id
			WHERE n.system_to = ${FAR_FUTURE_DATE}
		)
		SELECT id, name, note, layoutMode FROM subtree
	`);
}

/** The whole live tree's tag counts, with the edited item's saved text swapped for its live text. */
function wholeTreeCounts(ctx: ServerContext, live: LiveText | null): ReturnType<typeof wholeTreeTagCounts> {
	const counts = wholeTreeTagCounts(ctx.db);
	if (live === null) {
		return counts;
	}
	const saved = ctx.db
		.select({name: nodeContent.name, note: nodeContent.note, layoutMode: nodeMetadata.layoutMode})
		.from(nodeContent)
		.leftJoin(
			nodeMetadata,
			and(eq(nodeMetadata.nodeId, nodeContent.id), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)),
		)
		.where(and(eq(nodeContent.id, live.id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
		.get();
	if (saved === undefined) {
		return counts;
	}
	return swapItemText(counts, saved, {
		name: live.name ?? saved.name,
		note: live.note ?? saved.note,
		layoutMode: saved.layoutMode,
	});
}

function parseLimit(raw: string | undefined): number {
	const limit = Math.trunc(Number(raw ?? ""));
	return Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
}

/** Raw query values, as the route passes them; the op owns every default and fallback. */
const Input = z.object({
	root: z.string().default(""),
	prefix: z.string().default("#"),
	limit: z.string().optional(),
	item: z.string().default(""),
	name: z.string().optional(),
	note: z.string().optional(),
	fallback: z.string().optional(),
});

/** Copies each tag into a plain object literal, which is assignable to `Json` where the `TagCount` interface is not. */
function plain(tags: TagCount[]): {tag: string; count: number}[] {
	return tags.map(({tag, count}) => ({tag, count}));
}

export const tagIndexAutocomplete = defineOp({
	input: Input,
	output: z.strictObject({tags: z.array(z.strictObject({tag: z.string(), count: z.number()}))}),
	run(ctx, {root: rawRoot, prefix, limit: rawLimit, item: rawItem, name, note, fallback}) {
		const limit = parseLimit(rawLimit);
		const live: LiveText | null =
			rawItem === "" ? null : {id: ctx.cacheService.resolveShortIdToUuid(rawItem) ?? rawItem, name, note};

		if (rawRoot === "") {
			return ok({tags: plain(rankCounts(wholeTreeCounts(ctx, live), {prefix, limit}))});
		}

		const rootId = ctx.cacheService.resolveShortIdToUuid(rawRoot) ?? rawRoot;
		const tags = rankTags(withLive(subtreeRows(ctx, rootId), live), {prefix, limit});
		if (tags.length >= limit || fallback === "0") {
			return ok({tags: plain(tags)});
		}
		const global = rankCounts(wholeTreeCounts(ctx, live), {prefix, limit: limit * 2});
		return ok({tags: plain(mergeFallback(tags, global, limit))});
	},
});
