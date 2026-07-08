import {nodeContent, nodeMetadata} from '@workflowy/shared/db';
import * as schema from '@workflowy/shared/db';
import {NodeReader} from '@workflowy/shared/cache';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import type {Node} from '@workflowy/shared/types';
import {and, asc, eq, isNotNull} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {logger} from './logger.js';

export class QueryHelpers {
	private database: BetterSQLite3Database<typeof schema>;
	private nodeReader: NodeReader;

	constructor(database: BetterSQLite3Database<typeof schema>) {
		this.database = database;
		this.nodeReader = new NodeReader(database);
	}

	/**
	 * Fetch a single node by ID
	 */
	async getNodeById(id: string): Promise<Node | undefined> {
		const result = this.nodeReader.getById(id) ?? undefined;
		logger.logSqlResult('getNodeById', result);
		return result;
	}

	/**
	 * Fetch children of a node ordered by priority, then createdAt
	 */
	async getChildren(parentId: string | null): Promise<Node[]> {
		const results = this.nodeReader.getChildren(parentId);
		logger.logSqlResult('getChildren', results);
		return results;
	}

	/**
	 * Find all nodes that have been completed
	 */
	async getCompletedTasks(): Promise<Node[]> {
		const completedRows = this.database
			.select({id: nodeMetadata.nodeId})
			.from(nodeContent)
			.innerJoin(
				nodeMetadata,
				and(eq(nodeContent.id, nodeMetadata.nodeId), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)),
			)
			.where(and(isNotNull(nodeMetadata.completedAt), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
			.orderBy(asc(nodeMetadata.completedAt))
			.all();
		const nodesById = this.nodeReader.getMany(completedRows.map((row) => row.id));
		const results = completedRows
			.map((row) => nodesById.get(row.id))
			.filter((node): node is Node => node !== undefined);
		logger.logSqlResult('getCompletedTasks', results);
		return results;
	}

	/**
	 * Traverse a path from root to find a specific node
	 * @param path Array of node names to traverse (e.g., ['Work', 'Journal', 'Archive'])
	 * @param rootId Optional root node ID to start from (null for absolute root)
	 */
	async findNodeByPath(path: string[], rootId: string | null = null): Promise<Node | undefined> {
		if (path.length === 0) {
			if (rootId) {
				return this.getNodeById(rootId);
			}
			return undefined;
		}

		let currentParentId = rootId;

		for (const segment of path) {
			const children = await this.getChildren(currentParentId);
			logger.logSqlResult('findNodeByPath.children', children);

			// Using 'includes' because names might contain HTML tags
			const matchingChild = children.find((child) => child.name && child.name.includes(segment));

			if (!matchingChild) {
				return undefined;
			}

			if (segment === path.at(-1)) {
				return matchingChild;
			}

			currentParentId = matchingChild.id;
		}

		return undefined;
	}
}
