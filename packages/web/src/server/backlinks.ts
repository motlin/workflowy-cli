import {backlinks, nodeContent, nodeMetadata, referencesRoots} from "@workflowy/shared/db";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {and, eq, inArray, sql} from "drizzle-orm";
import type {SQL} from "drizzle-orm";
import type {ServerContext} from "./context.js";

type ServerDatabase = ServerContext["db"];

const currentReferencesRootIds = sql`(SELECT ${referencesRoots.nodeId} FROM ${referencesRoots} WHERE ${referencesRoots.systemTo} = ${FAR_FUTURE_DATE})`;

/**
 * A `node_content` condition that drops every references root and the backlink
 * items directly under it. Upstream never shows either as a row, child, search
 * or jump hit; they surface only through the Backlinks section.
 */
export function notReferencesContent(): SQL {
	return sql`(${nodeContent.id} NOT IN ${currentReferencesRootIds} AND (${nodeContent.parentId} IS NULL OR ${nodeContent.parentId} NOT IN ${currentReferencesRootIds}))`;
}

/** A `node_content` condition that drops every references root (its backlink items stay). */
export function notReferencesRoot(): SQL {
	return sql`${nodeContent.id} NOT IN ${currentReferencesRootIds}`;
}

/** Which parents have any child, and which have at least one uncompleted child. */
export interface ChildFlags {
	withChildren: Set<string>;
	withUncompletedChildren: Set<string>;
}

/** The child flags over `{parentId, completedAt}` rows, one row per child. */
export function childFlagsFromRows(rows: {parentId: string | null; completedAt: Date | null}[]): ChildFlags {
	const flags: ChildFlags = {withChildren: new Set(), withUncompletedChildren: new Set()};
	for (const {parentId, completedAt} of rows) {
		if (parentId === null) {
			continue;
		}
		flags.withChildren.add(parentId);
		if (completedAt === null) {
			flags.withUncompletedChildren.add(parentId);
		}
	}
	return flags;
}

/**
 * The child flags of `parentIds`, counting only current children that are not
 * references roots. Upstream hides the triangle of a parent whose children are
 * all completed while completed items are hidden, so both flags are needed.
 */
export function childFlags(db: ServerDatabase, parentIds: string[]): ChildFlags {
	if (parentIds.length === 0) {
		return childFlagsFromRows([]);
	}
	const rows = db
		.select({parentId: nodeContent.parentId, completedAt: nodeMetadata.completedAt})
		.from(nodeContent)
		.leftJoin(
			nodeMetadata,
			and(eq(nodeMetadata.nodeId, nodeContent.id), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)),
		)
		.where(
			and(
				inArray(nodeContent.parentId, parentIds),
				eq(nodeContent.systemTo, FAR_FUTURE_DATE),
				sql`${nodeContent.id} NOT IN ${currentReferencesRootIds}`,
			),
		)
		.all();
	return childFlagsFromRows(rows);
}

/** The current references root under `targetId`, or null. */
export function findReferencesRoot(db: ServerDatabase, targetId: string): string | null {
	const row = db
		.select({id: nodeContent.id})
		.from(nodeContent)
		.where(
			and(
				eq(nodeContent.parentId, targetId),
				eq(nodeContent.systemTo, FAR_FUTURE_DATE),
				sql`${nodeContent.id} IN ${currentReferencesRootIds}`,
			),
		)
		.limit(1)
		.get();
	return row?.id ?? null;
}

/**
 * The backlink items under `rootId` whose source is a current node, mapped to
 * that source id. Whether the source text still links to the target is not
 * checked, matching upstream's count.
 */
export function currentBacklinkSources(db: ServerDatabase, rootId: string): Map<string, string> {
	const rows = db
		.select({nodeId: backlinks.nodeId, sourceId: backlinks.sourceId})
		.from(backlinks)
		.innerJoin(nodeContent, and(eq(nodeContent.id, backlinks.nodeId), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
		.where(
			and(
				eq(nodeContent.parentId, rootId),
				eq(backlinks.systemTo, FAR_FUTURE_DATE),
				sql`${backlinks.sourceId} IN (SELECT ${nodeContent.id} FROM ${nodeContent} WHERE ${nodeContent.systemTo} = ${FAR_FUTURE_DATE})`,
			),
		)
		.all();
	return new Map(rows.map((row) => [row.nodeId, row.sourceId]));
}
