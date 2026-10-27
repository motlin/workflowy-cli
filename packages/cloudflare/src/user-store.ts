import {DurableObject} from "cloudflare:workers";
import * as schema from "@workflowy/shared/db";
import {
	LadderEventBus,
	bindTreeHost,
	buildServerContext,
	createApp,
	peekTreeSnapshotRows,
} from "@workflowy/web/server-app";
import {WorkflowyInternalClient} from "@workflowy/shared/api";
import {drizzle} from "drizzle-orm/durable-sqlite";
import {migrate} from "drizzle-orm/durable-sqlite/migrator";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {doMigrationConfig} from "./do-migrations";
import {kvSessionStore} from "./session-store";
import {SyncJob} from "./sync";
import type {SyncEnv, SyncStatus} from "./sync";
import {readWorkerConfig, readWorkerInternalAuth} from "./worker-config";
import type {WorkerSecrets} from "./worker-config";

/** One user's outline: a SQLite-backed Durable Object serving the shared Hono app over its own database. */
export class UserStore extends DurableObject<Env & WorkerSecrets & SyncEnv> {
	/** How many migrations this boot applied; zero when the database was already current. */
	protected appliedOnBoot = 0;
	/** Persists the Workflowy session cookie in this object's storage. */
	protected readonly sessionStore = kvSessionStore(this.ctx.storage.kv, this.env.WORKFLOWY_SESSION_COOKIE);
	/** Announces ladder writes; every accepted ladder socket receives each event. */
	protected readonly ladderEvents = new LadderEventBus();
	private sync!: SyncJob;
	private db!: ReturnType<typeof drizzle<typeof schema>>;
	private treeSnapshotEnabled = true;
	private app!: {fetch(request: Request): Response | Promise<Response>};

	constructor(ctx: DurableObjectState, env: Env & WorkerSecrets & SyncEnv) {
		super(ctx, env);
		// Rebuilt on every wake, so sockets that survived hibernation are fed again.
		this.ladderEvents.subscribe((event) => {
			const frame = this.ladderEvents.format(event);
			for (const socket of ctx.getWebSockets("ladder")) {
				try {
					socket.send(frame);
				} catch {
					// A socket that just closed must not stop the others.
				}
			}
		});
		void ctx.blockConcurrencyWhile(async () => {
			const db = drizzle(ctx.storage, {schema});
			this.db = db;
			this.treeSnapshotEnabled = readWorkerConfig(env).features.treeSnapshot;
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
				ladderEvents: this.ladderEvents,
				internalAuth: readWorkerInternalAuth(env, this.sessionStore),
			});
			this.app = createApp(serverContext);
			const internalAuth = readWorkerInternalAuth(env, this.sessionStore);
			this.sync = new SyncJob({
				storage: ctx.storage,
				db,
				env,
				readTreeData: internalAuth && (async () => new WorkflowyInternalClient(internalAuth).getTreeData()),
			});
		});
	}

	override webSocketClose(socket: WebSocket, code: number): void {
		// 1005 and 1006 are reserved and cannot be echoed back in a close frame.
		socket.close(code === 1005 || code === 1006 ? 1000 : code);
	}

	/** Start a sync run, or continue the one in progress, on the next alarm. */
	async syncNow(): Promise<SyncStatus> {
		return this.sync.syncNow();
	}

	async syncStatus(): Promise<SyncStatus> {
		return this.sync.status();
	}

	/** Database size, live node count, the last sync result and whether the in-memory tree snapshot is held. */
	async adminStatus(): Promise<AdminStatus> {
		const count = this.ctx.storage.sql
			.exec("SELECT count(*) AS n FROM node_content WHERE system_to = ?", FAR_FUTURE_DATE)
			.one().n;
		return {
			databaseSize: this.ctx.storage.sql.databaseSize,
			nodeCount: Number(count),
			lastSync: (await this.sync.status()).lastResult,
			snapshot: {enabled: this.treeSnapshotEnabled, warm: peekTreeSnapshotRows(this.db) !== undefined},
		};
	}

	/** GET lists the durable local settings; PUT upserts a JSON array of `{key, json, updatedAt}` rows by key. */
	private async localSettingsRoute(request: Request): Promise<Response> {
		if (request.method === "GET") {
			return Response.json(this.db.select().from(schema.localSettings).orderBy(schema.localSettings.key).all());
		}
		if (request.method !== "PUT") {
			return new Response("Method not allowed", {status: 405});
		}
		const body: unknown = await request.json().catch(() => {});
		const rows = Array.isArray(body) ? body.map(parseLocalSettingRow) : undefined;
		if (!rows || rows.some((row) => row === undefined)) {
			return new Response("Expected a JSON array of {key, json, updatedAt} rows", {status: 400});
		}
		this.db.transaction((tx) => {
			for (const row of rows) {
				if (row) {
					tx.insert(schema.localSettings)
						.values(row)
						.onConflictDoUpdate({
							target: schema.localSettings.key,
							set: {json: row.json, updatedAt: row.updatedAt},
						})
						.run();
				}
			}
		});
		return Response.json({upserted: rows.length});
	}

	override async alarm(): Promise<void> {
		await this.sync.tick();
	}

	override async fetch(request: Request): Promise<Response> {
		if (new URL(request.url).pathname === "/api/admin/status") {
			return request.method === "GET"
				? Response.json(await this.adminStatus())
				: new Response("Method not allowed", {status: 405});
		}
		if (new URL(request.url).pathname === "/api/admin/local-settings") {
			return this.localSettingsRoute(request);
		}
		if (new URL(request.url).pathname === "/api/admin/sync") {
			if (request.method === "POST") {
				return Response.json(await this.syncNow(), {status: 202});
			}
			if (request.method === "GET") {
				return Response.json(await this.syncStatus());
			}
			return new Response("Method not allowed", {status: 405});
		}
		if (new URL(request.url).pathname === "/api/v1/ladder/events") {
			if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
				return new Response("Expected a WebSocket upgrade", {status: 426});
			}
			const pair = new WebSocketPair();
			this.ctx.acceptWebSocket(pair[1], ["ladder"]);
			return new Response(null, {status: 101, webSocket: pair[0]});
		}
		return this.app.fetch(request);
	}
}

export interface AdminStatus {
	databaseSize: number;
	nodeCount: number;
	lastSync: SyncStatus["lastResult"];
	snapshot: {enabled: boolean; warm: boolean};
}

function parseLocalSettingRow(value: unknown): {key: string; json: string; updatedAt: number} | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	if (!("key" in value && "json" in value && "updatedAt" in value)) {
		return undefined;
	}
	const {key, json, updatedAt} = value;
	return typeof key === "string" && typeof json === "string" && typeof updatedAt === "number"
		? {key, json, updatedAt}
		: undefined;
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
