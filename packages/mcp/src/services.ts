import {WorkflowyApiClient} from '@workflowy/shared/api';
import {CacheService, WorkflowyWriteThroughClient} from '@workflowy/shared/cache';
import * as schema from '@workflowy/shared/db';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import DatabaseConstructor from 'better-sqlite3';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let _database: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _apiClient: WorkflowyApiClient | null = null;
let _cacheService: CacheService | null = null;
let _writeThroughClient: WorkflowyWriteThroughClient | null = null;

export function getDatabase(): ReturnType<typeof drizzle<typeof schema>> {
	if (!_database) {
		const dbPath = process.env.WORKFLOWY_DB_PATH || 'workflowy.sqlite';
		const sqlite = new DatabaseConstructor(dbPath);

		if (!process.env.WORKFLOWY_DB_PATH) {
			sqlite.pragma('journal_mode = WAL');
		}

		_database = drizzle(sqlite, {schema});

		if (process.env.WORKFLOWY_SKIP_MIGRATIONS !== 'true') {
			const migrationsFolder = join(__dirname, '../../shared/dist/db/migrations');
			migrate(_database, {migrationsFolder});
		}

		sqlite.pragma('foreign_keys = ON');
	}
	return _database;
}

export function getApiClient(): WorkflowyApiClient {
	if (!_apiClient) {
		const apiKey = process.env.WORKFLOWY_API_KEY;
		if (!apiKey) {
			throw new Error('WORKFLOWY_API_KEY environment variable is required');
		}
		_apiClient = new WorkflowyApiClient(apiKey, undefined, process.env.WORKFLOWY_API_URL);
	}
	return _apiClient;
}

export function getCacheService(): CacheService {
	if (!_cacheService) {
		_cacheService = new CacheService(getDatabase());
	}
	return _cacheService;
}

export function getWriteThroughClient(): WorkflowyWriteThroughClient {
	if (!_writeThroughClient) {
		_writeThroughClient = new WorkflowyWriteThroughClient(getApiClient(), getCacheService());
	}
	return _writeThroughClient;
}
