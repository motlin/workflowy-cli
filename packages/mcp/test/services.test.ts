import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {getInternalAuth} from "../src/services.js";

function envWith(vars: Record<string, string>): NodeJS.ProcessEnv {
	const sessionFile = join(mkdtempSync(join(tmpdir(), "mcp-services-")), "workflowy-session");
	return {WORKFLOWY_SESSION_FILE: sessionFile, ...vars};
}

describe("getInternalAuth", () => {
	it("builds internal-API credentials when both WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD are set", () => {
		const auth = getInternalAuth(envWith({WORKFLOWY_USERNAME: "alice@example.com", WORKFLOWY_PASSWORD: "hunter2"}));
		expect(auth).toStrictEqual({
			credentials: {username: "alice@example.com", password: "hunter2"},
			sessionStore: {read: expect.any(Function), write: expect.any(Function), clear: expect.any(Function)},
		});
	});

	it("is undefined when only WORKFLOWY_USERNAME is set", () => {
		expect(getInternalAuth(envWith({WORKFLOWY_USERNAME: "alice@example.com"}))).toBeUndefined();
	});

	it("is undefined when only WORKFLOWY_PASSWORD is set", () => {
		expect(getInternalAuth(envWith({WORKFLOWY_PASSWORD: "hunter2"}))).toBeUndefined();
	});

	it("is undefined when neither is set", () => {
		expect(getInternalAuth(envWith({}))).toBeUndefined();
	});
});
