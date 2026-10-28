import {Hono} from "hono";
import {cors} from "hono/cors";
import {apiCompression} from "./compression.js";
import type {AppEnv, ServerContext} from "./context.js";
import {homeRouter, nodesRouter} from "./routes/nodes.js";
import {relatedRouter} from "./routes/related.js";
import {createDecisionsRouter} from "./routes/decisions.js";
import {rebuildTreeSnapshotAfterWrites} from "./tree-snapshot.js";

export interface AppOptions {
	/** Browser origin allowed by CORS (the Vite dev server); omitted when the page is served same-origin. */
	corsOrigin?: string;
}

/**
 * The host-neutral Hono app: every router, the context middleware and the health check.
 * It touches no Node-only module, so a Worker or Durable Object can serve it.
 */
export function createApp(ctx: ServerContext, options: AppOptions = {}): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	if (options.corsOrigin !== undefined) {
		app.use(
			"/*",
			cors({
				origin: options.corsOrigin,
				allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
				allowHeaders: ["Content-Type", "Authorization"],
			}),
		);
	}

	app.use("/*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});

	app.use("/api/*", apiCompression());

	// Rebuild the search tree snapshot in the background after each write, so searches rarely wait on the ~800ms reload.
	if (ctx.config.features.treeSnapshot) {
		app.use(
			"/api/*",
			rebuildTreeSnapshotAfterWrites(() => ctx.db),
		);
	}

	// Mount API routes
	app.route("/api/v1/nodes", nodesRouter);
	app.route("/api/v1/home", homeRouter);
	app.route("/api/v1/decisions", createDecisionsRouter());
	app.route("/api/related", relatedRouter);

	app.get("/health", (c) => c.json({status: "ok"}));

	return app;
}

// The host-neutral pieces a Worker or Durable Object needs to assemble its own context.
export {buildServerContext} from "./context.js";
export type {ServerContext, ServerContextDeps} from "./context.js";
export type {ServerConfig} from "./config.js";
export {LadderEventBus} from "./ladder-events.js";
export {bindTreeHost, peekTreeSnapshotRows, withTreeSnapshotRebuild} from "./tree-snapshot.js";
export {createHttpApp, createHttpRoutes} from "./http/app.js";
export type {HttpAppOptions} from "./http/app.js";
export {inProcessStore} from "./store.js";
export type {StoreClient} from "./store.js";
export type {OpName, OpInput, OpOutput} from "./ops/index.js";
export type {OpResult} from "./ops/define.js";
