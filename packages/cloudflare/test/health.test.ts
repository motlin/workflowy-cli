import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {afterAll, beforeAll, describe, expect, it} from "vite-plus/test";

describe("worker /health", () => {
	let mf: Miniflare;

	beforeAll(async () => {
		const result = await build({
			entryPoints: [new URL("../src/worker.ts", import.meta.url).pathname],
			bundle: true,
			format: "esm",
			write: false,
			platform: "neutral",
		});
		const script = result.outputFiles[0]?.text ?? "";
		mf = new Miniflare({
			modules: true,
			script,
			compatibilityDate: "2026-08-01",
			compatibilityFlags: ["nodejs_compat"],
		});
	});

	afterAll(async () => {
		await mf.dispose();
	});

	it("returns 200 with status ok", async () => {
		const response = await mf.dispatchFetch("http://localhost/health");
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toStrictEqual({status: "ok"});
	});

	it("returns 404 for unknown paths", async () => {
		const response = await mf.dispatchFetch("http://localhost/nope");
		expect(response.status).toBe(404);
	});
});
