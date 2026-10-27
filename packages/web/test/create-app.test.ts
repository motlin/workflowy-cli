import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import * as schema from "@workflowy/shared/db";
import {createApp} from "../src/server/app.js";
import type {ServerConfig} from "../src/server/config.js";
import {buildServerContext} from "../src/server/context.js";
import {LadderEventBus} from "../src/server/ladder-events.js";

const migrationsFolder = join(import.meta.dirname, "../../shared/src/db/migrations");

const baseConfig: ServerConfig = {
	accountEmail: "",
	sqlQueryLogging: false,
	calendarEnsureEnabled: false,
	calendarLayoutEnabled: false,
	features: {embeddings: false, treeSnapshot: true},
};

function memoryDb() {
	const db = drizzle(new DatabaseConstructor(":memory:"), {schema});
	migrate(db, {migrationsFolder});
	return db;
}

describe("createApp", () => {
	it("answers /health over an in-memory database context", async () => {
		const ctx = buildServerContext({db: memoryDb(), config: baseConfig, ladderEvents: new LadderEventBus()});
		const response = await createApp(ctx).fetch(new Request("http://localhost/health"));
		expect({status: response.status, body: await response.json()}).toStrictEqual({
			status: 200,
			body: {status: "ok"},
		});
	});
});

describe("buildServerContext", () => {
	it("derives the flags from its dependencies, with no internal adapter without auth", () => {
		const db = memoryDb();
		const ladderEvents = new LadderEventBus();
		const ctx = buildServerContext({
			db,
			config: {...baseConfig, apiKey: "key", calendarEnsureEnabled: true, calendarLayoutEnabled: false},
			ladderEvents,
		});
		expect({
			db: ctx.db === db,
			bus: ctx.ladderEvents === ladderEvents,
			apiKey: ctx.apiKey,
			ensure: ctx.calendarEnsureEnabled,
			layout: ctx.calendarLayoutEnabled,
			internalAuth: ctx.internalAuth,
			adapter: ctx.internalAdapter?.(),
		}).toStrictEqual({
			db: true,
			bus: true,
			apiKey: "key",
			ensure: true,
			layout: false,
			internalAuth: undefined,
			adapter: undefined,
		});
	});
});
