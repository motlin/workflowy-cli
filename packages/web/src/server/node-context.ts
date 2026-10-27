import {WorkflowyApiClient, WorkflowyInternalClient} from "@workflowy/shared/api";
import {CacheService, WorkflowyWriteThroughClient} from "@workflowy/shared/cache";
import {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import {readInternalAuth} from "@workflowy/shared/node";
import {readNodeConfig} from "./config.js";
import type {ServerContext} from "./context.js";
import {getDatabase} from "./db.js";

/**
 * Build a {@link ServerContext} from the process database singleton and
 * environment (the Node host). Tests bypass this and construct a context directly.
 */
export function createServerContext(): ServerContext {
	const config = readNodeConfig(process.env);
	const db = getDatabase();
	const cacheService = new CacheService(db);
	const apiKey = config.apiKey;
	const internalAuth = readInternalAuth();
	let adapter: WorkflowyInternalAdapter | undefined;
	return {
		db,
		cacheService,
		config,
		apiKey,
		internalAuth,
		calendarEnsureEnabled: config.calendarEnsureEnabled,
		calendarLayoutEnabled: config.calendarLayoutEnabled,
		internalAdapter: () => {
			if (!adapter && internalAuth) {
				adapter = new WorkflowyInternalAdapter({
					client: new WorkflowyInternalClient(internalAuth),
					db,
					// Tree writes refresh the cache through the public API, which needs the key.
					writeThrough: apiKey
						? new WorkflowyWriteThroughClient(
								new WorkflowyApiClient(apiKey, undefined, config.apiUrl),
								cacheService,
							)
						: undefined,
				});
			}
			return adapter;
		},
	};
}
