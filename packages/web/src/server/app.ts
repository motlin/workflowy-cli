import {Hono} from "hono";
import {cors} from "hono/cors";
import {apiCompression} from "./compression.js";
import type {AppEnv, ServerContext} from "./context.js";
import {changesRouter} from "./routes/changes.js";
import {createAccountRouter} from "./routes/account.js";
import {createCalendarRouter} from "./routes/calendar.js";
import {createFilesRouter} from "./routes/files.js";
import {createExpansionRouter} from "./routes/expansion.js";
import {createLadderRouter} from "./routes/ladder.js";
import {homeRouter, nodesRouter} from "./routes/nodes.js";
import {createFeaturesRouter} from "./routes/features.js";
import {createPreferencesRouter} from "./routes/preferences.js";
import {relatedRouter} from "./routes/related.js";
import {searchRouter} from "./routes/search.js";
import {createStarsRouter} from "./routes/stars.js";
import {createTagIndexRouter} from "./routes/tag-index.js";
import {createDecisionsRouter} from "./routes/decisions.js";
import {createCustomTreeRouter} from "./routes/custom-tree.js";
import {createTagsRouter} from "./routes/tags.js";
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
	app.route("/api/changes", changesRouter);
	app.route("/api/v1/nodes", nodesRouter);
	app.route("/api/v1/home", homeRouter);
	app.route("/api/v1/tags/autocomplete", createTagIndexRouter());
	app.route("/api/v1/tags", createTagsRouter());
	app.route("/api/v1/custom-tree", createCustomTreeRouter());
	app.route("/api/v1/ladder", createLadderRouter());
	app.route("/api/v1/decisions", createDecisionsRouter());
	app.route("/api/v1/expansion", createExpansionRouter());
	app.route("/api/v1/calendar", createCalendarRouter());
	app.route("/api/v1/stars", createStarsRouter());
	app.route("/api/v1/preferences", createPreferencesRouter());
	app.route("/api/v1/features", createFeaturesRouter());
	app.route("/api/v1/account", createAccountRouter());
	app.route("/api/v1/files", createFilesRouter());
	app.route("/api/search", searchRouter);
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
export {createHttpApp} from "./http/app.js";
export type {HttpAppOptions} from "./http/app.js";
export {inProcessStore} from "./store.js";
export type {StoreClient} from "./store.js";
export type {OpName, OpInput, OpOutput} from "./ops/index.js";
export type {OpResult} from "./ops/define.js";
