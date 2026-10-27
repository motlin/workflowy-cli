import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

function readWranglerConfig(): Record<string, unknown> {
	const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
	const json = text
		.split("\n")
		.filter((line) => !line.trim().startsWith("//"))
		.join("\n")
		.replaceAll(/,(\s*[}\]])/gu, "$1");
	const parsed: Record<string, unknown> = JSON.parse(json);
	return parsed;
}

describe("wrangler.jsonc", () => {
	it("raises the CPU limit so the alarm-driven import is not cut off at 30 s", () => {
		expect(readWranglerConfig().limits).toStrictEqual({cpu_ms: 300_000});
	});
});
