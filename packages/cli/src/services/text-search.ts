import {nodeContent, nodeMetadata} from '@workflowy/shared/db';
import * as schema from '@workflowy/shared/db';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import {and, eq, isNull, like, or} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {logger} from './logger.js';
import {PathBuilder} from './path-builder.js';

export type TextSearchOptions = {
	query: string;
	limit?: number;
	incomplete?: boolean;
};

export type TextSearchResult = {
	shortId: string | null;
	name: string | null;
	note: string | null;
	path: string;
};

export class TextSearchService {
	private database: BetterSQLite3Database<typeof schema>;
	private pathBuilder: PathBuilder;

	constructor(database: BetterSQLite3Database<typeof schema>) {
		this.database = database;
		this.pathBuilder = new PathBuilder(database);
	}

	async search(options: TextSearchOptions): Promise<TextSearchResult[]> {
		const {query, limit = 20, incomplete = false} = options;

		const pattern = `%${query}%`;

		const conditions = [
			eq(nodeContent.systemTo, FAR_FUTURE_DATE),
			or(like(nodeContent.name, pattern), like(nodeContent.note, pattern)),
		];

		if (incomplete) {
			conditions.push(isNull(nodeMetadata.completedAt));
		}

		const results = this.database
			.select({
				id: nodeContent.id,
				name: nodeContent.name,
				note: nodeContent.note,
				shortId: nodeMetadata.shortId,
			})
			.from(nodeContent)
			.innerJoin(
				nodeMetadata,
				and(eq(nodeContent.id, nodeMetadata.nodeId), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)),
			)
			.where(and(...conditions))
			.limit(limit)
			.all();
		logger.logSqlResult('textSearch', results);

		if (results.length === 0) {
			return [];
		}

		const nodeIds = results.map((r) => r.id);
		const pathMap = await this.pathBuilder.buildFullPathsBatch(nodeIds);

		return results.map((result) => ({
			shortId: result.shortId,
			name: result.name,
			note: result.note,
			path: pathMap.get(result.id) ?? '',
		}));
	}
}
