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

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflowy-seed-test-"));
		const testDbPath = path.join(tempDir, "test.sqlite");
		testDatabase = createTestDatabase(testDbPath);
		originalDbPath = process.env.WORKFLOWY_DB_PATH;
		process.env.WORKFLOWY_DB_PATH = testDbPath;
		received = [];
		server = http.createServer((request, response) => {
			let body = "";
			request.on("data", (chunk: Buffer) => {
				body += chunk.toString();
			});
			request.on("end", () => {
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
});
