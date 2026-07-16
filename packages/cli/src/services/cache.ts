import {aiMetadata, changesMetadata, nodeContent, nodeMetadata, referencesRoots, s3Files} from '@workflowy/shared/db';
import {FAR_FUTURE_DATE, formatTemporalTimestamp} from '@workflowy/shared/temporal';
import type {Node, WorkflowyNode} from '@workflowy/shared/types';
import {uuidToShortId} from '@workflowy/shared/workflowy';
import {and, eq, notInArray, sql} from 'drizzle-orm';
import {contentMatches, metadataMatches, normalizeLayoutMode as normalizeLayoutModeShared} from './cache-temporal.js';
import {CacheService as BaseCacheService} from '@workflowy/shared/cache';
import {importBackup, type ImportBackupResult} from './cache-import.js';
import {logger} from './logger.js';

/**
 * Convert a Unix timestamp (seconds) to a Date object.
 * Returns null if the input is null or undefined.
 */
function timestampToDate(timestamp: number | null | undefined): Date | null {
	return timestamp === null || timestamp === undefined ? null : new Date(timestamp * 1000);
}

/**
 * CLI-specific CacheService that extends the shared CacheService with
 * backup import functionality. This functionality requires Node.js fs
 * module, so it cannot be included in the shared package.
 */
export class CacheService extends BaseCacheService {
	/**
	 * Import nodes from a Workflowy backup file
	 * @param filePath Path to the backup JSON file
	 * @param backupImportFilename Filename of the backup being imported
	 * @param verbose Show detailed timing information
	 * @param force Bypass the stale-snapshot watermark guard
	 */
	async importBackup(
		filePath: string,
		backupImportFilename: string,
		verbose = false,
		force = false,
	): Promise<ImportBackupResult> {
		return importBackup(this.database, filePath, backupImportFilename, verbose, undefined, force);
	}

	async getNode(nodeId: string): Promise<Node | undefined> {
		const result = await super.getNode(nodeId);
		logger.logSqlResult('getNode', result);
		return result;
	}

	async getChildren(parentId: string | null): Promise<Node[]> {
		const results = await super.getChildren(parentId);
		logger.logSqlResult('getChildren', results);
		return results;
	}

	async getChildrenWithMergedData(
		parentId: string | null,
	): Promise<Awaited<ReturnType<BaseCacheService['getChildrenWithMergedData']>>> {
		const result = await super.getChildrenWithMergedData(parentId);
		logger.logSqlResult('getChildrenWithMergedData', result);
		return result;
	}

	async getChildrenForMultipleParents(
		parentIds: string[],
	): Promise<Awaited<ReturnType<BaseCacheService['getChildrenForMultipleParents']>>> {
		const result = await super.getChildrenForMultipleParents(parentIds);
		logger.logSqlResult('getChildrenForMultipleParents', result);
		return result;
	}

	async getMirrorOriginal(nodeId: string) {
		const result = await super.getMirrorOriginal(nodeId);
		logger.logSqlResult('getMirrorOriginal', result);
		return result;
	}

	/**
	 * Store API response data for nodes
	 * @param apiNodes Array of nodes from the API
	 * @param parentId The parent ID these nodes belong to (null for root)
	 */
	async storeApiResponse(apiNodes: WorkflowyNode[], parentId: string | null): Promise<void> {
		const fetchTimestamp = new Date();

		if (parentId) {
			const parentExists = this.database
				.select({id: nodeContent.id})
				.from(nodeContent)
				.where(and(eq(nodeContent.id, parentId), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
				.get();

			if (!parentExists) {
				const systemFromStr = formatTemporalTimestamp(fetchTimestamp);
				this.database
					.insert(nodeContent)
					.values({
						id: parentId,
						name: null,
						note: null,
						parentId: null,
						systemFrom: systemFromStr,
						systemTo: FAR_FUTURE_DATE,
					})
					.run();
				this.database
					.insert(nodeMetadata)
					.values({
						nodeId: parentId,
						shortId: uuidToShortId(parentId),
						priority: null,
						createdAt: null,
						modifiedAt: null,
						completedAt: null,
						layoutMode: null,
						systemFrom: systemFromStr,
						systemTo: FAR_FUTURE_DATE,
					})
					.run();
			}
		}

		this.database.transaction((tx) => {
			for (const apiNode of apiNodes) {
				const systemTimestampStr = formatTemporalTimestamp(fetchTimestamp);

				const existingContent = tx
					.select()
					.from(nodeContent)
					.where(and(eq(nodeContent.id, apiNode.id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
					.get();

				const existingMetadata = tx
					.select()
					.from(nodeMetadata)
					.where(and(eq(nodeMetadata.nodeId, apiNode.id), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)))
					.get();

				if (existingContent) {
					const contentData = {
						name: apiNode.name,
						note: apiNode.note || null,
						parentId,
					};
					const metaData = {
						priority: apiNode.priority,
						createdAt: apiNode.createdAt,
						modifiedAt: apiNode.modifiedAt,
						completedAt: apiNode.completedAt ?? null,
						layoutMode: normalizeLayoutModeShared(apiNode.data?.layoutMode),
					};

					const contentChanged = !contentMatches(existingContent!, contentData);
					const metadataChanged = existingMetadata && !metadataMatches(existingMetadata, metaData);

					if (contentChanged) {
						tx.update(nodeContent)
							.set({systemTo: systemTimestampStr})
							.where(and(eq(nodeContent.id, apiNode.id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
							.run();
						tx.insert(nodeContent)
							.values({
								id: apiNode.id,
								name: apiNode.name,
								note: apiNode.note || null,
								parentId,
								systemFrom: systemTimestampStr,
								systemTo: FAR_FUTURE_DATE,
							})
							.run();
					}

					if (metadataChanged) {
						tx.update(nodeMetadata)
							.set({systemTo: systemTimestampStr})
							.where(and(eq(nodeMetadata.nodeId, apiNode.id), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)))
							.run();
						tx.insert(nodeMetadata)
							.values({
								nodeId: apiNode.id,
								shortId: uuidToShortId(apiNode.id),
								priority: apiNode.priority,
								createdAt: timestampToDate(apiNode.createdAt),
								modifiedAt: timestampToDate(apiNode.modifiedAt),
								completedAt: timestampToDate(apiNode.completedAt),
								layoutMode: normalizeLayoutModeShared(apiNode.data?.layoutMode),
								systemFrom: systemTimestampStr,
								systemTo: FAR_FUTURE_DATE,
							})
							.run();
					}
				} else {
					tx.insert(nodeContent)
						.values({
							id: apiNode.id,
							name: apiNode.name,
							note: apiNode.note || null,
							parentId,
							systemFrom: systemTimestampStr,
							systemTo: FAR_FUTURE_DATE,
						})
						.run();
					tx.insert(nodeMetadata)
						.values({
							nodeId: apiNode.id,
							shortId: uuidToShortId(apiNode.id),
							priority: apiNode.priority,
							createdAt: timestampToDate(apiNode.createdAt),
							modifiedAt: timestampToDate(apiNode.modifiedAt),
							completedAt: timestampToDate(apiNode.completedAt),
							layoutMode: normalizeLayoutModeShared(apiNode.data?.layoutMode),
							systemFrom: systemTimestampStr,
							systemTo: FAR_FUTURE_DATE,
						})
						.run();
				}

				// Mirrors, backlinks, and virtual-root rows are sourced ONLY from backup
				// imports — the API response never carries them. Expiring them on every sync
				// would be permanent data loss, not a refresh: each daily `cache sync-node` over
				// a subtree silently blanked its mirror nodes (the mirror→original link was
				// dropped and never re-inserted). Leave them untouched and let backup imports
				// own their lifecycle; genuine deletions are handled by deleteNode().

				tx.update(aiMetadata)
					.set({systemTo: systemTimestampStr})
					.where(and(eq(aiMetadata.nodeId, apiNode.id), eq(aiMetadata.systemTo, FAR_FUTURE_DATE)))
					.run();

				tx.update(s3Files)
					.set({systemTo: systemTimestampStr})
					.where(and(eq(s3Files.nodeId, apiNode.id), eq(s3Files.systemTo, FAR_FUTURE_DATE)))
					.run();

				tx.update(changesMetadata)
					.set({systemTo: systemTimestampStr})
					.where(and(eq(changesMetadata.nodeId, apiNode.id), eq(changesMetadata.systemTo, FAR_FUTURE_DATE)))
					.run();

				tx.update(referencesRoots)
					.set({systemTo: systemTimestampStr})
					.where(and(eq(referencesRoots.nodeId, apiNode.id), eq(referencesRoots.systemTo, FAR_FUTURE_DATE)))
					.run();
			}

			// Phase out cached children that are no longer in API response (deleted nodes)
			// This is the third leg of the merge list pattern
			if (parentId !== null) {
				const phaseOutSystemToStr = formatTemporalTimestamp(fetchTimestamp);
				const apiNodeIds = apiNodes.map((n) => n.id);
				if (apiNodeIds.length > 0) {
					// Phase out metadata FIRST (while content still has FAR_FUTURE_DATE for the subquery)
					// (nodeMetadata doesn't have parentId, so we filter via nodeContent)
					tx.update(nodeMetadata)
						.set({systemTo: phaseOutSystemToStr})
						.where(
							and(
								eq(nodeMetadata.systemTo, FAR_FUTURE_DATE),
								notInArray(nodeMetadata.nodeId, apiNodeIds),
								sql`${nodeMetadata.nodeId} IN (
									SELECT id FROM node_content
									WHERE parent_id = ${parentId}
									AND system_to = ${FAR_FUTURE_DATE}
								)`,
							),
						)
						.run();
					// Then phase out content
					tx.update(nodeContent)
						.set({systemTo: phaseOutSystemToStr})
						.where(
							and(
								eq(nodeContent.parentId, parentId),
								eq(nodeContent.systemTo, FAR_FUTURE_DATE),
								notInArray(nodeContent.id, apiNodeIds),
							),
						)
						.run();
				} else {
					// If API returns 0 children, phase out all cached children of this parent
					// Phase out metadata FIRST (while content still has FAR_FUTURE_DATE for the subquery)
					tx.update(nodeMetadata)
						.set({systemTo: phaseOutSystemToStr})
						.where(
							and(
								eq(nodeMetadata.systemTo, FAR_FUTURE_DATE),
								sql`${nodeMetadata.nodeId} IN (
									SELECT id FROM node_content
									WHERE parent_id = ${parentId}
									AND system_to = ${FAR_FUTURE_DATE}
								)`,
							),
						)
						.run();
					// Then phase out content
					tx.update(nodeContent)
						.set({systemTo: phaseOutSystemToStr})
						.where(and(eq(nodeContent.parentId, parentId), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
						.run();
				}
			}
		});
	}
}
