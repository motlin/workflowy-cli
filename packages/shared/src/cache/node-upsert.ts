import {nodeContent, nodeMetadata} from "../db/schema.js";
import {FAR_FUTURE_DATE} from "../temporal/constants.js";
import type {WorkflowyNode} from "../types/workflowy.js";
import {uuidToShortId} from "../workflowy/constants.js";
import {and, eq} from "drizzle-orm";
import {contentMatches, currentVersion, metadataMatches, normalizeLayoutMode} from "./cache-temporal.js";
import type {TemporalTransaction} from "./temporal-merge.js";

/** Convert Unix seconds to a Date, passing null and undefined through as null. */
function timestampToDate(timestamp: number | null | undefined): Date | null {
	return timestamp === null || timestamp === undefined ? null : new Date(timestamp * 1000);
}

function insertContent(
	db: TemporalTransaction,
	node: WorkflowyNode,
	parentId: string | null,
	systemFrom: string,
): void {
	db.insert(nodeContent)
		.values({
			id: node.id,
			name: node.name,
			note: node.note || null,
			parentId,
			systemFrom,
			systemTo: FAR_FUTURE_DATE,
		})
		.run();
}

function insertMetadata(db: TemporalTransaction, node: WorkflowyNode, systemFrom: string): void {
	db.insert(nodeMetadata)
		.values({
			nodeId: node.id,
			shortId: uuidToShortId(node.id),
			priority: node.priority,
			createdAt: timestampToDate(node.createdAt),
			modifiedAt: timestampToDate(node.modifiedAt),
			completedAt: timestampToDate(node.completedAt),
			layoutMode: normalizeLayoutMode(node.data?.layoutMode),
			systemFrom,
			systemTo: FAR_FUTURE_DATE,
		})
		.run();
}

/**
 * Write one API node's content and metadata rows as current versions at `systemTime`.
 *
 * A node not yet cached gets fresh rows in both tables. For a cached node, each table
 * is versioned independently: its current row is closed and a new one opened only when
 * the API data differs, so an unchanged node leaves no history behind.
 */
export function upsertNodeVersion(
	db: TemporalTransaction,
	node: WorkflowyNode,
	parentId: string | null,
	systemTime: string,
): void {
	const existingContent = db
		.select()
		.from(nodeContent)
		.where(and(eq(nodeContent.id, node.id), currentVersion(nodeContent)))
		.get();

	if (!existingContent) {
		insertContent(db, node, parentId, systemTime);
		insertMetadata(db, node, systemTime);
		return;
	}

	if (!contentMatches(existingContent, {name: node.name, note: node.note || null, parentId})) {
		db.update(nodeContent)
			.set({systemTo: systemTime})
			.where(and(eq(nodeContent.id, node.id), currentVersion(nodeContent)))
			.run();
		insertContent(db, node, parentId, systemTime);
	}

	const existingMetadata = db
		.select()
		.from(nodeMetadata)
		.where(and(eq(nodeMetadata.nodeId, node.id), currentVersion(nodeMetadata)))
		.get();
	const metadata = {
		priority: node.priority,
		createdAt: node.createdAt,
		modifiedAt: node.modifiedAt,
		completedAt: node.completedAt ?? null,
		layoutMode: normalizeLayoutMode(node.data?.layoutMode),
	};
	if (existingMetadata && !metadataMatches(existingMetadata, metadata)) {
		db.update(nodeMetadata)
			.set({systemTo: systemTime})
			.where(and(eq(nodeMetadata.nodeId, node.id), currentVersion(nodeMetadata)))
			.run();
		insertMetadata(db, node, systemTime);
	}
}
