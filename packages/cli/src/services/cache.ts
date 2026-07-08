import {
	aiMetadata,
	backlinks,
	changesMetadata,
	nodeContent,
	nodeMetadata,
	referencesRoots,
	s3Files,
	virtualRootIds,
} from '@workflowy/shared/db';
import {FAR_FUTURE_DATE, formatTemporalTimestamp} from '@workflowy/shared/temporal';
import type {Node, WorkflowyNode} from '@workflowy/shared/types';
import {uuidToShortId} from '@workflowy/shared/workflowy';
import {and, eq, inArray, notInArray, sql} from 'drizzle-orm';
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

	async getChildrenWithMergedData(parentId: string | null) {
		const result = await super.getChildrenWithMergedData(parentId);
		logger.logSqlResult('getChildrenWithMergedData', result);
		return result;
	}

	async getChildrenForMultipleParents(parentIds: string[]) {
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

	/**
	 * Insert a newly created node into the cache without affecting siblings.
	 * Use this for node creation operations where we're adding a single node
	 * and should NOT phase out existing siblings.
	 *
	 * This differs from storeApiResponse() which is designed for bulk sync operations
	 * where the API returns the complete list of children and we need to phase out
	 * any cached children that no longer exist.
	 *
	 * @param node The newly created node from the API
	 * @param parentId The parent ID this node belongs to (null for root)
	 */
	async insertNode(node: WorkflowyNode, parentId: string | null): Promise<void> {
		const fetchTimestamp = new Date();
		const systemFromStr = formatTemporalTimestamp(fetchTimestamp);

		// Check if node already exists
		const existingContent = this.database
			.select()
			.from(nodeContent)
			.where(and(eq(nodeContent.id, node.id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
			.get();

		const existingMetadata = existingContent
			? this.database
					.select()
					.from(nodeMetadata)
					.where(and(eq(nodeMetadata.nodeId, node.id), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)))
					.get()
			: null;

		if (existingContent) {
			// Node already exists - update only tables where data actually changed
			const contentData = {
				name: node.name,
				note: node.note || null,
				parentId,
			};
			const metaData = {
				priority: node.priority,
				createdAt: node.createdAt,
				modifiedAt: node.modifiedAt,
				completedAt: node.completedAt ?? null,
				layoutMode: normalizeLayoutModeShared(node.data?.layoutMode),
			};

			const contentChanged = !contentMatches(existingContent!, contentData);
			const metadataChanged = existingMetadata && !metadataMatches(existingMetadata, metaData);

			if (contentChanged || metadataChanged) {
				const systemTimestampStr = formatTemporalTimestamp(fetchTimestamp);

				if (contentChanged) {
					this.database
						.update(nodeContent)
						.set({systemTo: systemTimestampStr})
						.where(and(eq(nodeContent.id, node.id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
						.run();
					this.database
						.insert(nodeContent)
						.values({
							id: node.id,
							name: node.name,
							note: node.note || null,
							parentId,
							systemFrom: systemTimestampStr,
							systemTo: FAR_FUTURE_DATE,
						})
						.run();
				}

				if (metadataChanged) {
					this.database
						.update(nodeMetadata)
						.set({systemTo: systemTimestampStr})
						.where(and(eq(nodeMetadata.nodeId, node.id), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)))
						.run();
					this.database
						.insert(nodeMetadata)
						.values({
							nodeId: node.id,
							shortId: uuidToShortId(node.id),
							priority: node.priority,
							createdAt: timestampToDate(node.createdAt),
							modifiedAt: timestampToDate(node.modifiedAt),
							completedAt: timestampToDate(node.completedAt),
							layoutMode: normalizeLayoutModeShared(node.data?.layoutMode),
							systemFrom: systemTimestampStr,
							systemTo: FAR_FUTURE_DATE,
						})
						.run();
				}
			}
		} else {
			// Insert new node
			this.database
				.insert(nodeContent)
				.values({
					id: node.id,
					name: node.name,
					note: node.note || null,
					parentId,
					systemFrom: systemFromStr,
					systemTo: FAR_FUTURE_DATE,
				})
				.run();
			this.database
				.insert(nodeMetadata)
				.values({
					nodeId: node.id,
					shortId: uuidToShortId(node.id),
					priority: node.priority,
					createdAt: timestampToDate(node.createdAt),
					modifiedAt: timestampToDate(node.modifiedAt),
					completedAt: timestampToDate(node.completedAt),
					layoutMode: normalizeLayoutModeShared(node.data?.layoutMode),
					systemFrom: systemFromStr,
					systemTo: FAR_FUTURE_DATE,
				})
				.run();
		}

		// Note: We intentionally do NOT phase out siblings here.
		// This is for incremental inserts, not bulk sync.
	}

	/**
	 * Delete a node and all its descendants from the cache.
	 * This closes out temporal records (sets systemTo to current time).
	 * @param nodeId The ID of the node to delete
	 */
	async deleteNode(nodeId: string): Promise<void> {
		const deleteTimestamp = new Date();
		const systemToStr = formatTemporalTimestamp(deleteTimestamp);

		// Recursively collect all descendant node IDs
		const collectDescendants = async (parentId: string): Promise<string[]> => {
			const children = this.database
				.select({id: nodeContent.id})
				.from(nodeContent)
				.where(and(eq(nodeContent.parentId, parentId), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
				.all();

			const descendants: string[] = [];
			for (const child of children) {
				descendants.push(child.id);
				const childDescendants = await collectDescendants(child.id);
				descendants.push(...childDescendants);
			}
			return descendants;
		};

		const descendantIds = await collectDescendants(nodeId);
		const allNodeIds = [nodeId, ...descendantIds];

		this.database.transaction((tx) => {
			for (const id of allNodeIds) {
				// Close nodeContent table record
				tx.update(nodeContent)
					.set({systemTo: systemToStr})
					.where(and(eq(nodeContent.id, id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
					.run();

				// Close nodeMetadata table record
				tx.update(nodeMetadata)
					.set({systemTo: systemToStr})
					.where(and(eq(nodeMetadata.nodeId, id), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)))
					.run();

				// Close backlinks records
				tx.update(backlinks)
					.set({systemTo: systemToStr})
					.where(and(eq(backlinks.nodeId, id), eq(backlinks.systemTo, FAR_FUTURE_DATE)))
					.run();

				// Close virtualRootIds records
				tx.update(virtualRootIds)
					.set({systemTo: systemToStr})
					.where(and(eq(virtualRootIds.nodeId, id), eq(virtualRootIds.systemTo, FAR_FUTURE_DATE)))
					.run();
			}
		});
	}

	/**
	 * Find a node by path using cached data
	 * @param path Array of node names to traverse
	 * @param rootId Optional root node ID to start from
	 */
	async findNodeByPath(path: string[], rootId: string | null = null): Promise<Node | null> {
		if (path.length === 0) {
			if (rootId) {
				const node = await this.getNode(rootId);
				return node || null;
			}
			return null;
		}

		let currentParentId = rootId;

		for (const segment of path) {
			const children = await this.getChildren(currentParentId);

			const matchingChild = children.find((child) => {
				if (!child.name) return false;
				const cleanName = child.name.replaceAll(/<[^>]*>/g, '');
				return child.name.includes(segment) || cleanName.includes(segment);
			});

			if (!matchingChild) {
				return null;
			}

			if (segment === path.at(-1)) {
				return matchingChild;
			}

			currentParentId = matchingChild.id;
		}

		return null;
	}

	/**
	 * Resolve multiple short_ids to full UUIDs in a single query.
	 * Returns a Map from short_id to full UUID.
	 */
	async resolveMultipleShortIds(shortIds: string[]): Promise<Map<string, string>> {
		if (shortIds.length === 0) {
			return new Map();
		}

		const results = this.database.query.nodeMetadata
			.findMany({
				where: and(inArray(nodeMetadata.shortId, shortIds), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)),
				columns: {nodeId: true, shortId: true},
			})
			.sync();
		logger.logSqlResult('resolveMultipleShortIds', results);

		const map = new Map<string, string>();
		for (const result of results) {
			if (result.shortId) {
				map.set(result.shortId, result.nodeId);
			}
		}
		return map;
	}
}
