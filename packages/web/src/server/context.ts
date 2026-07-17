import {CacheService} from '@workflowy/shared/cache';
import {getDatabase} from './db.js';

type ServerDatabase = ReturnType<typeof getDatabase>;

/**
 * The server's composition root: the dependencies a router needs, assembled in
 * one place and handed to the routers instead of each handler reaching for the
 * `getDatabase()` singleton and `process.env`. A test builds one over an
 * in-memory database and drives `app.fetch(...)` with no disk, network, or env.
 */
export interface ServerContext {
	db: ServerDatabase;
	cacheService: CacheService;
	/** The Workflowy API key, or undefined when write operations are unavailable. */
	apiKey?: string;
}

/** Hono environment: routers read the {@link ServerContext} via `c.get('ctx')`. */
export type AppEnv = {Variables: {ctx: ServerContext}};

/**
 * Build a {@link ServerContext} from the process database singleton and
 * environment. Tests bypass this and construct a context directly.
 */
export function createServerContext(): ServerContext {
	const db = getDatabase();
	return {
		db,
		cacheService: new CacheService(db),
		apiKey: process.env.WORKFLOWY_API_KEY,
	};
}
