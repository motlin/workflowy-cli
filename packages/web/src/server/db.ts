import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import * as schema from "@workflowy/shared/db";
import {join} from "node:path";
import {createSqlLogger} from "./sql-logger.js";

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDatabase() {
	if (dbInstance) {
		return dbInstance;
	}

	const dbPath = (process.env.WORKFLOWY_DB_PATH ?? "") || "workflowy.sqlite";
	const sqlite = new Database(dbPath);

	sqliteVec.load(sqlite);

	if (!process.env.WORKFLOWY_DB_PATH) {
		sqlite.pragma("journal_mode = WAL");
	}

	dbInstance = drizzle(sqlite, {
		schema,
		logger: createSqlLogger(process.env.WORKFLOWY_SQL_QUERY_LOGGING === "true"),
	});

	if (process.env.WORKFLOWY_SKIP_MIGRATIONS !== "true") {
		const migrationsFolder = join(import.meta.dirname, "../../../shared/dist/db/migrations");
		migrate(dbInstance, {migrationsFolder});
	}

	if (process.env.WORKFLOWY_TEST_DISABLE_FK !== "true") {
		sqlite.pragma("foreign_keys = ON");
	}

	return dbInstance;
}
