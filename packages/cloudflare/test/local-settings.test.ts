import {afterAll, beforeAll, describe, expect, it} from "vite-plus/test";
import {startHarness} from "./harness";
import type {Harness} from "./harness";

const url = "http://localhost/api/admin/local-settings";

async function put(h: Harness, body: unknown) {
	return h.mf.dispatchFetch(url, {
		method: "PUT",
		headers: {"content-type": "application/json"},
		body: JSON.stringify(body),
	});
}

async function rows(h: Harness): Promise<unknown> {
	return (await h.mf.dispatchFetch(url)).json();
}

describe("/api/admin/local-settings", () => {
	let h: Harness;

	beforeAll(async () => {
		h = await startHarness("../src/worker.ts");
	}, 120_000);

	afterAll(async () => {
		await h.dispose();
	});

	it("starts empty", async () => {
		await expect(rows(h)).resolves.toStrictEqual([]);
	});

	it("upserts rows, keeping their timestamps, and replaces by key", async () => {
		const first = await put(h, [
			{key: "setting:theme", json: '"dark"', updatedAt: 111},
			{key: "root:layout", json: "{}", updatedAt: 222},
		]);
		expect({status: first.status, body: await first.json()}).toStrictEqual({status: 200, body: {upserted: 2}});

		await put(h, [{key: "setting:theme", json: '"light"', updatedAt: 333}]);
		await expect(rows(h)).resolves.toStrictEqual([
			{key: "root:layout", json: "{}", updatedAt: 222},
			{key: "setting:theme", json: '"light"', updatedAt: 333},
		]);
	});

	it("rejects malformed bodies and unsupported methods", async () => {
		const bad = await put(h, [{key: "x"}]);
		expect(bad.status).toBe(400);
		await bad.arrayBuffer();
		const notArray = await put(h, {key: "x"});
		expect(notArray.status).toBe(400);
		await notArray.arrayBuffer();
		const del = await h.mf.dispatchFetch(url, {method: "DELETE"});
		expect(del.status).toBe(405);
		await del.arrayBuffer();
	});
});
