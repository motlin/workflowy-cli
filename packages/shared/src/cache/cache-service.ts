import * as schema from '../db/schema.js';
import {
	aiMetadata,
	backlinks,
	changesMetadata,
	mirrors,
	nodeContent,
	nodeMetadata,
	referencesRoots,
	s3Files,
	virtualRootIds,
} from '../db/schema.js';
import {stripHtmlTags} from '../html/strip-tags.js';
import {FAR_FUTURE_DATE, formatTemporalTimestamp} from '../temporal/constants.js';
import type {Node} from '../types/node.js';
import type {WorkflowyNode} from '../types/workflowy.js';
import {uuidToShortId} from '../workflowy/constants.js';
import {and, eq, inArray, isNull, like, notInArray, or, sql} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {
	contentMatches,
	currentVersion,
	metadataMatches,
	normalizeLayoutMode,
	systemFromToDate,
} from './cache-temporal.js';
import {NodeReader} from './node-reader.js';

/**
 * Type for a node with all related data from a Drizzle query with relations.
 * This is the raw result type returned by getChildrenWithMergedData.
 *
 * Distinct from the canonical `Node` DTO: it carries the joined relation
 * tables (mirrors, backlinks, calendar, etc.) that the canonical type
 * deliberately excludes, and keeps `priority` nullable as stored in the DB.
 */
export type NodeWithRelations = {
	id: string;
	shortId: string | null;
	name: string | null;
	note: string | null;
	parentId: string | null;
	priority: number | null;
	createdAt: Date | null;
	modifiedAt: Date | null;
	completedAt: Date | null;
	layoutMode: string | null;
	systemFrom: string;
	systemTo: string;
	// Mirrors where this node is the original (other nodes mirror this one)
	mirrorsAsOriginal?: Array<{mirrorId: string}>;
	// Mirrors where this node is the copy (this node mirrors others)
	mirrorsAsCopy?: Array<{originalId: string}>;
	backlinks?: Array<{sourceId: string; targetId: string}>;
	virtualRootIds?: Array<{virtualRootId: string}>;
	aiMetadata?: {inChat: number} | null;
	s3File?: {
		fileName: string;
		fileType: string;
		objectFolder: string | null;
		isAnimatedGif: number | null;
		imageOriginalWidth: number | null;
		imageOriginalHeight: number | null;
		imageOriginalPixels: number | null;
		isDeleted: number | null;
	} | null;
	changesMetadata?: {ctBy: number} | null;
	referencesRoot?: {nodeId: string} | null;
	calendar?: {
		root: number | null;
		level: string | null;
		value: string | null;
		dateId: number | null;
		timestamp: number | null;
		foundDates: number | null;
		levels?: {
			day: number | null;
			week: number | null;
			month: number | null;
			year: number | null;
		} | null;
	} | null;
};

/** Options for {@link CacheService.searchText}. */
export type TextSearchOptions = {
	query: string;
	limit?: number;
	incomplete?: boolean;
};

/** A single text-search hit: the matched node's identity and content. */
export type TextSearchRow = {
	id: string;
	shortId: string | null;
	name: string | null;
	note: string | null;
	completedAt: Date | null;
};

/**
 * Convert a Unix timestamp (seconds since epoch) to a Date object.
 * Returns null if the input is null or undefined.
 */
function timestampToDate(timestamp: number | null | undefined): Date | null {
	return timestamp === null || timestamp === undefined ? null : new Date(timestamp * 1000);
}

export class CacheService {
	protected database: BetterSQLite3Database<typeof schema>;
	protected nodeReader: NodeReader;

	constructor(database: BetterSQLite3Database<typeof schema>) {
		this.database = database;
		this.nodeReader = new NodeReader(database);
	}

	async getNode(nodeId: string): Promise<Node | undefined> {
		return this.nodeReader.getById(nodeId) ?? undefined;
	}

	async getMultipleNodes(nodeIds: string[]): Promise<Map<string, Node>> {
		return this.nodeReader.getMany(nodeIds);
	}

	async getChildren(parentId: string | null): Promise<Node[]> {
		return this.nodeReader.getChildren(parentId);
	}

	/**
	 * Get a single child node by exact name match.
	 * @param parentId The parent ID (null for root nodes)
	 * @param name The exact name to match
	 */
	async getChildByName(parentId: string | null, name: string): Promise<Node | null> {
		const children = this.nodeReader.getChildren(parentId);
		// Names may carry inline HTML formatting (e.g. a colored <span> around
		// "Personal"). Callers pass plain-text path segments, so fall back to a
		// tag-stripped comparison when the raw name does not match exactly.
		return children.find((child) => child.name === name || stripHtmlTags(child.name) === name) ?? null;
	}

	/**
	 * Get node with cache timestamp
	 */
	async getNodeWithMergedData(nodeId: string): Promise<{
		node: Node | undefined;
		source: 'cache' | 'none';
		fetchedAt?: Date;
	}> {
		const node = await this.getNode(nodeId);
		if (!node) {
			return {node: undefined, source: 'none'};
		}

		return {
			node,
			source: 'cache',
			fetchedAt: systemFromToDate(node.systemFrom),
		};
	}

	/**
	 * Get children with all related data from cache.
	 * Returns raw Drizzle query results with joined relations.
	 */
	async getChildrenWithMergedData(parentId: string | null): Promise<NodeWithRelations[]> {
		const whereClause =
			parentId === null
				? and(isNull(nodeContent.parentId), currentVersion(nodeContent))
				: and(eq(nodeContent.parentId, parentId), currentVersion(nodeContent));

		const results = this.database.query.nodeContent
			.findMany({
				where: whereClause,
				with: {
					metadata: true,
					mirrorsAsOriginal: {
						where: currentVersion(mirrors),
					},
					mirrorsAsCopy: {
						where: currentVersion(mirrors),
					},
					backlinks: {
						where: currentVersion(backlinks),
					},
					virtualRootIds: {
						where: currentVersion(virtualRootIds),
					},
					aiMetadata: true,
					s3File: true,
					changesMetadata: true,
					referencesRoot: true,
					calendar: {
						columns: {
							root: true,
							level: true,
							value: true,
							dateId: true,
							timestamp: true,
							foundDates: true,
						},
						with: {
							levels: true,
						},
					},
				},
			})
			.sync();

		// Sort by priority and createdAt (metadata fields)
		results.sort((a, b) => {
			const priorityA = a.metadata?.priority ?? 0;
			const priorityB = b.metadata?.priority ?? 0;
			if (priorityA !== priorityB) {
				return priorityA - priorityB;
			}
			const createdAtA = a.metadata?.createdAt?.getTime() ?? 0;
			const createdAtB = b.metadata?.createdAt?.getTime() ?? 0;
			return createdAtA - createdAtB;
		});

		// Transform nodeContent results to Node format
		return results.map((result) => ({
			id: result.id,
			shortId: result.metadata?.shortId ?? null,
			name: result.name,
			note: result.note,
			parentId: result.parentId,
			priority: result.metadata?.priority ?? null,
			createdAt: result.metadata?.createdAt ?? null,
			modifiedAt: result.metadata?.modifiedAt ?? null,
			completedAt: result.metadata?.completedAt ?? null,
			layoutMode: result.metadata?.layoutMode ?? null,
			systemFrom: result.systemFrom,
			systemTo: result.systemTo,
			mirrorsAsOriginal: result.mirrorsAsOriginal,
			mirrorsAsCopy: result.mirrorsAsCopy,
			backlinks: result.backlinks,
			virtualRootIds: result.virtualRootIds,
			aiMetadata: result.aiMetadata,
			s3File: result.s3File,
			changesMetadata: result.changesMetadata,
			referencesRoot: result.referencesRoot,
			calendar: result.calendar,
		}));
	}

	/**
	 * Substring-search node names and notes, returning the current version of each
	 * matching node. The single text-search primitive behind both the CLI `node
	 * search` command and the MCP `workflowy_search` tool; each adapter formats the
	 * rows its own way (CLI adds a path, MCP a URL).
	 */
	async searchText(options: TextSearchOptions): Promise<TextSearchRow[]> {
		const {query, limit = 20, incomplete = false} = options;
		const pattern = `%${query}%`;

		const conditions = [
			currentVersion(nodeContent),
			or(like(nodeContent.name, pattern), like(nodeContent.note, pattern)),
		];
		if (incomplete) {
			conditions.push(isNull(nodeMetadata.completedAt));
		}

		return this.database
			.select({
				id: nodeContent.id,
				name: nodeContent.name,
				note: nodeContent.note,
				shortId: nodeMetadata.shortId,
				completedAt: nodeMetadata.completedAt,
			})
			.from(nodeContent)
			.innerJoin(nodeMetadata, and(eq(nodeContent.id, nodeMetadata.nodeId), currentVersion(nodeMetadata)))
			.where(and(...conditions))
			.limit(limit)
			.all();
	}

	/**
	 * Get the joined-relation rows for a specific set of node IDs (any parents),
	 * in the same shape as {@link getChildrenWithMergedData}. Used to seed a
	 * subtree read from arbitrary root nodes rather than from a single parent.
	 */
	async getMergedDataForNodes(nodeIds: string[]): Promise<NodeWithRelations[]> {
		if (nodeIds.length === 0) return [];

		const results = this.database.query.nodeContent
			.findMany({
				where: and(inArray(nodeContent.id, nodeIds), currentVersion(nodeContent)),
				with: {
					metadata: true,
					mirrorsAsOriginal: {where: currentVersion(mirrors)},
					mirrorsAsCopy: {where: currentVersion(mirrors)},
					backlinks: {where: currentVersion(backlinks)},
					virtualRootIds: {where: currentVersion(virtualRootIds)},
					aiMetadata: true,
					s3File: true,
					changesMetadata: true,
					referencesRoot: true,
					calendar: {
						columns: {
							root: true,
							level: true,
							value: true,
							dateId: true,
							timestamp: true,
							foundDates: true,
						},
						with: {levels: true},
					},
				},
			})
			.sync();

		return results.map((result) => ({
			id: result.id,
			shortId: result.metadata?.shortId ?? null,
			name: result.name,
			note: result.note,
			parentId: result.parentId,
			priority: result.metadata?.priority ?? null,
			createdAt: result.metadata?.createdAt ?? null,
			modifiedAt: result.metadata?.modifiedAt ?? null,
			completedAt: result.metadata?.completedAt ?? null,
			layoutMode: result.metadata?.layoutMode ?? null,
			systemFrom: result.systemFrom,
			systemTo: result.systemTo,
			mirrorsAsOriginal: result.mirrorsAsOriginal,
			mirrorsAsCopy: result.mirrorsAsCopy,
			backlinks: result.backlinks,
			virtualRootIds: result.virtualRootIds,
			aiMetadata: result.aiMetadata,
			s3File: result.s3File,
			changesMetadata: result.changesMetadata,
			referencesRoot: result.referencesRoot,
			calendar: result.calendar,
		}));
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
				.where(and(eq(nodeContent.id, parentId), currentVersion(nodeContent)))
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
					.where(and(eq(nodeContent.id, apiNode.id), currentVersion(nodeContent)))
					.get();

				const existingMetadata = tx
					.select()
					.from(nodeMetadata)
					.where(and(eq(nodeMetadata.nodeId, apiNode.id), currentVersion(nodeMetadata)))
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
						layoutMode: normalizeLayoutMode(apiNode.data?.layoutMode),
					};

					const contentChanged = !contentMatches(existingContent!, contentData);
					const metadataChanged = existingMetadata && !metadataMatches(existingMetadata, metaData);

					if (contentChanged) {
						tx.update(nodeContent)
							.set({systemTo: systemTimestampStr})
							.where(and(eq(nodeContent.id, apiNode.id), currentVersion(nodeContent)))
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
							.where(and(eq(nodeMetadata.nodeId, apiNode.id), currentVersion(nodeMetadata)))
							.run();
						tx.insert(nodeMetadata)
							.values({
								nodeId: apiNode.id,
								shortId: uuidToShortId(apiNode.id),
								priority: apiNode.priority,
								createdAt: timestampToDate(apiNode.createdAt),
								modifiedAt: timestampToDate(apiNode.modifiedAt),
								completedAt: timestampToDate(apiNode.completedAt),
								layoutMode: normalizeLayoutMode(apiNode.data?.layoutMode),
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
							layoutMode: normalizeLayoutMode(apiNode.data?.layoutMode),
							systemFrom: systemTimestampStr,
							systemTo: FAR_FUTURE_DATE,
						})
						.run();
				}

				// Mirrors, backlinks, and virtual-root rows are sourced ONLY from backup imports — the API
				// response never carries them, so expiring them here would be permanent data loss, not a
				// refresh (#1712). Leave them untouched; backup imports own their lifecycle and genuine
				// deletions are handled by deleteNode(). The attribute tables below are refreshed per node
				// because the API sync is authoritative for them.
				tx.update(aiMetadata)
					.set({systemTo: systemTimestampStr})
					.where(and(eq(aiMetadata.nodeId, apiNode.id), currentVersion(aiMetadata)))
					.run();
				tx.update(s3Files)
					.set({systemTo: systemTimestampStr})
					.where(and(eq(s3Files.nodeId, apiNode.id), currentVersion(s3Files)))
					.run();
				tx.update(changesMetadata)
					.set({systemTo: systemTimestampStr})
					.where(and(eq(changesMetadata.nodeId, apiNode.id), currentVersion(changesMetadata)))
					.run();
				tx.update(referencesRoots)
					.set({systemTo: systemTimestampStr})
					.where(and(eq(referencesRoots.nodeId, apiNode.id), currentVersion(referencesRoots)))
					.run();
			}

			// Phase out cached children that are no longer in API response (deleted nodes)
			// This is the third leg of the merge list pattern
			if (parentId !== null) {
				const phaseOutSystemToStr = formatTemporalTimestamp(fetchTimestamp);
				const apiNodeIds = apiNodes.map((n) => n.id);
				// nodeMetadata has no parentId, so scope its phase-out to this parent's children
				// via a subquery against nodeContent — and run it FIRST, while those content rows
				// still hold the current version the subquery matches on.
				const metadataUnderParent = sql`${nodeMetadata.nodeId} IN (
					SELECT id FROM node_content WHERE parent_id = ${parentId} AND system_to = ${FAR_FUTURE_DATE}
				)`;
				if (apiNodeIds.length > 0) {
					tx.update(nodeMetadata)
						.set({systemTo: phaseOutSystemToStr})
						.where(
							and(
								currentVersion(nodeMetadata),
								notInArray(nodeMetadata.nodeId, apiNodeIds),
								metadataUnderParent,
							),
						)
						.run();
					tx.update(nodeContent)
						.set({systemTo: phaseOutSystemToStr})
						.where(
							and(
								eq(nodeContent.parentId, parentId),
								currentVersion(nodeContent),
								notInArray(nodeContent.id, apiNodeIds),
							),
						)
						.run();
				} else {
					// API returned 0 children: phase out all cached children of this parent.
					tx.update(nodeMetadata)
						.set({systemTo: phaseOutSystemToStr})
						.where(and(currentVersion(nodeMetadata), metadataUnderParent))
						.run();
					tx.update(nodeContent)
						.set({systemTo: phaseOutSystemToStr})
						.where(and(eq(nodeContent.parentId, parentId), currentVersion(nodeContent)))
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
			.where(and(eq(nodeContent.id, node.id), currentVersion(nodeContent)))
			.get();

		const existingMetadata = existingContent
			? this.database
					.select()
					.from(nodeMetadata)
					.where(and(eq(nodeMetadata.nodeId, node.id), currentVersion(nodeMetadata)))
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
				layoutMode: normalizeLayoutMode(node.data?.layoutMode),
			};

			const contentChanged = !contentMatches(existingContent!, contentData);
			const metadataChanged = existingMetadata && !metadataMatches(existingMetadata, metaData);

			if (contentChanged || metadataChanged) {
				const systemTimestampStr = formatTemporalTimestamp(fetchTimestamp);

				if (contentChanged) {
					this.database
						.update(nodeContent)
						.set({systemTo: systemTimestampStr})
						.where(and(eq(nodeContent.id, node.id), currentVersion(nodeContent)))
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
						.where(and(eq(nodeMetadata.nodeId, node.id), currentVersion(nodeMetadata)))
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
							layoutMode: normalizeLayoutMode(node.data?.layoutMode),
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
					layoutMode: normalizeLayoutMode(node.data?.layoutMode),
					systemFrom: systemFromStr,
					systemTo: FAR_FUTURE_DATE,
				})
				.run();
		}

		// Note: We intentionally do NOT phase out siblings here.
		// This is for incremental inserts, not bulk sync.
	}

	/**
	 * Delete a node and all its descendants from the cache using temporal pattern.
	 * This closes the records by setting systemTo to the current timestamp.
	 * @param nodeId The node ID to delete
	 */
	async deleteNode(nodeId: string): Promise<void> {
		const now = formatTemporalTimestamp(new Date());

		// Collect all descendant IDs iteratively (BFS)
		const descendantIds: string[] = [nodeId];
		let currentIndex = 0;
		while (currentIndex < descendantIds.length) {
			const parentId = descendantIds[currentIndex];
			const children = this.database
				.select({id: nodeContent.id})
				.from(nodeContent)
				.where(and(eq(nodeContent.parentId, parentId), currentVersion(nodeContent)))
				.all();
			for (const child of children) {
				descendantIds.push(child.id);
			}
			currentIndex++;
		}

		// Close all node records (set systemTo to now). A genuine deletion also closes the
		// node's own relationship records (backlinks, virtualRootIds, mirrors): the node is gone,
		// so no backup import will re-supply them. This does NOT replay the sync data-loss bug (#1712),
		// which blanked these for nodes still present — here the nodes are actually deleted. Rows
		// are filtered by nodeId, so a surviving node's backlink that merely targets a deleted
		// node is left untouched.
		this.database.transaction((tx) => {
			for (const id of descendantIds) {
				tx.update(nodeContent)
					.set({systemTo: now})
					.where(and(eq(nodeContent.id, id), currentVersion(nodeContent)))
					.run();
				tx.update(nodeMetadata)
					.set({systemTo: now})
					.where(and(eq(nodeMetadata.nodeId, id), currentVersion(nodeMetadata)))
					.run();
				tx.update(backlinks)
					.set({systemTo: now})
					.where(and(eq(backlinks.nodeId, id), currentVersion(backlinks)))
					.run();
				tx.update(virtualRootIds)
					.set({systemTo: now})
					.where(and(eq(virtualRootIds.nodeId, id), currentVersion(virtualRootIds)))
					.run();
				// A mirror row keys the deleted node as either the copy or the original; close
				// it from whichever side, so a deleted node leaves no dangling mirror link.
				tx.update(mirrors)
					.set({systemTo: now})
					.where(and(or(eq(mirrors.mirrorId, id), eq(mirrors.originalId, id)), currentVersion(mirrors)))
					.run();
			}
		});
	}

	/**
	 * Find a node by path using cached data.
	 * Uses exact name matching with targeted SQL queries per path segment.
	 * @param path Array of exact node names to traverse
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
			const matchingChild = await this.getChildByName(currentParentId, segment);

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
	 * Get children for multiple parent IDs in a single query.
	 * Returns a Map from parentId to array of NodeWithRelations.
	 * This is more efficient than calling getChildrenWithMergedData multiple times.
	 */
	async getChildrenForMultipleParents(parentIds: string[]): Promise<Map<string, NodeWithRelations[]>> {
		if (parentIds.length === 0) {
			return new Map();
		}

		const children = this.database.query.nodeContent
			.findMany({
				where: and(inArray(nodeContent.parentId, parentIds), currentVersion(nodeContent)),
				with: {
					metadata: true,
					mirrorsAsOriginal: {
						where: currentVersion(mirrors),
					},
					mirrorsAsCopy: {
						where: currentVersion(mirrors),
					},
					backlinks: {
						where: currentVersion(backlinks),
					},
					virtualRootIds: {
						where: currentVersion(virtualRootIds),
					},
					aiMetadata: true,
					s3File: true,
					changesMetadata: true,
					referencesRoot: true,
					calendar: {
						columns: {
							root: true,
							level: true,
							value: true,
							dateId: true,
							timestamp: true,
							foundDates: true,
						},
						with: {
							levels: true,
						},
					},
				},
			})
			.sync();

		// Sort in-memory since orderBy can't reference joined relation columns
		children.sort((a, b) => {
			const priorityA = a.metadata?.priority ?? 0;
			const priorityB = b.metadata?.priority ?? 0;
			if (priorityA !== priorityB) return priorityA - priorityB;
			const createdAtA = a.metadata?.createdAt?.getTime() ?? 0;
			const createdAtB = b.metadata?.createdAt?.getTime() ?? 0;
			return createdAtA - createdAtB;
		});

		const resultMap = new Map<string, NodeWithRelations[]>();

		for (const parentId of parentIds) {
			resultMap.set(parentId, []);
		}

		for (const child of children) {
			const {parentId} = child;
			if (!parentId) continue;

			const existingList = resultMap.get(parentId);
			if (existingList) {
				// Transform to NodeWithRelations format
				existingList.push({
					id: child.id,
					shortId: child.metadata?.shortId ?? null,
					name: child.name,
					note: child.note,
					parentId: child.parentId,
					priority: child.metadata?.priority ?? null,
					createdAt: child.metadata?.createdAt ?? null,
					modifiedAt: child.metadata?.modifiedAt ?? null,
					completedAt: child.metadata?.completedAt ?? null,
					layoutMode: child.metadata?.layoutMode ?? null,
					systemFrom: child.systemFrom,
					systemTo: child.systemTo,
					mirrorsAsOriginal: child.mirrorsAsOriginal,
					mirrorsAsCopy: child.mirrorsAsCopy,
					backlinks: child.backlinks,
					virtualRootIds: child.virtualRootIds,
					aiMetadata: child.aiMetadata,
					s3File: child.s3File,
					changesMetadata: child.changesMetadata,
					referencesRoot: child.referencesRoot,
					calendar: child.calendar,
				});
			}
		}

		return resultMap;
	}

	/**
	 * Resolve a short_id (12 hex chars from Workflowy URL) to a full UUID.
	 * Returns null if no matching node is found.
	 */
	async resolveShortIdToUuid(shortId: string): Promise<string | null> {
		const result = this.database.query.nodeMetadata
			.findFirst({
				where: and(eq(nodeMetadata.shortId, shortId), currentVersion(nodeMetadata)),
				columns: {nodeId: true},
			})
			.sync();
		return result?.nodeId ?? null;
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
				where: and(inArray(nodeMetadata.shortId, shortIds), currentVersion(nodeMetadata)),
				columns: {nodeId: true, shortId: true},
			})
			.sync();

		const map = new Map<string, string>();
		for (const result of results) {
			if (result.shortId) {
				map.set(result.shortId, result.nodeId);
			}
		}
		return map;
	}

	/**
	 * Get the original node ID for a mirror node.
	 * Returns null if the node is not a mirror or not found.
	 */
	async getMirrorOriginal(mirrorId: string): Promise<string | null> {
		const result = this.database
			.select({originalId: mirrors.originalId})
			.from(mirrors)
			.where(and(eq(mirrors.mirrorId, mirrorId), currentVersion(mirrors)))
			.get();
		return result?.originalId ?? null;
	}
}
