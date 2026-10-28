import {createHttpApp} from "@workflowy/web/server-app";
import type {StoreClient} from "@workflowy/web/server-app";
import {Hono} from "hono";
import {createMiddleware} from "hono/factory";
import {resolveIdentity} from "./access";
import type {AccessEnv} from "./access";
import {storeClient} from "./store-client";
import type {UserStore} from "./user-store";

export {UserStore} from "./user-store";

/**
 * `createHttpApp` compresses API responses in this Worker. Without `encodeBody: "manual"` the runtime assumes a response's body is plain and
 * encodes it again to match `Content-Encoding`, so browsers decode one layer and read gzip bytes as JSON.
 */
function passEncodedBody(response: Response): Response {
	if (!response.headers.has("content-encoding") || response.webSocket) {
		return response;
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
		encodeBody: "manual",
	});
}

type WorkerEnv = Env & AccessEnv;
interface WorkerApp {
	Bindings: WorkerEnv;
	Variables: {stub: DurableObjectStub<UserStore>};
}

const app = new Hono<WorkerApp>();
/** The store for the request being served; `createHttpApp` asks for it by the raw request. */
const stores = new WeakMap<Request, StoreClient>();

app.use("*", async (c, next) => {
	await next();
	c.res = passEncodedBody(c.res);
});

// Access gates everything dynamic; the identity names the user's Durable Object.
const identity = createMiddleware<WorkerApp>(async (c, next) => {
	const result = await resolveIdentity(c.req.raw, c.env);
	if ("status" in result) {
		return new Response(result.status === 401 ? "Unauthorized" : "Forbidden", {status: result.status});
	}
	const stub = c.env.USER_STORE.get(c.env.USER_STORE.idFromName(result.email));
	c.set("stub", stub);
	stores.set(c.req.raw, storeClient(stub));
	return next();
});

app.use("/health", identity);
app.use("/api/*", identity);

// Migrated routes are answered here over RPC.
app.route(
	"/",
	createHttpApp({
		resolveStore: (request) => {
			const store = stores.get(request);
			if (!store) {
				throw new Error("No store resolved for this request");
			}
			return store;
		},
	}),
);

// Strangler fallback: the admin routes (step 6) and the decision pages are still served by the Durable Object's own fetch.
app.all("/api/*", async (c) => c.var.stub.fetch(c.req.raw));

app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default app satisfies ExportedHandler<WorkerEnv>;
