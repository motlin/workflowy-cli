import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Hono} from "hono";
import type {CacheService} from "@workflowy/shared/cache";
import type {AppEnv, ServerContext} from "../src/server/context.js";
import {createServerContext} from "../src/server/context.js";
import {internalApiRequired} from "../src/server/internal-api.js";

vi.mock("../src/server/db.js", () => ({getDatabase: () => ({})}));

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("createServerContext internalCredentials", () => {
	it("reads WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD", () => {
		vi.stubEnv("WORKFLOWY_USERNAME", "alice@example.com");
		vi.stubEnv("WORKFLOWY_PASSWORD", "pw");
		expect(createServerContext().internalCredentials).toStrictEqual({
			username: "alice@example.com",
			password: "pw",
		});
	});

	it("is undefined when the password is missing", () => {
		vi.stubEnv("WORKFLOWY_USERNAME", "alice@example.com");
		vi.stubEnv("WORKFLOWY_PASSWORD", "");
		expect(createServerContext().internalCredentials).toBeUndefined();
	});

	it("is undefined when the username is missing", () => {
		vi.stubEnv("WORKFLOWY_USERNAME", "");
		vi.stubEnv("WORKFLOWY_PASSWORD", "pw");
		expect(createServerContext().internalCredentials).toBeUndefined();
	});
});

function makeApp(internalCredentials: ServerContext["internalCredentials"]) {
	const ctx = {db: {}, cacheService: {} as CacheService, internalCredentials} as ServerContext;
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});
	app.get("/dummy", internalApiRequired, (c) => c.json({ok: true}));
	return app;
}

describe("internalApiRequired", () => {
	it("answers 503 when internal credentials are not configured", async () => {
		const res = await makeApp(undefined).fetch(new Request("http://x/dummy"));
		expect(res.status).toBe(503);
		await expect(res.json()).resolves.toStrictEqual({
			error: "Workflowy internal API is not configured (set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD)",
		});
	});

	it("passes through when internal credentials are configured", async () => {
		const res = await makeApp({username: "alice@example.com", password: "pw"}).fetch(new Request("http://x/dummy"));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toStrictEqual({ok: true});
	});
});
