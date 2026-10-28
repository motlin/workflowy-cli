import {Hono} from "hono";
import {cors} from "hono/cors";
import type {z} from "zod";
import {apiCompression} from "../compression.js";
import type {Json, OpResult} from "../ops/define.js";
import type {StoreClient} from "../store.js";

export interface HttpAppOptions {
	resolveStore: (request: Request) => StoreClient | Promise<StoreClient>;
	/** Browser origin allowed by CORS (the Vite dev server); omitted when the page is served same-origin. */
	corsOrigin?: string;
}

/** Builds the Response for an op result: 204 for null, 304, 302, ETag and Server-Timing, or the error body. */
export function toResponse(result: OpResult<unknown>): Response {
	if (!result.ok) {
		return Response.json(result.body, {status: result.status});
	}
	const {meta} = result;
	const headers = new Headers();
	if (meta?.etag !== undefined) {
		headers.set("ETag", meta.etag);
	}
	if (meta?.timing !== undefined && meta.timing.length > 0) {
		headers.set("Server-Timing", meta.timing.join(", "));
	}
	if (meta?.redirect !== undefined) {
		headers.set("Location", meta.redirect);
		return new Response(null, {status: 302, headers});
	}
	if (meta?.notModified === true) {
		return new Response(null, {status: 304, headers});
	}
	if (result.value === null) {
		return new Response(null, {status: 204, headers});
	}
	return Response.json(result.value, {headers});
}

/** Validates raw request data with an op's schema; a miss is a 400 carrying `errorBody` verbatim. */
export function parseInput<S extends z.ZodType>(
	schema: S,
	raw: unknown,
	errorBody: Json,
): {ok: true; value: z.output<S>} | {ok: false; status: 400; body: Json} {
	const parsed = schema.safeParse(raw);
	return parsed.success ? {ok: true, value: parsed.data} : {ok: false, status: 400, body: errorBody};
}

/** The Worker's (and Node's) HTTP layer: routing, validation and response building over a {@link StoreClient}. */
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
	app.get("/api/v1/account", async (c) => {
		const store = await options.resolveStore(c.req.raw);
		return toResponse(await store.call("account.get", {}));
	});
	return app;
}
