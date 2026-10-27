import {DurableObject} from "cloudflare:workers";
import * as schema from "@workflowy/shared/db";
import {LadderEventBus, bindTreeHost, buildServerContext, createApp} from "@workflowy/web/server-app";
import {drizzle} from "drizzle-orm/durable-sqlite";
import {migrate} from "drizzle-orm/durable-sqlite/migrator";
import {doMigrationConfig} from "./do-migrations";
import {kvSessionStore} from "./session-store";
import {readWorkerConfig, readWorkerInternalAuth} from "./worker-config";
import type {WorkerSecrets} from "./worker-config";

/** One user's outline: a SQLite-backed Durable Object serving the shared Hono app over its own database. */
export class UserStore extends DurableObject<Env & WorkerSecrets> {
	/** How many migrations this boot applied; zero when the database was already current. */
	protected appliedOnBoot = 0;
	/** Persists the Workflowy session cookie in this object's storage. */
	protected readonly sessionStore = kvSessionStore(this.ctx.storage.kv, this.env.WORKFLOWY_SESSION_COOKIE);
	private app!: {fetch(request: Request): Response | Promise<Response>};

	constructor(ctx: DurableObjectState, env: Env & WorkerSecrets) {
		super(ctx, env);
		void ctx.blockConcurrencyWhile(async () => {
			const db = drizzle(ctx.storage, {schema});
			const before = countApplied(ctx);
			await migrate(db, doMigrationConfig);
			this.appliedOnBoot = countApplied(ctx) - before;
			bindTreeHost(db, {
				// Only this object writes its database, so no other connection can bump the version.
				changeSource: {dataVersion: () => "durable-object", isOpen: () => true},
				scheduler: {
					setTimer(run, delayMs) {
						const timer = setTimeout(run, delayMs);
						return () => {
							clearTimeout(timer);
						};
					},
				},
			});
			const serverContext = buildServerContext({
				db,
				config: readWorkerConfig(env),
				ladderEvents: new LadderEventBus(),
				internalAuth: readWorkerInternalAuth(env, this.sessionStore),
			});
			this.app = createApp(serverContext);
		});
	}

	override async fetch(request: Request): Promise<Response> {
		return this.app.fetch(request);
	}
}

function countApplied(ctx: DurableObjectState): number {
	const table = ctx.storage.sql
		.exec("SELECT count(*) AS n FROM sqlite_master WHERE name = '__drizzle_migrations'")
		.one().n;
	if (Number(table) === 0) {
		return 0;
	}
	return Number(ctx.storage.sql.exec("SELECT count(*) AS n FROM __drizzle_migrations").one().n);
}
