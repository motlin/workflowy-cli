import {describe, expect, it} from "vite-plus/test";
import {spawnSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";

const root = new URL("../../..", import.meta.url).pathname;

function runDeploy(confirm: string | undefined) {
	const env = {...process.env};
	delete env.CONFIRM_DEPLOY;
	if (confirm !== undefined) {
		env.CONFIRM_DEPLOY = confirm;
	}
	// Only the refusal path is ever exercised here: every value below must stop before wrangler runs.
	return spawnSync("just", ["--no-deps", "cf-deploy"], {cwd: root, env, encoding: "utf8"});
}

describe("just cf-deploy", () => {
	it("refuses when CONFIRM_DEPLOY is unset", () => {
		const result = runDeploy(undefined);
		expect({status: result.status, stderr: result.stderr.includes("CONFIRM_DEPLOY=1")}).toStrictEqual({
			status: 1,
			stderr: true,
		});
	});

	it("refuses when CONFIRM_DEPLOY is anything but 1", () => {
		const result = runDeploy("yes");
		expect({status: result.status, stderr: result.stderr.includes("CONFIRM_DEPLOY=1")}).toStrictEqual({
			status: 1,
			stderr: true,
		});
	});

	it("is not reachable from verify, precommit or test", () => {
		const justfile = readFileSync(`${root}justfile`, "utf8");
		const verify = justfile.slice(justfile.indexOf("\nverify quick"), justfile.indexOf("# Deprecated alias"));
		expect(verify).not.toContain("cf-deploy");
		expect(verify).not.toContain("cf-smoke");
	});
});

describe("Worker dev through the Cloudflare Vite plugin", () => {
	const justfile = readFileSync(`${root}justfile`, "utf8");
	const recipe = (name: string) => {
		const start = justfile.indexOf(`\n${name}`);
		const end = justfile.indexOf("\n\n", start + 1);
		return justfile.slice(start, end);
	};

	it("runs dev as vp dev with the worker config, and keeps the Node host as dev-node", () => {
		expect(recipe("dev *args")).toContain("vp dev -c vite.worker.config.ts");
		expect(recipe("dev *args")).not.toContain("wrangler dev");
		expect(recipe("dev-node")).toContain("vp run --filter @workflowy/web dev");
	});

	it("builds with cf-build and deploys the generated wrangler.json", () => {
		expect(recipe("cf-build")).toContain("vp build -c vite.worker.config.ts");
		expect(recipe("cf-deploy")).toContain("wrangler deploy -c");
		expect(recipe("cf-deploy")).toContain("dist/workflowy/worker/wrangler.json");
	});

	it("has a worker Vite config that uses the plugin against the Cloudflare wrangler.jsonc", () => {
		const path = `${root}packages/web/vite.worker.config.ts`;
		expect(existsSync(path)).toBe(true);
		const config = readFileSync(path, "utf8");
		expect(config).toContain("@cloudflare/vite-plugin");
		expect(config).toContain("wrangler.jsonc");
	});
});
