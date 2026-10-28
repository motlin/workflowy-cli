import {Hono} from "hono";
import type {AppEnv, ServerContext} from "./context.js";
import {createDecisionsRouter} from "./routes/decisions.js";

/**
 * The host-neutral Hono app for what the ops layer does not own: the context middleware, decision pages and the health check.
 * It touches no Node-only module, so a Worker or Durable Object can serve it.
 */
export function createApp(ctx: ServerContext): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	app.use("/*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});

	app.route("/api/v1/decisions", createDecisionsRouter());

	app.get("/health", (c) => c.json({status: "ok"}));

	return app;
}

// The host-neutral pieces a Worker or Durable Object needs to assemble its own context.
export {buildServerContext} from "./context.js";
export type {ServerContext, ServerContextDeps} from "./context.js";
export type {ServerConfig} from "./config.js";
export {LadderEventBus} from "./ladder-events.js";
export {bindTreeHost, peekTreeSnapshotRows} from "./tree-snapshot.js";
export {createHttpApp} from "./http/app.js";
export type {HttpAppOptions} from "./http/app.js";
export {inProcessStore} from "./store.js";
export type {StoreClient} from "./store.js";
export type {OpName, OpInput, OpOutput} from "./ops/index.js";
export type {OpResult} from "./ops/define.js";
