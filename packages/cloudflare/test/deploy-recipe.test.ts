import {describe, expect, it} from "vite-plus/test";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";

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
