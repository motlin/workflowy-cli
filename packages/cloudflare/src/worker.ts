import {createHttpApp} from "@workflowy/web/server-app";
import type {StoreClient} from "@workflowy/web/server-app";
import {Hono} from "hono";
import {createMiddleware} from "hono/factory";
import {resolveIdentity} from "./access";
import type {AccessEnv} from "./access";
import {storeClient} from "./store-client";
import type {LocalSettingRow, UserStore} from "./user-store";

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

const methodNotAllowed = () => new Response("Method not allowed", {status: 405});

app.get("/api/admin/status", async (c) => c.json(await c.var.stub.adminStatus()));
app.all("/api/admin/status", methodNotAllowed);

app.post("/api/admin/sync", async (c) => c.json(await c.var.stub.syncNow(), 202));
app.get("/api/admin/sync", async (c) => c.json(await c.var.stub.syncStatus()));
app.all("/api/admin/sync", methodNotAllowed);

// The one way to read the whole tree (about 54 MB): an explicit reseed when the sync reports a missing seed or a refresh.
app.post("/api/admin/seed", async (c) => c.json(await c.var.stub.seedTree(), 202));
app.all("/api/admin/seed", methodNotAllowed);

app.get("/api/admin/local-settings", async (c) => c.json(await c.var.stub.listLocalSettings()));
// PUT upserts a JSON array of `{key, json, updatedAt}` rows by key.
app.put("/api/admin/local-settings", async (c) => {
	const body: unknown = await c.req.json().catch(() => {});
	const rows = Array.isArray(body) ? body.map(parseLocalSettingRow) : undefined;
	if (!rows || !rows.every((row) => row !== undefined)) {
		return new Response("Expected a JSON array of {key, json, updatedAt} rows", {status: 400});
	}
	return c.json(await c.var.stub.putLocalSettings(rows));
});
app.all("/api/admin/local-settings", methodNotAllowed);

function parseLocalSettingRow(value: unknown): LocalSettingRow | undefined {
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

// The one HTTP surface the DO keeps: a WebSocket cannot cross RPC, and hibernation needs the DO to accept it.
app.get("/api/v1/ladder/events", async (c) => {
	if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
		return new Response("Expected a WebSocket upgrade", {status: 426});
	}
	return c.var.stub.fetch(c.req.raw);
});

app.all("/api/*", () => new Response("Not found", {status: 404}));

app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default app satisfies ExportedHandler<WorkerEnv>;
