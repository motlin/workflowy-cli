import {Hono} from "hono";
import {cors} from "hono/cors";
import {apiCompression} from "../compression.js";
import {accountRoutes} from "./routes/account.js";
import {changesRoutes} from "./routes/changes.js";
import {customTreeRoutes} from "./routes/custom-tree.js";
import {expansionRoutes} from "./routes/expansion.js";
import {featuresRoutes} from "./routes/features.js";
import {preferencesRoutes} from "./routes/preferences.js";
import {starsRoutes} from "./routes/stars.js";
import {tagIndexRoutes} from "./routes/tag-index.js";
import {tagsRoutes} from "./routes/tags.js";
import type {ResolveStore} from "./response.js";

export {parseInput, toResponse} from "./response.js";
export type {ResolveStore} from "./response.js";

export interface HttpAppOptions {
	resolveStore: ResolveStore;
	/** Browser origin allowed by CORS (the Vite dev server); omitted when the page is served same-origin. */
	corsOrigin?: string;
}

/** Every migrated route, without middleware, so a host can mount them inside an app that already has its own. */
export function createHttpRoutes(resolveStore: ResolveStore): Hono {
	const routes = new Hono();
	routes.route("/api/v1/account", accountRoutes(resolveStore));
	routes.route("/api/v1/features", featuresRoutes(resolveStore));
	routes.route("/api/v1/custom-tree", customTreeRoutes(resolveStore));
	routes.route("/api/changes", changesRoutes(resolveStore));
	routes.route("/api/v1/tags/autocomplete", tagIndexRoutes(resolveStore));
	routes.route("/api/v1/tags", tagsRoutes(resolveStore));
	routes.route("/api/v1/expansion", expansionRoutes(resolveStore));
	routes.route("/api/v1/stars", starsRoutes(resolveStore));
	routes.route("/api/v1/preferences", preferencesRoutes(resolveStore));
	return routes;
}

/** The Worker's HTTP layer: routing, validation and response building over a {@link StoreClient}. */
export function createHttpApp(options: HttpAppOptions): Hono {
	const app = new Hono();
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
	app.use("/api/*", apiCompression());
	app.get("/health", (c) => c.json({status: "ok"}));
	app.route("/", createHttpRoutes(options.resolveStore));
	return app;
}
