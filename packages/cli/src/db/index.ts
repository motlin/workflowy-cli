import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import DatabaseConstructor from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import * as schema from '@workflowy/shared/db';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {sqlLogger} from '../services/sql-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createDatabase(dbPath?: string) {
	const actualPath = dbPath || process.env.WORKFLOWY_DB_PATH || 'workflowy.sqlite';
	const sqlite = new DatabaseConstructor(actualPath);

	sqliteVec.load(sqlite);

	if (!process.env.WORKFLOWY_DB_PATH) {
		sqlite.pragma('journal_mode = WAL');
	}

	const db = drizzle(sqlite, {
		schema,
		logger: sqlLogger,
	});

	if (process.env.WORKFLOWY_SKIP_MIGRATIONS !== 'true') {
		const migrationsFolder = join(__dirname, '../../../shared/dist/db/migrations');
		migrate(db, {migrationsFolder});
	}

	if (process.env.WORKFLOWY_TEST_DISABLE_FK !== 'true') {
		sqlite.pragma('foreign_keys = ON');
	}

	return db;
}
