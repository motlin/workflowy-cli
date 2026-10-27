import {describe, expect, it, vi} from "vite-plus/test";
import {Hono} from "hono";
import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import type {AppEnv, ServerContext} from "../src/server/context.js";
import {createAccountRouter} from "../src/server/routes/account.js";

describe("GET /api/v1/account", () => {
	it("answers the user id, join date, full name and email", async () => {
		const adapter = {
			getAccount: vi.fn<WorkflowyInternalAdapter["getAccount"]>(async () =>
				Promise.resolve({userId: 7, joinedAt: new Date("2020-01-02T00:00:00Z"), fullName: "Alice Smith"}),
			),
		};
		const ctx = {
			internalAdapter: () => adapter as unknown as WorkflowyInternalAdapter,
			config: {accountEmail: "user@example.com"},
		} as unknown as ServerContext;
		const app = new Hono<AppEnv>();
		app.use("*", async (c, next) => {
			c.set("ctx", ctx);
			await next();
		});
		app.route("/api/v1/account", createAccountRouter());

		const res = await app.fetch(new Request("http://x/api/v1/account"));

		expect({status: res.status, body: await res.json()}).toStrictEqual({
			status: 200,
			body: {userId: 7, joinedAt: "2020-01-02T00:00:00.000Z", fullName: "Alice Smith", email: "user@example.com"},
		});
	});
});
