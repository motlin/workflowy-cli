import * as schema from '../db/schema.js';
import {mirrors, nodeContent, nodeMetadata} from '../db/schema.js';
import type {Node} from '../types/node.js';
import {and, eq, inArray, isNull} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {currentVersion} from './cache-temporal.js';

/**
 * Raw joined row shape returned by the nodeContent + nodeMetadata queries.
 */
type ContentWithMetadata = schema.NodeContentType & {
	metadata: schema.NodeMetadataType | null;
};

/**
 * Single read service for loading current nodes from the SQLite cache.
 *
 * `NodeReader` owns every "load current node(s) with relationships" query.
 * It is the only construction site for the canonical `Node` DTO. All
 * `FAR_FUTURE_DATE` temporal filtering and mirror relationship resolution
 * happens inside this class, so callers receive a fully-formed `Node`.
 *
 * Derived per-query fields (`hasChildren`, the resolved-from-mirror name
 * fallback) deliberately stay off the `Node` DTO — REST handlers compute
 * those from a `Node` plus extra batched queries.
 */
export class NodeReader {
	private readonly database: BetterSQLite3Database<typeof schema>;

	constructor(database: BetterSQLite3Database<typeof schema>) {
		this.database = database;
	}

	/**
	 * Load a single current node by full UUID. Returns null when the node
	 * does not exist or has no current temporal record.
	 */
	getById(id: string): Node | null {
		const result = this.database.query.nodeContent
			.findFirst({
				where: and(eq(nodeContent.id, id), currentVersion(nodeContent)),
				with: {metadata: true},
			})
			.sync();
		if (!result) {
			return null;
		}
		return this.toNode(result, this.resolveMirror(id));
	}

	/**
	 * Load the current children of a parent node, ordered by priority then
	 * creation time. Pass null to load root-level nodes.
	 */
	getChildren(parentId: string | null): Node[] {
		const whereClause =
			parentId === null
				? and(isNull(nodeContent.parentId), currentVersion(nodeContent))
				: and(eq(nodeContent.parentId, parentId), currentVersion(nodeContent));

		const results = this.database.query.nodeContent
			.findMany({
				where: whereClause,
				with: {metadata: true},
			})
			.sync();

		const mirrorMap = this.resolveMirrors(results.map((result) => result.id));

		return results
			.map((result) => this.toNode(result, mirrorMap.get(result.id) ?? null))
			.sort((a, b) => {
				const priorityDifference = a.priority - b.priority;
				if (priorityDifference !== 0) {
					return priorityDifference;
				}
				const aTime = a.createdAt?.getTime() ?? 0;
				const bTime = b.createdAt?.getTime() ?? 0;
				return aTime - bTime;
			});
	}

	/**
	 * Load a single current node by its 12-character short ID. Returns null
	 * when no node maps to the short ID.
	 */
	getByShortId(shortId: string): Node | null {
		const metadataRow = this.database.query.nodeMetadata
			.findFirst({
				where: and(eq(nodeMetadata.shortId, shortId), currentVersion(nodeMetadata)),
				columns: {nodeId: true},
			})
			.sync();
		if (!metadataRow) {
			return null;
		}
		return this.getById(metadataRow.nodeId);
	}

	/**
	 * Load many current nodes by full UUID in a single query. Missing IDs are
	 * absent from the returned map.
	 */
	getMany(ids: string[]): Map<string, Node> {
		if (ids.length === 0) {
			return new Map();
		}

		const results = this.database.query.nodeContent
			.findMany({
				where: and(inArray(nodeContent.id, ids), currentVersion(nodeContent)),
				with: {metadata: true},
			})
			.sync();

		const mirrorMap = this.resolveMirrors(results.map((result) => result.id));

		const map = new Map<string, Node>();
		for (const result of results) {
			map.set(result.id, this.toNode(result, mirrorMap.get(result.id) ?? null));
		}
		return map;
	}

	/**
	 * Resolve the original node ID for a single node if it is a mirror copy.
	 */
	private resolveMirror(nodeId: string): string | null {
		const mirrorRow = this.database
			.select({originalId: mirrors.originalId})
			.from(mirrors)
			.where(and(eq(mirrors.mirrorId, nodeId), currentVersion(mirrors)))
			.get();
		return mirrorRow?.originalId ?? null;
	}

	/**
	 * Resolve original node IDs for a batch of nodes that may be mirror copies.
	 * Returns a map from mirror node ID to original node ID.
	 */
	private resolveMirrors(nodeIds: string[]): Map<string, string> {
		const map = new Map<string, string>();
		if (nodeIds.length === 0) {
			return map;
		}
		const mirrorRows = this.database
			.select({mirrorId: mirrors.mirrorId, originalId: mirrors.originalId})
			.from(mirrors)
			.where(and(inArray(mirrors.mirrorId, nodeIds), currentVersion(mirrors)))
			.all();
		for (const row of mirrorRows) {
			map.set(row.mirrorId, row.originalId);
		}
		return map;
	}

	/**
	 * Construct the canonical `Node` DTO from a joined content + metadata row.
	 */
	private toNode(row: ContentWithMetadata, mirrorOriginalId: string | null): Node {
		return {
			id: row.id,
			shortId: row.metadata?.shortId ?? null,
			parentId: row.parentId,
			name: row.name,
			note: row.note,
			priority: row.metadata?.priority ?? 0,
			layoutMode: row.metadata?.layoutMode ?? null,
			createdAt: row.metadata?.createdAt ?? null,
			modifiedAt: row.metadata?.modifiedAt ?? null,
			completedAt: row.metadata?.completedAt ?? null,
			collapsed: false,
			mirror: {
				isMirror: mirrorOriginalId !== null,
				originalNodeId: mirrorOriginalId,
			},
			systemFrom: row.systemFrom,
			systemTo: row.systemTo,
		};
	}
}
