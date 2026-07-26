import {fetchWorkflowyEpoch} from '@workflowy/shared/api';
import {
	backlinks,
	config,
	mirrors,
	nodeContent,
	type NodeContentType,
	nodeEmbeddings,
	nodeMetadata,
	type NodeMetadataType,
	virtualRootIds,
} from '@workflowy/shared/db';
import * as schema from '@workflowy/shared/db';
import {
	applyRows,
	joinKey,
	type NormalizedAiMetadataRow,
	type NormalizedCalendarLevelsRow,
	type NormalizedCalendarMetadataRow,
	type NormalizedChangesMetadataRow,
	type NormalizedNodeContentRow,
	type NormalizedNodeMetadataRow,
	type NormalizedReferencesRootsRow,
	type NormalizedS3FileRow,
	temporalMerge,
} from '@workflowy/shared/cache';
import {BackupFileSchema, type BackupNode, BackupNodeSchema} from '@workflowy/shared/schemas';
import {FAR_FUTURE_DATE, formatTemporalTimestamp} from '@workflowy/shared/temporal';
import {backupToUnixTime, uuidToShortId} from '@workflowy/shared/workflowy';
import {and, eq, inArray, lt} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {ZodError} from 'zod';
import {readBackupFile} from '../utils/backup-archive.js';
import {contentMatches, metadataComparisonStats, metadataMatches, normalizeLayoutMode} from './cache-temporal.js';
import {logger} from './logger.js';

// Config key for storing the user's Workflowy epoch
const WORKFLOWY_EPOCH_CONFIG_KEY = 'workflowy_epoch';

/**
 * Get the Workflowy epoch from environment variable or config table.
 * Throws if no epoch is configured and credentials are not available.
 *
 * Priority: WORKFLOWY_EPOCH env var > config table
 */
function getWorkflowyEpoch(
	// oxlint-disable-next-line @typescript-eslint/no-explicit-any
	tx: any,
): number | null {
	// Check environment variable first
	const envEpoch = process.env.WORKFLOWY_EPOCH;
	if (envEpoch) {
		const parsed = Number.parseInt(envEpoch, 10);
		if (!Number.isNaN(parsed)) {
			return parsed;
		}
	}

	// Check config table
	try {
		const configRow = tx.select().from(config).where(eq(config.key, WORKFLOWY_EPOCH_CONFIG_KEY)).get();
		if (configRow) {
			const parsed = Number.parseInt(configRow.value, 10);
			if (!Number.isNaN(parsed)) {
				return parsed;
			}
		}
	} catch {
		// Config table might not exist yet
	}

	return null;
}

/**
 * Store the Workflowy epoch in the config table.
 */
function setWorkflowyEpoch(
	// oxlint-disable-next-line @typescript-eslint/no-explicit-any
	tx: any,
	epoch: number,
): void {
	const now = formatTemporalTimestamp(new Date());
	tx.insert(config)
		.values({
			key: WORKFLOWY_EPOCH_CONFIG_KEY,
			value: String(epoch),
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: config.key,
			set: {
				value: String(epoch),
				updatedAt: now,
			},
		})
		.run();
}

/**
 * Get or fetch the Workflowy epoch.
 * If not configured, attempts to fetch from Workflowy internal API using credentials.
 *
 * @param tx - Database transaction
 * @returns The epoch value
 * @throws Error if epoch is not configured and cannot be fetched
 */
async function getOrFetchWorkflowyEpoch(
	// oxlint-disable-next-line @typescript-eslint/no-explicit-any
	tx: any,
): Promise<number> {
	// Check existing configuration first
	const existingEpoch = getWorkflowyEpoch(tx);
	if (existingEpoch !== null) {
		return existingEpoch;
	}

	// Try to fetch from Workflowy internal API
	const username = process.env.WORKFLOWY_USERNAME;
	const password = process.env.WORKFLOWY_PASSWORD;

	if (username && password) {
		logger.debug('Fetching Workflowy epoch from internal API...');
		const epoch = await fetchWorkflowyEpoch({username, password});
		setWorkflowyEpoch(tx, epoch);
		logger.debug(`Workflowy epoch fetched and stored: ${epoch}`);
		return epoch;
	}

	throw new Error(
		'Workflowy epoch not configured. Set WORKFLOWY_EPOCH env var, ' +
			'or provide WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD to fetch automatically.',
	);
}

// Batch size for bulk operations - balance between memory and performance
const BULK_BATCH_SIZE = 1000;

/**
 * Convert a Unix timestamp (seconds) to a Date object.
 * Returns null if the input is null or undefined.
 */
function timestampToDate(timestamp: number | null | undefined): Date | null {
	return timestamp === null || timestamp === undefined ? null : new Date(timestamp * 1000);
}

/**
 * Find the index of the previous element with a non-null priority.
 */
function findPrevWithPriority(arr: Array<number | null>, start: number): number | null {
	for (let i = start - 1; i >= 0; i--) {
		if (arr[i] !== null) return i;
	}
	return null;
}

/**
 * Find the index of the next element with a non-null priority.
 */
function findNextWithPriority(arr: Array<number | null>, start: number): number | null {
	for (let i = start + 1; i < arr.length; i++) {
		if (arr[i] !== null) return i;
	}
	return null;
}

/**
 * Calculate priorities for siblings, handling both new nodes and order changes.
 *
 * For NEW nodes (existingPriority is null): infer priority from neighbors.
 * For EXISTING nodes: check if ORDER changed. If order matches, keep existing priorities.
 * If order changed, recalculate using anchors (nodes whose relative position is stable).
 *
 * @param siblings - Array of {id, backupPosition, existingPriority} sorted by backupPosition
 * @returns Map of nodeId → priority (only for nodes that need updating)
 */
function calculatePriorities(
	siblings: Array<{id: string; backupPosition: number; existingPriority: number | null}>,
): Map<string, number> {
	const result = new Map<string, number>();

	// Separate new nodes from existing nodes
	const existingNodes = siblings.filter((s) => s.existingPriority !== null);
	const newNodes = siblings.filter((s) => s.existingPriority === null);

	// If all nodes are new, assign priorities based on backup position
	if (existingNodes.length === 0) {
		for (const [i, sibling] of siblings.entries()) {
			result.set(sibling.id, i * 100);
		}
		return result;
	}

	// Check if order changed for existing nodes
	// Existing order: sort by priority, extract IDs
	const existingOrder = [...existingNodes].sort((a, b) => a.existingPriority! - b.existingPriority!).map((s) => s.id);
	// Backup order: already sorted by backupPosition, just extract IDs of existing nodes
	const backupOrderOfExisting = siblings.filter((s) => s.existingPriority !== null).map((s) => s.id);

	const orderChanged = existingOrder.some((id, i) => id !== backupOrderOfExisting[i]);

	if (!orderChanged && newNodes.length === 0) {
		// Order unchanged, no new nodes - nothing to do
		return result;
	}

	// Build working array of priorities (null means needs calculation)
	const priorities: Array<number | null> = siblings.map((s) => (orderChanged ? null : s.existingPriority));

	// If order changed, find an anchor: rightmost existing node to use as reference
	// We'll propagate backwards from it
	if (orderChanged && existingNodes.length > 0) {
		// Find the existing node that's furthest right in backup order
		let anchorIdx = -1;
		let anchorPriority = 0;
		for (let i = siblings.length - 1; i >= 0; i--) {
			if (siblings[i].existingPriority !== null) {
				anchorIdx = i;
				anchorPriority = siblings[i].existingPriority!;
				break;
			}
		}

		if (anchorIdx >= 0) {
			// Set anchor
			priorities[anchorIdx] = anchorPriority;

			// Propagate backwards (subtract 100 per position)
			for (let i = anchorIdx - 1; i >= 0; i--) {
				priorities[i] = priorities[i + 1]! - 100;
			}

			// Propagate forwards (add 100 per position)
			for (let i = anchorIdx + 1; i < siblings.length; i++) {
				priorities[i] = priorities[i - 1]! + 100;
			}

			// Record all updated priorities
			for (const [i, sibling] of siblings.entries()) {
				if (sibling.existingPriority !== priorities[i]) {
					result.set(sibling.id, priorities[i]!);
				}
			}
			return result;
		}
	}

	// Handle new nodes using middle-out algorithm (expand from known priorities)
	let changed = true;
	while (changed) {
		changed = false;
		for (let i = 0; i < priorities.length; i++) {
			if (priorities[i] !== null) continue;

			const prevIdx = findPrevWithPriority(priorities, i);
			const nextIdx = findNextWithPriority(priorities, i);

			const adjacentToPrev = prevIdx !== null && prevIdx === i - 1;
			const adjacentToNext = nextIdx !== null && nextIdx === i + 1;

			if (!adjacentToPrev && !adjacentToNext) continue;

			let newPriority: number;
			if (prevIdx !== null && nextIdx !== null) {
				newPriority = Math.floor((priorities[prevIdx]! + priorities[nextIdx]!) / 2);
			} else if (prevIdx !== null) {
				newPriority = priorities[prevIdx]! + 100;
			} else if (nextIdx === null) {
				continue;
			} else {
				newPriority = priorities[nextIdx]! - 100;
			}

			priorities[i] = newPriority;
			result.set(siblings[i].id, newPriority);
			changed = true;
		}
	}

	return result;
}

/** Convert a cached timestamp column to Unix seconds, the unit backups use. */
function toUnixSeconds(value: Date | null): number | null {
	return value ? Math.floor(value.getTime() / 1000) : null;
}

export interface ImportBackupResult {
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
	/** Nodes newer than the snapshot that were kept instead of being tombstoned. */
	nodesPreserved: number;
	skipped?: boolean;
	skipReason?: string;
	localWatermark?: string | null;
	incomingWatermark?: string | null;
}

/**
 * Import nodes from a Workflowy backup file.
 *
 * This follows an optimized compare-first pattern:
 * - Load: Load existing active rows into Maps for O(1) lookups
 * - Compare: Classify incoming data into groups:
 *   (a) Unchanged: existing rows that match incoming - DO NOTHING
 *   (b) Changed: existing rows with different values - phase out old, insert new
 *   (c) New only: incoming rows with no existing match - INSERT
 *   (d) Deleted: existing rows with no incoming match - phase out
 * - Execute: Only touch rows in groups b, c, d
 *
 * @param database Drizzle database instance
 * @param filePath Path to the backup JSON file
 * @param backupImportFilename Filename of the backup being imported
 * @param verbose Show detailed timing information
 * @param timestamp Override the import (system_from) timestamp
 * @param force Bypass the stale-snapshot watermark guard
 */
export async function importBackup(
	database: BetterSQLite3Database<typeof schema>,
	filePath: string,
	backupImportFilename: string,
	verbose = false,
	timestamp?: Date,
	force = false,
): Promise<ImportBackupResult> {
	const startTime = Date.now();
	let lastTime = startTime;

	if (verbose) {
		logger.debug(`[IMPORT] Starting import with verbose=${verbose}`);
	}

	const logTiming = (phase: string) => {
		if (!verbose) return;
		const now = Date.now();
		const elapsed = now - lastTime;
		const total = now - startTime;
		logger.debug(`  [${phase}]: ${elapsed}ms (total: ${total}ms)`);
		lastTime = now;
	};

	const fileContent = readBackupFile(filePath);
	logTiming('Read file');

	const parsedJson = JSON.parse(fileContent);
	const rootNodes = BackupFileSchema.parse(parsedJson);
	logTiming(`Parse and validate JSON (${rootNodes.length} root nodes)`);

	const importTimestamp = timestamp ?? new Date();
	const importTimestampStr = formatTemporalTimestamp(importTimestamp);

	const allNodes: Array<{node: BackupNode; parentId: string | null; priority: number}> = [];
	const collectNodes = (node: BackupNode, parentId: string | null, priority: number) => {
		allNodes.push({node, parentId, priority});
		if (node.ch && Array.isArray(node.ch)) {
			for (let childIndex = 0; childIndex < node.ch.length; childIndex++) {
				// Use raw index as backup position; actual priority is inferred later
				collectNodes(node.ch[childIndex], node.id, childIndex);
			}
		}
	};

	for (const [rootIndex, rootNode] of rootNodes.entries()) {
		// Use raw index as backup position; actual priority is inferred later
		collectNodes(rootNode, null, rootIndex);
	}
	logTiming(`Traverse tree (${allNodes.length} total nodes)`);

	// Get the Workflowy epoch (user-specific timestamp offset for backup files)
	// Priority: WORKFLOWY_EPOCH env var > config table > auto-fetch from internal API
	const workflowyEpoch = await getOrFetchWorkflowyEpoch(database);
	logTiming(`Using Workflowy epoch: ${workflowyEpoch}`);

	const nodesToProcess: Array<{
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
	}> = [];
	// Consolidated mirror relationships: mirrorId is the mirror, originalId is what it mirrors
	const mirrorRecords: Array<{originalId: string; mirrorId: string}> = [];
	const backlinkRecords: Array<{nodeId: string; sourceId: string; targetId: string}> = [];
	const virtualRootIdRecords: Array<{nodeId: string; virtualRootIds: string[]}> = [];
	const aiMetadataRecords: Array<{nodeId: string; inChat: number}> = [];
	const s3FileRecords: Array<{
		nodeId: string;
		fileName: string;
		fileType: string;
		objectFolder: string | null;
		isAnimatedGif: number | null;
		imageOriginalWidth: number | null;
		imageOriginalHeight: number | null;
		imageOriginalPixels: number | null;
		isDeleted: number | null;
	}> = [];
	const changesMetadataRecords: Array<{nodeId: string; ctBy: number}> = [];
	const referencesRootsRecords: Array<{nodeId: string}> = [];
	const calendarMetadataRecords: Array<{
		nodeId: string;
		root: number | null;
		level: string | null;
		value: string | null;
		dateId: number | null;
		timestamp: number | null;
		foundDates: number | null;
	}> = [];
	const calendarLevelsRecords: Array<{
		nodeId: string;
		day: number | null;
		week: number | null;
		month: number | null;
		year: number | null;
	}> = [];

	let validationErrors = 0;

	for (const {node, parentId, priority} of allNodes) {
		try {
			const validatedNode = BackupNodeSchema.parse(node);

			nodesToProcess.push({
				id: validatedNode.id,
				shortId: uuidToShortId(validatedNode.id),
				name: validatedNode.nm ?? '',
				note: validatedNode.no || null,
				parentId,
				priority,
				createdAt: validatedNode.ct ? backupToUnixTime(validatedNode.ct, workflowyEpoch) : null,
				modifiedAt: validatedNode.lm ? backupToUnixTime(validatedNode.lm, workflowyEpoch) : null,
				completedAt: validatedNode.cp ? backupToUnixTime(validatedNode.cp, workflowyEpoch) : null,
				layoutMode: normalizeLayoutMode(validatedNode.metadata.layoutMode),
			});

			if (validatedNode.metadata.isReferencesRoot) {
				referencesRootsRecords.push({
					nodeId: validatedNode.id,
				});
			}

			// Collect all mirror relationships into unified mirrorRecords
			if (validatedNode.metadata.mirror) {
				// originalId means this node is a mirror of that ID
				if ('originalId' in validatedNode.metadata.mirror && validatedNode.metadata.mirror.originalId) {
					mirrorRecords.push({
						originalId: validatedNode.metadata.mirror.originalId,
						mirrorId: validatedNode.id,
					});
				}
				// mirrorRootIds: this node is the original; each of those IDs mirrors it
				if ('mirrorRootIds' in validatedNode.metadata.mirror && validatedNode.metadata.mirror.mirrorRootIds) {
					for (const rootId of Object.keys(validatedNode.metadata.mirror.mirrorRootIds)) {
						mirrorRecords.push({
							originalId: validatedNode.id,
							mirrorId: rootId,
						});
					}
				}
				// backlinkMirrorRootIds: each of those IDs mirrors this node
				if (
					'backlinkMirrorRootIds' in validatedNode.metadata.mirror &&
					validatedNode.metadata.mirror.backlinkMirrorRootIds
				) {
					for (const backlinkId of Object.keys(validatedNode.metadata.mirror.backlinkMirrorRootIds)) {
						mirrorRecords.push({
							originalId: validatedNode.id,
							mirrorId: backlinkId,
						});
					}
				}
			}

			if (validatedNode.metadata.backlink) {
				backlinkRecords.push({
					nodeId: validatedNode.id,
					sourceId: validatedNode.metadata.backlink.sourceID,
					targetId: validatedNode.metadata.backlink.targetID,
				});
			}

			if (validatedNode.metadata.virtualRootIds) {
				virtualRootIdRecords.push({
					nodeId: validatedNode.id,
					virtualRootIds: Object.keys(validatedNode.metadata.virtualRootIds),
				});
			}

			if (validatedNode.metadata.ai) {
				aiMetadataRecords.push({
					nodeId: validatedNode.id,
					inChat: validatedNode.metadata.ai.inChat ? 1 : 0,
				});
			}

			if (validatedNode.metadata.s3File) {
				s3FileRecords.push({
					nodeId: validatedNode.id,
					fileName: validatedNode.metadata.s3File.fileName,
					fileType: validatedNode.metadata.s3File.fileType,
					objectFolder: validatedNode.metadata.s3File.objectFolder || null,
					isAnimatedGif: validatedNode.metadata.s3File.isAnimatedGIF ? 1 : 0,
					imageOriginalWidth: validatedNode.metadata.s3File.imageOriginalWidth || null,
					imageOriginalHeight: validatedNode.metadata.s3File.imageOriginalHeight || null,
					imageOriginalPixels: validatedNode.metadata.s3File.imageOriginalPixels || null,
					isDeleted: validatedNode.metadata.s3File.isDeleted ? 1 : 0,
				});
			}

			if (validatedNode.metadata.changes?.ct) {
				changesMetadataRecords.push({
					nodeId: validatedNode.id,
					ctBy: validatedNode.metadata.changes.ct.by,
				});
			}

			if (validatedNode.metadata.calendar) {
				const cal = validatedNode.metadata.calendar;
				calendarMetadataRecords.push({
					nodeId: validatedNode.id,
					root: cal.root ? 1 : cal.root === false ? 0 : null,
					level: cal.level ?? null,
					value: cal.value ?? null,
					dateId: cal.dateId ?? null,
					timestamp: cal.timestamp ?? null,
					foundDates: cal.found_dates ? 1 : cal.found_dates === false ? 0 : null,
				});
				if (cal.levels) {
					calendarLevelsRecords.push({
						nodeId: validatedNode.id,
						day: cal.levels.day ? 1 : cal.levels.day === false ? 0 : null,
						week: cal.levels.week ? 1 : cal.levels.week === false ? 0 : null,
						month: cal.levels.month ? 1 : cal.levels.month === false ? 0 : null,
						year: cal.levels.year ? 1 : cal.levels.year === false ? 0 : null,
					});
				}
			}
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

	logTiming(
		`Prepare data (${nodesToProcess.length} nodes, ${mirrorRecords.length} mirrors, ${backlinkRecords.length} backlinks)`,
	);

	// Guard against stale-snapshot data loss from the bulk-export endpoint.
	// The bulk-export API returns a snapshot taken at a point in time, and the
	// merge phase-out logic below tombstones anything absent from it — including
	// nodes written after the snapshot, which it cannot testify about. The
	// per-node REST API is always fresh and does not need this guard, so it lives
	// here in the bulk-export adapter only.
	//
	// Rather than refuse the whole import, protect only the nodes the snapshot
	// cannot speak for: those whose own createdAt/modifiedAt/completedAt is newer
	// than the snapshot's high watermark. Everything else merges normally, so an
	// older backup still contributes the fields only backups carry (attachments,
	// mirrors) without rolling back newer writes.
	//
	// Both watermarks are source content timestamps in Unix ms. Note that
	// node_content.systemFrom is a cache-write time, not a content time — using it
	// as the local watermark made every backup look stale forever, because
	// `cache import-api` stamps it with the wall clock on each daily run.
	let incomingMaxUnix = 0;
	for (const n of nodesToProcess) {
		if (n.createdAt !== null && n.createdAt > incomingMaxUnix) incomingMaxUnix = n.createdAt;
		if (n.modifiedAt !== null && n.modifiedAt > incomingMaxUnix) incomingMaxUnix = n.modifiedAt;
		if (n.completedAt !== null && n.completedAt > incomingMaxUnix) incomingMaxUnix = n.completedAt;
	}
	const incomingWatermarkMs = incomingMaxUnix === 0 ? null : incomingMaxUnix * 1000;
	const incomingWatermark: string | null =
		incomingWatermarkMs === null ? null : formatTemporalTimestamp(new Date(incomingWatermarkMs));

	// The local watermark and the protected id set are computed once
	// existingMetadataMap is loaded, below.
	let localWatermark: string | null = null;
	let protectedIds = new Set<string>();

	// Reset diagnostic counters before comparison phase
	metadataComparisonStats.reset();

	let nodesAdded = 0;
	let nodesUpdated = 0;
	let nodesUnchanged = 0;
	let nodesPhasedOut = 0;
	let nodesDeleted = 0;
	let contentUpdated = 0;
	let metadataUpdated = 0;
	let priorityUpdated = 0;

	// Load existing active rows for classification and priority calculation.
	// The actual phase-out/insert of the node-keyed tables is owned by the
	// shared importer's applyRows(); these reads only feed the stats and the
	// priority inference below.
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

	// Newest content timestamp already in the cache, and the ids the incoming
	// snapshot predates. `force` waives the protection and imports the snapshot
	// verbatim, tombstoning anything it omits.
	let localMaxUnix = 0;
	for (const metadata of existingMetadataMap.values()) {
		for (const stamp of [metadata.createdAt, metadata.modifiedAt, metadata.completedAt]) {
			const unix = toUnixSeconds(stamp);
			if (unix !== null && unix > localMaxUnix) localMaxUnix = unix;
		}
	}
	localWatermark = localMaxUnix === 0 ? null : formatTemporalTimestamp(new Date(localMaxUnix * 1000));

	if (!force && incomingMaxUnix > 0) {
		const backupNodeIds = new Set(nodesToProcess.map((n) => n.id));
		for (const [nodeId, metadata] of existingMetadataMap) {
			if (backupNodeIds.has(nodeId)) continue;
			const newest = Math.max(
				toUnixSeconds(metadata.createdAt) ?? 0,
				toUnixSeconds(metadata.modifiedAt) ?? 0,
				toUnixSeconds(metadata.completedAt) ?? 0,
			);
			if (newest > incomingMaxUnix) protectedIds.add(nodeId);
		}
	}
	logTiming(`Protected ${protectedIds.size} nodes newer than the snapshot`);

	// resolvedPriorities is populated by the classification block below and read
	// when building the node_metadata rows.
	const resolvedPriorities = new Map<string, number>();
	let orphanIds: string[] = [];

	{
		// Compute orphan IDs in memory (existing nodes not in backup)
		// This is fail-safe: empty orphan set = nothing closed
		// (vs the old approach where empty backup set = everything closed)
		const backupNodeIds = new Set(nodesToProcess.map((n) => n.id));
		orphanIds = [...existingContentMap.keys()].filter((id) => !backupNodeIds.has(id) && !protectedIds.has(id));

		// Sanity check: if backup has far fewer nodes than DB, something is wrong
		if (nodesToProcess.length < existingContentMap.size * 0.5 && existingContentMap.size > 1000) {
			throw new Error(
				`Backup has only ${nodesToProcess.length} nodes but DB has ${existingContentMap.size}. ` +
					`This looks like a corrupted or partial backup. Aborting to prevent data loss.`,
			);
		}
		logTiming(`Found ${orphanIds.length} orphaned nodes to close`);

		// Build set of incoming node IDs for deletion detection
		const incomingNodeIds = new Set<string>();
		for (const nodeData of nodesToProcess) {
			incomingNodeIds.add(nodeData.id);
		}

		// Build sibling map and infer priorities for new nodes
		// Group nodes by parent with their backup position (tree traversal order)
		const siblingsByParent = new Map<
			string | null,
			Array<{
				id: string;
				backupPosition: number;
				existingPriority: number | null;
			}>
		>();

		for (const nodeData of nodesToProcess) {
			const existing = existingMetadataMap.get(nodeData.id);
			const siblings = siblingsByParent.get(nodeData.parentId) ?? [];
			siblings.push({
				id: nodeData.id,
				backupPosition: nodeData.priority,
				existingPriority: existing?.priority ?? null,
			});
			siblingsByParent.set(nodeData.parentId, siblings);
		}

		// Sort and calculate priorities for each parent's children
		// Handles new nodes AND order changes for existing nodes
		const calculatedPriorities = new Map<string, number>();
		for (const siblings of siblingsByParent.values()) {
			siblings.sort((a, b) => a.backupPosition - b.backupPosition);
			const calculated = calculatePriorities(siblings);
			for (const [id, priority] of calculated) {
				calculatedPriorities.set(id, priority);
			}
		}
		logTiming(`Calculated priorities for ${calculatedPriorities.size} nodes`);

		// Classify nodes for node-level stats and resolve each node's final priority.
		// (a) Unchanged - no DB operations
		// (b) Changed - phase out old, insert new
		// (c) New - insert only
		// (d) Deleted - phase out only (handled by temporalMerge's absence detection)
		//
		// resolvedPriorities holds the priority each node should be stored with;
		// the metadata merge below reads it instead of nodeData.priority (which is
		// only the backup-tree position, not the inferred priority).
		for (const nodeData of nodesToProcess) {
			const existingContent = existingContentMap.get(nodeData.id);
			const existingMetadata = existingMetadataMap.get(nodeData.id);

			const isNew = !existingContent;
			let contentChanged = false;
			let metadataChanged = false;

			if (!existingContent) {
				contentChanged = true;
			} else if (!contentMatches(existingContent, nodeData)) {
				contentUpdated++;
				contentChanged = true;
			}

			// For new nodes: use calculated priority.
			// For existing nodes: check if order changed (priority recalculated) or other metadata changed.
			const newPriority = calculatedPriorities.get(nodeData.id);
			const priorityChanged =
				newPriority !== undefined && existingMetadata && newPriority !== existingMetadata.priority;

			if (!existingMetadata) {
				resolvedPriorities.set(nodeData.id, newPriority ?? nodeData.priority);
				metadataChanged = true;
			} else {
				resolvedPriorities.set(nodeData.id, newPriority ?? existingMetadata.priority ?? nodeData.priority);
				if (
					priorityChanged ||
					!metadataMatches(existingMetadata, {
						...nodeData,
						// For backup imports, compare against existing priority, not tree position
						// (priority is calculated separately, not derived from nodeData.priority).
						priority: existingMetadata.priority,
					})
				) {
					if (priorityChanged) {
						priorityUpdated++;
					} else {
						metadataUpdated++;
					}
					metadataChanged = true;
				}
			}

			if (isNew) {
				nodesAdded++;
			} else if (contentChanged || metadataChanged) {
				nodesUpdated++;
			} else {
				nodesUnchanged++;
			}
		}

		// Deleted nodes: existing but not in incoming (counted for stats; the
		// temporal-merge engine phases them out via absence detection).
		for (const existingId of existingContentMap.keys()) {
			if (!incomingNodeIds.has(existingId)) {
				nodesPhasedOut++;
			}
		}

		logTiming(
			`Classified: ${nodesAdded} new, ${nodesUpdated} changed, ${nodesUnchanged} unchanged, ${nodesPhasedOut} deleted`,
		);

		// Log diagnostic stats to identify which metadata field is causing mismatches
		metadataComparisonStats.log();
	}

	// Normalize the bulk-export tree into the shared in-DB row shape, then hand
	// the node-keyed temporal tables to the shared importer. applyRows() owns the
	// transaction, the temporal merge, and FK-correct insertion order for these
	// tables. The composite-key tables (mirrors, backlinks, virtual_root_ids) and
	// orphan cleanup are merged separately below — they are not node-keyed and the
	// merge engine does not yet support their multi-column natural keys.
	const nodeContentRows: NormalizedNodeContentRow[] = nodesToProcess.map((node) => ({
		id: node.id,
		name: node.name,
		note: node.note,
		parentId: node.parentId,
	}));
	const nodeMetadataRows: NormalizedNodeMetadataRow[] = nodesToProcess.map((node) => ({
		nodeId: node.id,
		shortId: node.shortId,
		priority: resolvedPriorities.get(node.id) ?? node.priority,
		createdAt: timestampToDate(node.createdAt),
		modifiedAt: timestampToDate(node.modifiedAt),
		completedAt: timestampToDate(node.completedAt),
		layoutMode: node.layoutMode,
	}));
	const calendarMetadataRows: NormalizedCalendarMetadataRow[] = calendarMetadataRecords.map((record) => ({
		...record,
	}));
	const calendarLevelsRows: NormalizedCalendarLevelsRow[] = calendarLevelsRecords.map((record) => ({...record}));
	const aiMetadataRows: NormalizedAiMetadataRow[] = aiMetadataRecords.map((record) => ({...record}));
	const s3FileRows: NormalizedS3FileRow[] = s3FileRecords.map((record) => ({...record}));
	const changesMetadataRows: NormalizedChangesMetadataRow[] = changesMetadataRecords.map((record) => ({...record}));
	const referencesRootsRows: NormalizedReferencesRootsRow[] = referencesRootsRecords.map((record) => ({...record}));

	const mergeResult = applyRows(
		database,
		{
			nodeContent: nodeContentRows,
			nodeMetadata: nodeMetadataRows,
			calendarMetadata: calendarMetadataRows,
			calendarLevels: calendarLevelsRows,
			aiMetadata: aiMetadataRows,
			s3Files: s3FileRows,
			changesMetadata: changesMetadataRows,
			referencesRoots: referencesRootsRows,
		},
		importTimestampStr,
		protectedIds,
	);
	logTiming(
		`Merged node-keyed tables: ${mergeResult.nodeContent?.inserted ?? 0} content, ` +
			`${mergeResult.nodeMetadata?.inserted ?? 0} metadata`,
	);
	logTiming(`Content updates: ${contentUpdated}, Metadata updates: ${metadataUpdated}`);

	database.transaction((tx) => {
		// Merge mirror relationships through the shared engine (composite key:
		// originalId + mirrorId). Dedupe incoming first, since temporalMerge treats
		// each incoming row as a desired-state row and would otherwise double-insert
		// a repeated pair.
		const dedupedMirrors = [...new Map(mirrorRecords.map((m) => [joinKey(m.originalId, m.mirrorId), m])).values()];
		const currentMirrorRows = tx.select().from(mirrors).where(eq(mirrors.systemTo, FAR_FUTURE_DATE)).all();
		const mirrorResult = temporalMerge(
			tx,
			{
				table: mirrors,
				keyColumns: [mirrors.originalId, mirrors.mirrorId],
				systemToColumn: mirrors.systemTo,
				incomingKey: (m: {originalId: string; mirrorId: string}) => joinKey(m.originalId, m.mirrorId),
				currentKey: (m: {originalId: string; mirrorId: string}) => joinKey(m.originalId, m.mirrorId),
				contentMatches: () => true, // mirror rows carry no content beyond their key
				buildInsertRow: (m: {originalId: string; mirrorId: string}) => ({
					originalId: m.originalId,
					mirrorId: m.mirrorId,
				}),
			},
			dedupedMirrors,
			currentMirrorRows,
			importTimestampStr,
		);
		logTiming(`Processed mirrors: ${mirrorResult.inserted} inserted, ${mirrorResult.phasedOut} closed`);

		// Merge backlinks through the shared engine (composite key: nodeId +
		// sourceId + targetId). A full backup is the complete desired state, so this
		// is a GLOBAL merge: any current backlink whose key is absent from the backup
		// is closed — including every backlink of a node that lost all of them. The
		// former per-node loop only scanned nodes that still had incoming backlinks,
		// so it silently leaked the backlinks of a node that dropped to zero.
		const dedupedBacklinks = [
			...new Map(backlinkRecords.map((b) => [joinKey(b.nodeId, b.sourceId, b.targetId), b])).values(),
		];
		const currentBacklinkRows = tx.select().from(backlinks).where(eq(backlinks.systemTo, FAR_FUTURE_DATE)).all();
		const backlinkResult = temporalMerge(
			tx,
			{
				table: backlinks,
				keyColumns: [backlinks.nodeId, backlinks.sourceId, backlinks.targetId],
				systemToColumn: backlinks.systemTo,
				incomingKey: (b: {nodeId: string; sourceId: string; targetId: string}) =>
					joinKey(b.nodeId, b.sourceId, b.targetId),
				currentKey: (b: {nodeId: string; sourceId: string; targetId: string}) =>
					joinKey(b.nodeId, b.sourceId, b.targetId),
				contentMatches: () => true, // backlink rows carry no content beyond their key
				buildInsertRow: (b: {nodeId: string; sourceId: string; targetId: string}) => ({
					nodeId: b.nodeId,
					sourceId: b.sourceId,
					targetId: b.targetId,
				}),
			},
			dedupedBacklinks,
			currentBacklinkRows,
			importTimestampStr,
		);
		logTiming(`Processed backlinks: ${backlinkResult.inserted} inserted, ${backlinkResult.phasedOut} closed`);

		// Merge virtual root IDs through the shared engine (composite key: nodeId +
		// virtualRootId). Also a GLOBAL merge — a node that lost all of its virtual
		// roots has them closed, which the former per-node loop could not do. The
		// backup carries these as one record per node with a list of ids, so flatten
		// to one desired-state row per (nodeId, virtualRootId) pair first.
		const dedupedVirtualRootIds = [
			...new Map(
				virtualRootIdRecords.flatMap((r) =>
					r.virtualRootIds.map((v) => [joinKey(r.nodeId, v), {nodeId: r.nodeId, virtualRootId: v}] as const),
				),
			).values(),
		];
		const currentVirtualRootIdRows = tx
			.select()
			.from(virtualRootIds)
			.where(eq(virtualRootIds.systemTo, FAR_FUTURE_DATE))
			.all();
		const virtualRootIdResult = temporalMerge(
			tx,
			{
				table: virtualRootIds,
				keyColumns: [virtualRootIds.nodeId, virtualRootIds.virtualRootId],
				systemToColumn: virtualRootIds.systemTo,
				incomingKey: (r: {nodeId: string; virtualRootId: string}) => joinKey(r.nodeId, r.virtualRootId),
				currentKey: (r: {nodeId: string; virtualRootId: string}) => joinKey(r.nodeId, r.virtualRootId),
				contentMatches: () => true, // virtual-root rows carry no content beyond their key
				buildInsertRow: (r: {nodeId: string; virtualRootId: string}) => ({
					nodeId: r.nodeId,
					virtualRootId: r.virtualRootId,
				}),
			},
			dedupedVirtualRootIds,
			currentVirtualRootIdRows,
			importTimestampStr,
		);
		logTiming(
			`Processed virtual root IDs: ${virtualRootIdResult.inserted} inserted, ${virtualRootIdResult.phasedOut} closed`,
		);

		// Close out nodes that were deleted in Workflowy (not present in this backup)
		// Uses in-memory orphan IDs computed earlier - this is fail-safe:
		// empty orphan set = nothing closed (vs old approach where empty temp table = everything closed)
		//
		// node_content, node_metadata, and the node-keyed attribute tables
		// (ai_metadata, s3_files, changes_metadata, references_roots,
		// calendar_metadata, calendar_levels) have ALREADY had their orphan rows
		// phased out by applyRows() above — temporalMerge closes any current row
		// whose key is absent from the incoming set. Only the composite-key tables
		// and node_embeddings (which applyRows() does not manage) need explicit
		// orphan cleanup here.
		if (orphanIds.length > 0) {
			nodesDeleted = orphanIds.length;

			// Close orphaned mirrors (where the mirror node is orphaned)
			for (let i = 0; i < orphanIds.length; i += BULK_BATCH_SIZE) {
				const batch = orphanIds.slice(i, i + BULK_BATCH_SIZE);
				tx.update(mirrors)
					.set({systemTo: importTimestampStr})
					.where(
						and(
							eq(mirrors.systemTo, FAR_FUTURE_DATE),
							lt(mirrors.systemFrom, importTimestampStr),
							inArray(mirrors.mirrorId, batch),
						),
					)
					.run();
			}

			// Close orphaned backlinks
			for (let i = 0; i < orphanIds.length; i += BULK_BATCH_SIZE) {
				const batch = orphanIds.slice(i, i + BULK_BATCH_SIZE);
				tx.update(backlinks)
					.set({systemTo: importTimestampStr})
					.where(
						and(
							eq(backlinks.systemTo, FAR_FUTURE_DATE),
							lt(backlinks.systemFrom, importTimestampStr),
							inArray(backlinks.nodeId, batch),
						),
					)
					.run();
			}

			// Close orphaned virtual root IDs
			for (let i = 0; i < orphanIds.length; i += BULK_BATCH_SIZE) {
				const batch = orphanIds.slice(i, i + BULK_BATCH_SIZE);
				tx.update(virtualRootIds)
					.set({systemTo: importTimestampStr})
					.where(
						and(
							eq(virtualRootIds.systemTo, FAR_FUTURE_DATE),
							lt(virtualRootIds.systemFrom, importTimestampStr),
							inArray(virtualRootIds.nodeId, batch),
						),
					)
					.run();
			}

			// Close orphaned node embeddings
			for (let i = 0; i < orphanIds.length; i += BULK_BATCH_SIZE) {
				const batch = orphanIds.slice(i, i + BULK_BATCH_SIZE);
				tx.update(nodeEmbeddings)
					.set({systemTo: importTimestampStr})
					.where(
						and(
							eq(nodeEmbeddings.systemTo, FAR_FUTURE_DATE),
							lt(nodeEmbeddings.systemFrom, importTimestampStr),
							inArray(nodeEmbeddings.nodeId, batch),
						),
					)
					.run();
			}
		}

		logTiming(`Closed ${nodesDeleted} orphaned nodes (deleted from Workflowy)`);
	});

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
		nodesPreserved: protectedIds.size,
		skipped: false,
		localWatermark,
		incomingWatermark,
	};
}
