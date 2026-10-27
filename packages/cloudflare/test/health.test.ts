import {afterAll, beforeAll, describe, expect, it} from "vite-plus/test";
import {startHarness} from "./harness";
import type {Harness} from "./harness";

describe("worker /health", () => {
	let harness: Harness;

	beforeAll(async () => {
		harness = await startHarness("../src/worker.ts");
	}, 60_000);

	afterAll(async () => {
		await harness.dispose();
	});

	it("returns 200 with status ok", async () => {
		const response = await harness.mf.dispatchFetch("http://localhost/health");
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toStrictEqual({status: "ok"});
	});
});
