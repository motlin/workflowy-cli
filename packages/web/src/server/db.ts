import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import * as schema from '@workflowy/shared/db';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {sqlLogger} from './sql-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDatabase() {
	if (dbInstance) {
		return dbInstance;
	}

	const dbPath = process.env.WORKFLOWY_DB_PATH || 'workflowy.sqlite';
	const sqlite = new Database(dbPath);

	sqliteVec.load(sqlite);

	if (!process.env.WORKFLOWY_DB_PATH) {
		sqlite.pragma('journal_mode = WAL');
	}

	dbInstance = drizzle(sqlite, {
		schema,
		logger: sqlLogger,
	});

	if (process.env.WORKFLOWY_SKIP_MIGRATIONS !== 'true') {
		const migrationsFolder = join(__dirname, '../../../shared/dist/db/migrations');
		migrate(dbInstance, {migrationsFolder});
	}

	if (process.env.WORKFLOWY_TEST_DISABLE_FK !== 'true') {
		sqlite.pragma('foreign_keys = ON');
	}

	return dbInstance;
}
