import * as schema from '../db/schema.js';
import {nodeContent} from '../db/schema.js';
import {stripHtmlTags} from '../html/strip-tags.js';
import {and, inArray} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {currentVersion} from './cache-temporal.js';

// SQLite 3.32.0+ has SQLITE_MAX_VARIABLE_NUMBER = 32766
// Use 10000 to stay safely under while minimizing query count
const SQL_CHUNK_SIZE = 10_000;

interface NodeInfo {
	name: string | null;
	parentId: string | null;
}

/**
 * Builds ancestor paths, plain-text content, and leaf/non-leaf classification for
 * nodes, using level-by-level batched queries. Shared by the CLI (path headers,
 * search enrichment, embeddings) and the web server (path enrichment) so ancestor
 * walking lives in one place.
 */
export class PathBuilder {
	private database: BetterSQLite3Database<typeof schema>;

	constructor(database: BetterSQLite3Database<typeof schema>) {
		this.database = database;
	}

	async buildFullPath(nodeId: string): Promise<string> {
		const paths = await this.buildFullPathsBatch([nodeId]);
		return paths.get(nodeId) ?? '';
	}

	/**
	 * Build the ancestor name-parts (root-first, blanks skipped) for multiple nodes
	 * using level-by-level batching, reducing O(nodes × depth) queries to O(depth).
	 *
	 * Algorithm:
	 * 1. Start with the set of node IDs we need paths for
	 * 2. Query all those nodes to get their names and parent IDs
	 * 3. Collect unique parent IDs not yet in our map
	 * 4. Repeat until we've reached all roots (no more new parents)
	 * 5. Reconstruct each path by walking the in-memory map
	 */
	async buildFullPathPartsBatch(nodeIds: string[]): Promise<Map<string, string[]>> {
		if (nodeIds.length === 0) {
			return new Map();
		}

		const nodeMap = new Map<string, NodeInfo>();
		let currentIds = [...new Set(nodeIds)];

		while (currentIds.length > 0) {
			const nextIds: string[] = [];

			// Query in chunks to avoid SQLite variable limit
			for (let i = 0; i < currentIds.length; i += SQL_CHUNK_SIZE) {
				const chunk = currentIds.slice(i, i + SQL_CHUNK_SIZE);
				const results = this.database
					.select({
						id: nodeContent.id,
						name: nodeContent.name,
						parentId: nodeContent.parentId,
					})
					.from(nodeContent)
					.where(and(inArray(nodeContent.id, chunk), currentVersion(nodeContent)))
					.all();

				for (const row of results) {
					if (!nodeMap.has(row.id)) {
						nodeMap.set(row.id, {
							name: row.name,
							parentId: row.parentId,
						});

						if (row.parentId && !nodeMap.has(row.parentId)) {
							nextIds.push(row.parentId);
						}
					}
				}
			}

			currentIds = [...new Set(nextIds)];
		}

		const partsMap = new Map<string, string[]>();

		for (const nodeId of nodeIds) {
			const pathParts: string[] = [];
			let currentId: string | null = nodeId;

			while (currentId) {
				const info = nodeMap.get(currentId);
				if (!info) break;

				const name = stripHtmlTags(info.name || '');
				if (name) {
					pathParts.unshift(name);
				}

				currentId = info.parentId;
			}

			partsMap.set(nodeId, pathParts);
		}

		return partsMap;
	}

	/**
	 * Build full `' > '`-joined paths for multiple nodes.
	 */
	async buildFullPathsBatch(nodeIds: string[]): Promise<Map<string, string>> {
		const partsMap = await this.buildFullPathPartsBatch(nodeIds);
		const pathMap = new Map<string, string>();
		for (const [id, parts] of partsMap) {
			pathMap.set(id, parts.join(' > '));
		}
		return pathMap;
	}

	async buildTextContent(nodeId: string): Promise<string> {
		const contents = await this.buildTextContentBatch([nodeId]);
		return contents.get(nodeId) ?? '';
	}

	/**
	 * Build text content for multiple nodes using chunked queries to avoid SQLite variable limit.
	 */
	async buildTextContentBatch(nodeIds: string[]): Promise<Map<string, string>> {
		if (nodeIds.length === 0) {
			return new Map();
		}

		const contentMap = new Map<string, string>();

		// Query in chunks to avoid SQLite variable limit
		for (let i = 0; i < nodeIds.length; i += SQL_CHUNK_SIZE) {
			const chunk = nodeIds.slice(i, i + SQL_CHUNK_SIZE);
			const results = this.database
				.select({
					id: nodeContent.id,
					name: nodeContent.name,
					note: nodeContent.note,
				})
				.from(nodeContent)
				.where(and(inArray(nodeContent.id, chunk), currentVersion(nodeContent)))
				.all();

			for (const node of results) {
				const name = stripHtmlTags(node.name || '');
				const note = node.note ? stripHtmlTags(node.note) : '';
				contentMap.set(node.id, note ? `${name}\n\n${note}` : name);
			}
		}

		return contentMap;
	}

	/**
	 * Identify which nodes have children (are non-leaf nodes).
	 * Returns a Set of node IDs that have at least one child.
	 */
	async getNonLeafNodeIds(nodeIds: string[]): Promise<Set<string>> {
		if (nodeIds.length === 0) {
			return new Set();
		}

		const nonLeafIds = new Set<string>();

		// Query in chunks to avoid SQLite variable limit
		for (let i = 0; i < nodeIds.length; i += SQL_CHUNK_SIZE) {
			const chunk = nodeIds.slice(i, i + SQL_CHUNK_SIZE);
			// Find all nodes whose parentId is in our chunk
			const results = this.database
				.selectDistinct({
					parentId: nodeContent.parentId,
				})
				.from(nodeContent)
				.where(and(inArray(nodeContent.parentId, chunk), currentVersion(nodeContent)))
				.all();

			for (const row of results) {
				if (row.parentId) {
					nonLeafIds.add(row.parentId);
				}
			}
		}

		return nonLeafIds;
	}

	/**
	 * Build text content for direct children of multiple nodes.
	 * Returns a map of parent node ID to combined children text content.
	 * Only includes direct children (one level deep).
	 */
	async buildChildrenTextBatch(parentIds: string[]): Promise<Map<string, string>> {
		if (parentIds.length === 0) {
			return new Map();
		}

		const childrenMap = new Map<string, string[]>();

		// Query in chunks to avoid SQLite variable limit
		for (let i = 0; i < parentIds.length; i += SQL_CHUNK_SIZE) {
			const chunk = parentIds.slice(i, i + SQL_CHUNK_SIZE);
			const results = this.database
				.select({
					parentId: nodeContent.parentId,
					name: nodeContent.name,
					note: nodeContent.note,
				})
				.from(nodeContent)
				.where(and(inArray(nodeContent.parentId, chunk), currentVersion(nodeContent)))
				.all();

			for (const row of results) {
				if (!row.parentId) continue;

				const name = stripHtmlTags(row.name || '');
				const note = row.note ? stripHtmlTags(row.note) : '';
				const childText = note ? `${name}: ${note}` : name;

				if (!childrenMap.has(row.parentId)) {
					childrenMap.set(row.parentId, []);
				}
				childrenMap.get(row.parentId)!.push(childText);
			}
		}

		// Convert array of children texts to combined string
		const contentMap = new Map<string, string>();
		for (const [parentId, childTexts] of childrenMap) {
			contentMap.set(parentId, childTexts.join('\n'));
		}

		return contentMap;
	}
}
