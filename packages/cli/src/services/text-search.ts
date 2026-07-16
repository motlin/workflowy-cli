import {CacheService, type TextSearchOptions} from '@workflowy/shared/cache';
import * as schema from '@workflowy/shared/db';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {logger} from './logger.js';
import {PathBuilder} from './path-builder.js';

export type {TextSearchOptions};

export type TextSearchResult = {
	shortId: string | null;
	name: string | null;
	note: string | null;
	path: string;
};

export class TextSearchService {
	private cacheService: CacheService;
	private pathBuilder: PathBuilder;

	constructor(database: BetterSQLite3Database<typeof schema>) {
		this.cacheService = new CacheService(database);
		this.pathBuilder = new PathBuilder(database);
	}

	async search(options: TextSearchOptions): Promise<TextSearchResult[]> {
		const rows = await this.cacheService.searchText(options);
		logger.logSqlResult('textSearch', rows);

		if (rows.length === 0) {
			return [];
		}

		const pathMap = await this.pathBuilder.buildFullPathsBatch(rows.map((r) => r.id));

		return rows.map((row) => ({
			shortId: row.shortId,
			name: row.name,
			note: row.note,
			path: pathMap.get(row.id) ?? '',
		}));
	}
}
