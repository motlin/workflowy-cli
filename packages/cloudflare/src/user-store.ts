import {DurableObject} from "cloudflare:workers";
import * as schema from "@workflowy/shared/db";
import {LadderEventBus, bindTreeHost, buildServerContext, createApp} from "@workflowy/web/server-app";
import type {ServerConfig} from "@workflowy/web/server-app";
import {drizzle} from "drizzle-orm/durable-sqlite";
import {migrate} from "drizzle-orm/durable-sqlite/migrator";
import {doMigrationConfig} from "./do-migrations";

/** Config for a DO with no secrets configured: writes unavailable, embeddings off. */
const defaultConfig: ServerConfig = {
	accountEmail: "",
	sqlQueryLogging: false,
	calendarEnsureEnabled: true,
	calendarLayoutEnabled: true,
	features: {embeddings: false, treeSnapshot: true},
};

/** One user's outline: a SQLite-backed Durable Object serving the shared Hono app over its own database. */
export class UserStore extends DurableObject<Env> {
	/** How many migrations this boot applied; zero when the database was already current. */
	protected appliedOnBoot = 0;
	private app!: {fetch(request: Request): Response | Promise<Response>};

	constructor(ctx: DurableObjectState, env: Env) {
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
				config: defaultConfig,
				ladderEvents: new LadderEventBus(),
				internalAuth: undefined,
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
