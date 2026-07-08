import {nodeContent, type NodeContentType, nodeMetadata, type NodeMetadataType} from '@workflowy/shared/db';
import * as schema from '@workflowy/shared/db';
import {
	applyRows,
	type NormalizedNodeContentRow,
	type NormalizedNodeMetadataRow,
	type NormalizedRowsByTable,
} from '@workflowy/shared/cache';
import {FAR_FUTURE_DATE, formatTemporalTimestamp} from '@workflowy/shared/temporal';
import {type WorkflowyNode, WorkflowyNodeSchema} from '@workflowy/shared/types';
import {uuidToShortId} from '@workflowy/shared/workflowy';
import {eq} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {ZodError} from 'zod';
import {contentMatches, metadataComparisonStats, metadataMatches, normalizeLayoutMode} from './cache-temporal.js';
import {logger} from './logger.js';

/**
 * Convert a Unix timestamp (seconds) to a Date object.
 * Returns null if the input is null or undefined.
 */
function timestampToDate(timestamp: number | null | undefined): Date | null {
	return timestamp === null || timestamp === undefined ? null : new Date(timestamp * 1000);
}

export interface ImportApiResult {
	totalNodes: number;
	nodesAdded: number;
	nodesUpdated: number;
	nodesUnchanged: number;
	nodesDeleted: number;
	nodesPhasedOut: number;
	contentUpdated: number;
	metadataUpdated: number;
	priorityUpdated: number;
	importTimestamp: Date;
}

interface ProcessedNode {
	id: string;
	shortId: string;
	name: string;
	note: string | null;
	parentId: string | null;
	priority: number;
	createdAt: number | null;
	modifiedAt: number | null;
	completedAt: number | null;
	layoutMode: string | null;
}

/**
 * Import nodes from Workflowy API export endpoint.
 *
 * Key differences from backup import:
 * - Input is API response (flat list), not nested JSON file
 * - Nodes already have parent_id field (no tree traversal needed)
 */
export async function importFromApi(
	database: BetterSQLite3Database<typeof schema>,
	apiNodes: WorkflowyNode[],
	verbose = false,
	timestamp?: Date,
): Promise<ImportApiResult> {
	const startTime = Date.now();
	let lastTime = startTime;

	if (verbose) {
		logger.debug(`[IMPORT-API] Starting import with verbose=${verbose}`);
	}

	const logTiming = (phase: string) => {
		if (!verbose) return;
		const now = Date.now();
		const elapsed = now - lastTime;
		const total = now - startTime;
		logger.debug(`  [${phase}]: ${elapsed}ms (total: ${total}ms)`);
		lastTime = now;
	};

	const importTimestamp = timestamp ?? new Date();
	const importTimestampStr = formatTemporalTimestamp(importTimestamp);

	// Process API nodes into our internal format
	const nodesToProcess: ProcessedNode[] = [];
	let validationErrors = 0;

	for (const [index, node] of apiNodes.entries()) {
		try {
			const validatedNode = WorkflowyNodeSchema.parse(node);

			nodesToProcess.push({
				id: validatedNode.id,
				shortId: uuidToShortId(validatedNode.id),
				name: validatedNode.name,
				note: validatedNode.note || null,
				parentId: validatedNode.parent_id ?? null,
				priority: validatedNode.priority ?? index,
				createdAt: validatedNode.createdAt ?? null,
				modifiedAt: validatedNode.modifiedAt ?? null,
				completedAt: validatedNode.completedAt ?? null,
				layoutMode: normalizeLayoutMode(validatedNode.data?.layoutMode),
			});
		} catch (error) {
			if (error instanceof ZodError) {
				validationErrors++;
				console.error(`Validation error for node ${node.id}:`);
				console.error(error.format());
				console.error('Node JSON:', JSON.stringify(node, null, 2));
			} else {
				throw error;
			}
		}
	}

	if (validationErrors > 0) {
		console.warn(`Encountered ${validationErrors} validation errors during import`);
	}

	logTiming(`Prepared ${nodesToProcess.length} nodes for processing`);

	// The per-node REST API is always fresh: a single-node response is
	// authoritative by definition, so this adapter writes unconditionally. The
	// stale-snapshot watermark guard lives in the bulk-export adapter
	// (cache-import.ts), which is the only path that can return stale snapshots.

	// Reset diagnostic counters before comparison phase
	metadataComparisonStats.reset();

	let nodesAdded = 0;
	let nodesUpdated = 0;
	let nodesUnchanged = 0;
	let nodesDeleted = 0;
	let nodesPhasedOut = 0;
	let contentUpdated = 0;
	let metadataUpdated = 0;
	const priorityUpdated = 0; // API import doesn't recalculate priorities

	// Classify nodes for node-level stats before handing the merge to the shared
	// importer. Classification needs the current rows in memory; the actual
	// phase-out/insert is owned by applyRows().
	const existingContentMap = new Map<string, NodeContentType>();
	for (const content of database.select().from(nodeContent).where(eq(nodeContent.systemTo, FAR_FUTURE_DATE)).all()) {
		existingContentMap.set(content.id, content);
	}
	logTiming(`Loaded ${existingContentMap.size} existing content records into Map`);

	const existingMetadataMap = new Map<string, NodeMetadataType>();
	for (const metadata of database
		.select()
		.from(nodeMetadata)
		.where(eq(nodeMetadata.systemTo, FAR_FUTURE_DATE))
		.all()) {
		existingMetadataMap.set(metadata.nodeId, metadata);
	}
	logTiming(`Loaded ${existingMetadataMap.size} existing metadata records into Map`);

	// (a) Unchanged - no DB operations
	// (b) Changed - phase out old, insert new
	// (c) New - insert only
	// (d) Deleted - phase out only (handled by the merge engine's absence detection)
	for (const nodeData of nodesToProcess) {
		const existingContent = existingContentMap.get(nodeData.id);
		const existingMetadata = existingMetadataMap.get(nodeData.id);
		const isNew = !existingContent;
		const contentChanged = existingContent && !contentMatches(existingContent, nodeData);
		const metadataChanged = existingMetadata && !metadataMatches(existingMetadata, nodeData);

		if (isNew) {
			nodesAdded++;
		} else if (contentChanged || metadataChanged) {
			nodesUpdated++;
			if (contentChanged) contentUpdated++;
			if (metadataChanged) metadataUpdated++;
		} else {
			nodesUnchanged++;
		}
	}
	// Existing nodes absent from the API response are deletions.
	const incomingIds = new Set(nodesToProcess.map((n) => n.id));
	for (const existingId of existingContentMap.keys()) {
		if (!incomingIds.has(existingId)) {
			nodesDeleted++;
		}
	}
	nodesPhasedOut = nodesDeleted;

	logTiming(`Classified: ${nodesAdded} new, ${nodesUpdated} changed, ${nodesUnchanged} unchanged`);

	// Log diagnostic stats to identify which metadata field is causing mismatches
	metadataComparisonStats.log();

	// Normalize the per-node REST payload into the shared in-DB row shape, then
	// hand it to the shared importer, which owns the transaction and the
	// temporal merge. This adapter only manages node_content and node_metadata.
	const contentRows: NormalizedNodeContentRow[] = nodesToProcess.map((node) => ({
		id: node.id,
		name: node.name,
		note: node.note,
		parentId: node.parentId,
	}));
	const metadataRows: NormalizedNodeMetadataRow[] = nodesToProcess.map((node) => ({
		nodeId: node.id,
		shortId: node.shortId,
		priority: node.priority,
		createdAt: timestampToDate(node.createdAt),
		modifiedAt: timestampToDate(node.modifiedAt),
		completedAt: timestampToDate(node.completedAt),
		layoutMode: node.layoutMode,
	}));
	const rowsByTable: NormalizedRowsByTable = {nodeContent: contentRows, nodeMetadata: metadataRows};
	const mergeResult = applyRows(database, rowsByTable, importTimestampStr);

	logTiming(
		`Merged ${mergeResult.nodeContent?.inserted ?? 0} content rows, ` +
			`${mergeResult.nodeMetadata?.inserted ?? 0} metadata rows`,
	);

	logTiming('Transaction complete');

	return {
		totalNodes: nodesToProcess.length,
		nodesAdded,
		nodesUpdated,
		nodesUnchanged,
		nodesDeleted,
		nodesPhasedOut,
		contentUpdated,
		metadataUpdated,
		priorityUpdated,
		importTimestamp,
	};
}
