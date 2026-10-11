import {WorkflowyApiClient} from "@workflowy/shared/api";
import {CacheService, WorkflowyWriteThroughClient} from "@workflowy/shared/cache";
import * as schema from "@workflowy/shared/db";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import DatabaseConstructor from "better-sqlite3";
import {join} from "node:path";

let database: ReturnType<typeof drizzle<typeof schema>> | null = null;
let apiClient: WorkflowyApiClient | null = null;
let cacheService: CacheService | null = null;
let writeThroughClient: WorkflowyWriteThroughClient | null = null;

export function getDatabase(): ReturnType<typeof drizzle<typeof schema>> {
	if (!database) {
		const dbPath = process.env.WORKFLOWY_DB_PATH || "workflowy.sqlite";
		const sqlite = new DatabaseConstructor(dbPath);

		if (!process.env.WORKFLOWY_DB_PATH) {
			sqlite.pragma("journal_mode = WAL");
		}

		database = drizzle(sqlite, {schema});

		if (process.env.WORKFLOWY_SKIP_MIGRATIONS !== "true") {
			const migrationsFolder = join(import.meta.dirname, "../../shared/dist/db/migrations");
			migrate(database, {migrationsFolder});
		}

		sqlite.pragma("foreign_keys = ON");
	}
	return database;
}

export function getApiClient(): WorkflowyApiClient {
	if (!apiClient) {
		const apiKey = process.env.WORKFLOWY_API_KEY;
		if (!apiKey) {
			throw new Error("WORKFLOWY_API_KEY environment variable is required");
		}
		apiClient = new WorkflowyApiClient(apiKey, undefined, process.env.WORKFLOWY_API_URL);
	}
	return apiClient;
}

export function getCacheService(): CacheService {
	if (!cacheService) {
		cacheService = new CacheService(getDatabase());
	}
	return cacheService;
}

export function getWriteThroughClient(): WorkflowyWriteThroughClient {
	if (!writeThroughClient) {
		writeThroughClient = new WorkflowyWriteThroughClient(getApiClient(), getCacheService());
	}
	return writeThroughClient;
}
