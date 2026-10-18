import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Probe from "../../../src/commands/internal/probe.js";

const INIT_BODY = {
	projectTreeData: {
		mainProjectTreeInfo: {
			dateJoinedTimestampInSeconds: 1_300_000_000,
			initialMostRecentOperationTransactionId: "1234567",
			ownerId: 42,
		},
		rootProjectMetadata: {},
	},
	settings: {},
	user: {id: 42},
	globals: [["CLIENT_VERSION", 25]],
};

const POLL_BODY = {
	results: [
		{
			new_most_recent_operation_transaction_id: "1234567",
			concurrent_remote_operation_transactions: [],
			error_encountered_in_remote_operations: false,
		},
	],
	new_polling_interval_in_ms: 30_000,
};

interface Recorded {
	path: string;
	body: string | undefined;
}

function respond(pathname: string, pollStatus: number): Response {
	if (pathname === "/ajax_login") {
		return new Response("", {status: 200, headers: {"set-cookie": "sessionid=abc123; Path=/"}});
	}
	if (pathname === "/get_initialization_data") {
		return Response.json(INIT_BODY, {headers: {wfclientid: "2026-10-18 12:00:00.123456"}});
	}
	if (pathname === "/push_and_poll") {
		return pollStatus === 200 ? Response.json(POLL_BODY) : new Response("Forbidden", {status: pollStatus});
	}
	return new Response("not found", {status: 404});
}

function fakeFetch(recorded: Recorded[], pollStatus = 200) {
	return vi.fn<typeof fetch>(async (input, init) => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
		recorded.push({path: url.pathname, body: typeof init?.body === "string" ? init.body : undefined});
		return Promise.resolve(respond(url.pathname, pollStatus));
	});
}

describe("internal probe command", () => {
	let tempDir: string;
	let outPath: string;
	let sessionFile: string;
	const savedEnv = {...process.env};

	beforeEach(() => {
		vi.useFakeTimers({toFake: ["Date"]});
		vi.setSystemTime(new Date("2026-10-18T12:00:00.000Z"));
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflowy-probe-"));
		outPath = path.join(tempDir, "probes.md");
		process.env.WORKFLOWY_USERNAME = "alice@example.com";
		process.env.WORKFLOWY_PASSWORD = "hunter2";
		sessionFile = path.join(tempDir, "workflowy-session");
		process.env.WORKFLOWY_SESSION_FILE = sessionFile;
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		process.env = {...savedEnv};
		fs.rmSync(tempDir, {recursive: true, force: true});
	});

	it("refuses to run without --yes-live and makes no request", async () => {
		const recorded: Recorded[] = [];
		vi.stubGlobal("fetch", fakeFetch(recorded));
		await expect(Probe.run(["bootstrap", "--out", outPath])).rejects.toThrow(
			"Live probe against workflowy.com: pass --yes-live to run it",
		);
		expect(recorded).toStrictEqual([]);
		expect(fs.existsSync(outPath)).toBe(false);
	});

	it("rejects an unknown step", async () => {
		await expect(Probe.run(["delete-everything", "--yes-live", "--out", outPath])).rejects.toThrow(
			"Expected delete-everything to be one of: bootstrap, poll",
		);
	});

	it("refuses to run without credentials or a saved session cookie", async () => {
		delete process.env.WORKFLOWY_PASSWORD;
		await expect(Probe.run(["bootstrap", "--yes-live", "--out", outPath])).rejects.toThrow(
			"Set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD, or run './bin/run.js internal login' via op run",
		);
	});

	it("bootstrap reuses a saved session cookie without credentials or a login", async () => {
		delete process.env.WORKFLOWY_USERNAME;
		delete process.env.WORKFLOWY_PASSWORD;
		fs.writeFileSync(sessionFile, "sessionid=saved\n");
		const recorded: Recorded[] = [];
		vi.stubGlobal("fetch", fakeFetch(recorded));
		await Probe.run(["bootstrap", "--yes-live", "--out", outPath]);
		expect(recorded.map((request) => request.path)).toStrictEqual(["/get_initialization_data"]);
	});

	it("bootstrap saves the fresh login cookie to the session file", async () => {
		vi.stubGlobal("fetch", fakeFetch([]));
		await Probe.run(["bootstrap", "--yes-live", "--out", outPath]);
		expect(fs.readFileSync(sessionFile, "utf8")).toBe("sessionid=abc123\n");
	});

	it("bootstrap records client id shape, CLIENT_VERSION and tx id source", async () => {
		const recorded: Recorded[] = [];
		vi.stubGlobal("fetch", fakeFetch(recorded));
		await Probe.run(["bootstrap", "--yes-live", "--out", outPath]);
		expect(recorded.map((request) => request.path)).toStrictEqual(["/ajax_login", "/get_initialization_data"]);
		expect(fs.readFileSync(outPath, "utf8")).toBe(
			[
				"",
				"## bootstrap (2026-10-18T12:00:00.000Z)",
				"",
				"- `wfclientid` header: present, shape `9999-99-99 99:99:99.999999`",
				"- `client_version` used: `25` (from a JSON `globals` CLIENT_VERSION)",
				"- `initialMostRecentOperationTransactionId` with `no_root_children=1`: present, shape `9999999`",
				"- `get_tree_data` fallback needed: no",
				"- `get_user_data` needed for user/settings/root metadata: no",
				"- Requests: `POST /ajax_login` 200; `GET /get_initialization_data` 200 (" +
					`${JSON.stringify(INIT_BODY).length} bytes)`,
				"",
			].join("\n"),
		);
	});

	it("poll sends crosscheck_user_id and records the result keys and size", async () => {
		const recorded: Recorded[] = [];
		vi.stubGlobal("fetch", fakeFetch(recorded));
		await Probe.run(["poll", "--yes-live", "--out", outPath]);
		const poll = recorded.find((request) => request.path === "/push_and_poll");
		const form = new URLSearchParams(poll?.body);
		expect([...form.keys()]).toStrictEqual([
			"client_id",
			"client_version",
			"push_poll_id",
			"push_poll_data",
			"timezone",
			"crosscheck_user_id",
		]);
		expect(JSON.parse(form.get("push_poll_data") ?? "")).toStrictEqual([
			{most_recent_operation_transaction_id: "1234567"},
		]);
		expect(fs.readFileSync(outPath, "utf8")).toBe(
			[
				"",
				"## poll (2026-10-18T12:00:00.000Z)",
				"",
				"- `crosscheck_user_id` sent: yes",
				`- HTTP status: 200 (${JSON.stringify(POLL_BODY).length} bytes)`,
				"- CSRF: not enforced (cookie-only client accepted)",
				"- Response keys: `new_polling_interval_in_ms`, `results`",
				"- `results[0]` keys: `concurrent_remote_operation_transactions`, `error_encountered_in_remote_operations`, `new_most_recent_operation_transaction_id`",
				"- Tx id advanced: no (still current)",
				"- Remote transactions: 0",
				"",
			].join("\n"),
		);
	});

	it("poll --no-crosscheck omits crosscheck_user_id and records a 403 as CSRF enforcement", async () => {
		const recorded: Recorded[] = [];
		vi.stubGlobal("fetch", fakeFetch(recorded, 403));
		await Probe.run(["poll", "--no-crosscheck", "--yes-live", "--out", outPath]);
		const poll = recorded.find((request) => request.path === "/push_and_poll");
		expect(new URLSearchParams(poll?.body).has("crosscheck_user_id")).toBe(false);
		expect(fs.readFileSync(outPath, "utf8")).toBe(
			[
				"",
				"## poll --no-crosscheck (2026-10-18T12:00:00.000Z)",
				"",
				"- `crosscheck_user_id` sent: no",
				"- HTTP status: 403 (9 bytes)",
				"- CSRF: enforced or request refused (403)",
				"- Body (not JSON): `Forbidden`",
				"",
			].join("\n"),
		);
	});
});
