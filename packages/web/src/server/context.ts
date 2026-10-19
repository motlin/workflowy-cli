import {WorkflowyApiClient, WorkflowyInternalClient} from "@workflowy/shared/api";
import type {InternalAuth} from "@workflowy/shared/api";
import {CacheService, WorkflowyWriteThroughClient} from "@workflowy/shared/cache";
import {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import {readInternalAuth} from "@workflowy/shared/node";
import {getDatabase} from "./db.js";

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
	/** Internal-API auth (saved session cookie and/or login), or undefined when internal-API routes are unavailable. */
	internalAuth?: InternalAuth;
	/**
	 * The internal-API adapter, built on first call and shared afterwards, or
	 * undefined when internal-API auth is not configured.
	 */
	internalAdapter?: () => WorkflowyInternalAdapter | undefined;
	/**
	 * Whether `POST /api/v1/calendar/day/:dateId/ensure` may create day nodes
	 * (`CALENDAR_ENSURE_ENABLED`); see the M2-74 calendar-adopt probe.
	 */
	calendarEnsureEnabled?: boolean;
}

/** Hono environment: routers read the {@link ServerContext} via `c.get('ctx')`. */
export interface AppEnv {
	Variables: {ctx: ServerContext};
}

/**
 * Build a {@link ServerContext} from the process database singleton and
 * environment. Tests bypass this and construct a context directly.
 */
export function createServerContext(): ServerContext {
	const db = getDatabase();
	const cacheService = new CacheService(db);
	const apiKey = process.env.WORKFLOWY_API_KEY;
	const internalAuth = readInternalAuth();
	let adapter: WorkflowyInternalAdapter | undefined;
	return {
		db,
		cacheService,
		apiKey,
		internalAuth,
		calendarEnsureEnabled: process.env.CALENDAR_ENSURE_ENABLED === "true",
		internalAdapter: () => {
			if (!adapter && internalAuth) {
				adapter = new WorkflowyInternalAdapter({
					client: new WorkflowyInternalClient(internalAuth),
					db,
					// Tree writes refresh the cache through the public API, which needs the key.
					writeThrough: apiKey
						? new WorkflowyWriteThroughClient(
								new WorkflowyApiClient(apiKey, undefined, process.env.WORKFLOWY_API_URL),
								cacheService,
							)
						: undefined,
				});
			}
			return adapter;
		},
	};
}
