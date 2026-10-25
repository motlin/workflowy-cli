import {describe, expect, it} from "vite-plus/test";
import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {Hono} from "hono";
import {join} from "node:path";
import * as schema from "@workflowy/shared/db";
import type {AppEnv, ServerContext} from "../src/server/context.js";

const {CacheService} = await import("@workflowy/shared/cache");
const {nodesRouter} = await import("../src/server/routes/nodes.js");

const migrationsFolder = join(import.meta.dirname, "../../shared/src/db/migrations");
const CHILD = "7b1c2d3e-aaaa-4bbb-8ccc-c910f3eac9b3";
const MIRROR = "0e9f8d7c-1111-4222-8333-d4f14a54f384";

describe("GET /api/v1/nodes/:id with a virtual location id", () => {
	it("resolves v_<child12>_<mirror12> to the original child it shows", async () => {
		const sqlite = new DatabaseConstructor(":memory:");
		const db = drizzle(sqlite, {schema});
		migrate(db, {migrationsFolder});
		const cacheService = new CacheService(db);
		cacheService.insertNode(
			{id: CHILD, name: "child", note: null, parent_id: null, priority: 0, createdAt: 1, modifiedAt: 2},
			null,
		);
		const ctx = {db, cacheService} as unknown as ServerContext;
		const app = new Hono<AppEnv>();
		app.use("*", async (c, next) => {
			c.set("ctx", ctx);
			await next();
		});
		app.route("/api/v1/nodes", nodesRouter);

		const res = await app.fetch(new Request(`http://x/api/v1/nodes/v_c910f3eac9b3_${MIRROR.slice(-12)}_0e9f`));

		expect({status: res.status, id: ((await res.json()) as {node: {id: string}}).node.id}).toStrictEqual({
			status: 200,
			id: CHILD,
		});
	});
});
