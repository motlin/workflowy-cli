import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {localSettings} from "@workflowy/shared/db";
import {captureOutput} from "@oclif/test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import SeedLocalSettings from "../../../src/commands/cache/seed-local-settings.js";
import {cleanupTestDatabase, createTestDatabase} from "../../db/migration-helper.js";
import type {TestDatabase} from "../../db/migration-helper.js";

describe("cache:seed-local-settings command", () => {
	let tempDir: string;
	let testDatabase: TestDatabase;
	let originalDbPath: string | undefined;
	let server: http.Server;
	let received: {method?: string; url?: string; body: string}[];
	let receivedHeaders: http.IncomingHttpHeaders[];

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflowy-seed-test-"));
		const testDbPath = path.join(tempDir, "test.sqlite");
		testDatabase = createTestDatabase(testDbPath);
		originalDbPath = process.env.WORKFLOWY_DB_PATH;
		process.env.WORKFLOWY_DB_PATH = testDbPath;
		received = [];
		receivedHeaders = [];
		server = http.createServer((request, response) => {
			let body = "";
			request.on("data", (chunk: Buffer) => {
				body += chunk.toString();
			});
			request.on("end", () => {
				receivedHeaders.push(request.headers);
				received.push({method: request.method, url: request.url, body});
				response.setHeader("content-type", "application/json");
				response.end(JSON.stringify({upserted: 2}));
			});
		});
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => {
				resolve();
			});
		});
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => {
			server.close(() => {
				resolve();
			});
		});
		cleanupTestDatabase(testDatabase);
		if (originalDbPath === undefined) {
			delete process.env.WORKFLOWY_DB_PATH;
		} else {
			process.env.WORKFLOWY_DB_PATH = originalDbPath;
		}
		fs.rmSync(tempDir, {recursive: true, force: true});
	});

	it("PUTs every local_settings row to the admin route under the given base URL", async () => {
		testDatabase.db
			.insert(localSettings)
			.values([
				{key: "setting:theme", json: '"dark"', updatedAt: 111},
				{key: "root:layout", json: "{}", updatedAt: 222},
			])
			.run();
		const address = server.address();
		const port = typeof address === "object" && address ? address.port : 0;

		const {stdout} = await captureOutput(async () =>
			SeedLocalSettings.run(["--url", `http://127.0.0.1:${port}`, "--json"]),
		);

		expect(received).toStrictEqual([
			{
				method: "PUT",
				url: "/api/admin/local-settings",
				body: JSON.stringify([
					{key: "root:layout", json: "{}", updatedAt: 222},
					{key: "setting:theme", json: '"dark"', updatedAt: 111},
				]),
			},
		]);
		expect(JSON.parse(stdout)).toStrictEqual({rows: 2, upserted: 2});
	});

	async function seed(...extra: string[]): Promise<void> {
		const address = server.address();
		const port = typeof address === "object" && address ? address.port : 0;
		await captureOutput(async () =>
			SeedLocalSettings.run(["--url", `http://127.0.0.1:${port}`, "--json", ...extra]),
		);
	}

	it("sends no Access headers by default", async () => {
		await seed();
		expect(receivedHeaders[0]?.["cf-access-client-id"]).toBeUndefined();
		expect(receivedHeaders[0]?.["cf-access-client-secret"]).toBeUndefined();
	});

	it("sends Access service-token headers from flags", async () => {
		await seed("--access-client-id", "id-1.access", "--access-client-secret", "secret-1");
		expect(receivedHeaders[0]?.["cf-access-client-id"]).toBe("id-1.access");
		expect(receivedHeaders[0]?.["cf-access-client-secret"]).toBe("secret-1");
	});

	it("sends Access service-token headers from CF_ACCESS_* env vars", async () => {
		process.env.CF_ACCESS_CLIENT_ID = "env-id.access";
		process.env.CF_ACCESS_CLIENT_SECRET = "env-secret";
		try {
			await seed();
		} finally {
			delete process.env.CF_ACCESS_CLIENT_ID;
			delete process.env.CF_ACCESS_CLIENT_SECRET;
		}
		expect(receivedHeaders[0]?.["cf-access-client-id"]).toBe("env-id.access");
		expect(receivedHeaders[0]?.["cf-access-client-secret"]).toBe("env-secret");
	});
});
