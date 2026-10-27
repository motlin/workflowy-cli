import type {InternalAuth} from "@workflowy/shared/api";
import type {CacheService} from "@workflowy/shared/cache";
import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import type {getDatabase} from "./db.js";
import type {ServerConfig} from "./config.js";

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
	/** Settings parsed by the host; routers read these instead of `process.env`. */
	config: ServerConfig;
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
	 * (`CALENDAR_ENSURE_ENABLED`, on unless `false`): the M2-74 calendar-adopt
	 * probe confirmed workflowy.com adopts ensured day nodes.
	 */
	calendarEnsureEnabled?: boolean;
	/**
	 * Whether `PUT /api/v1/calendar/layout` may restructure the calendar
	 * (`CALENDAR_LAYOUT_ENABLED`, on unless `false`): it moves, creates and
	 * deletes level nodes account-wide, behind a confirm dialog and a one-shot Undo.
	 */
	calendarLayoutEnabled?: boolean;
}

/** Hono environment: routers read the {@link ServerContext} via `c.get('ctx')`. */
export interface AppEnv {
	Variables: {ctx: ServerContext};
}
