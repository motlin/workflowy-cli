import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Probe, {SANDBOX_ID, assertUnderSandbox} from "../../../src/commands/internal/probe.js";

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
			"Expected delete-everything to be one of: bootstrap, poll, error-shape",
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

describe("assertUnderSandbox", () => {
	it("passes when the sandbox is an ancestor", () => {
		expect(() => {
			assertUnderSandbox(["11111111-0000-0000-0000-000000000000", SANDBOX_ID]);
		}).not.toThrow();
	});

	it("throws when the sandbox is not an ancestor", () => {
		expect(() => {
			assertUnderSandbox(["11111111-0000-0000-0000-000000000000"]);
		}).toThrow(`Refusing to write outside the sandbox: ${SANDBOX_ID} is not an ancestor`);
	});

	it("throws for a node with no ancestors", () => {
		expect(() => {
			assertUnderSandbox([]);
		}).toThrow(`Refusing to write outside the sandbox: ${SANDBOX_ID} is not an ancestor`);
	});
});

const CHILD_ID = "c0ffee00-0000-4000-8000-000000000001";

interface PublicNode {
	id: string;
	name: string;
	parent_id: string | null;
}

function publicNode(node: PublicNode) {
	return {...node, note: null, priority: 0, completed: false, createdAt: 1, modifiedAt: 1, completedAt: null};
}

/** Public API + internal API fake: the child lives under `childParent`; a push renames it when `editApplies`. */
function errorShapeFetch(
	recorded: Recorded[],
	{childParent, editApplies}: {childParent: string; editApplies: boolean},
) {
	const nodes = new Map<string, PublicNode>([
		[SANDBOX_ID, {id: SANDBOX_ID, name: "Sandbox", parent_id: null}],
		[
			"0ther000-0000-4000-8000-000000000000",
			{id: "0ther000-0000-4000-8000-000000000000", name: "Other", parent_id: null},
		],
	]);
	const route = (url: URL, method: string, body: string | undefined): Response => {
		if (url.pathname === "/api/v1/nodes/" && method === "POST") {
			const created = JSON.parse(body ?? "{}") as {name: string};
			nodes.set(CHILD_ID, {id: CHILD_ID, name: created.name, parent_id: childParent});
			return Response.json({item_id: CHILD_ID});
		}
		if (url.pathname === "/api/v1/nodes" && method === "GET") {
			const parent = url.searchParams.get("parent_id");
			return Response.json({
				nodes: [...nodes.values()].filter((node) => node.parent_id === parent).map(publicNode),
			});
		}
		const match = /^\/api\/v1\/nodes\/([^/]+)$/u.exec(url.pathname);
		if (match?.[1] !== undefined) {
			const node = nodes.get(match[1]);
			if (method === "DELETE") {
				nodes.delete(match[1]);
				return Response.json({status: "ok"});
			}
			return node === undefined
				? new Response("not found", {status: 404})
				: Response.json({node: publicNode(node)});
		}
		if (url.pathname === "/push_and_poll") {
			const child = nodes.get(CHILD_ID);
			if (editApplies && child !== undefined) {
				child.name = "probe error-shape: renamed";
			}
			return Response.json({results: [{error: "error_encountered_running_operations"}]});
		}
		return respond(url.pathname, 200);
	};
	return vi.fn<typeof fetch>(async (input, init) => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
		const method = init?.method ?? "GET";
		const body = typeof init?.body === "string" ? init.body : undefined;
		recorded.push({path: `${method} ${url.pathname}`, body});
		return Promise.resolve(route(url, method, body));
	});
}

describe("internal probe error-shape", () => {
	let tempDir: string;
	let outPath: string;
	const savedEnv = {...process.env};

	beforeEach(() => {
		vi.useFakeTimers({toFake: ["Date"]});
		vi.setSystemTime(new Date("2026-10-18T12:00:00.000Z"));
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflowy-probe-"));
		outPath = path.join(tempDir, "probes.md");
		process.env.WORKFLOWY_USERNAME = "alice@example.com";
		process.env.WORKFLOWY_PASSWORD = "hunter2";
		process.env.WORKFLOWY_SESSION_FILE = path.join(tempDir, "workflowy-session");
		process.env.WORKFLOWY_API_KEY = "test-key";
		delete process.env.WORKFLOWY_API_URL;
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		process.env = {...savedEnv};
		fs.rmSync(tempDir, {recursive: true, force: true});
	});

	it("pushes an edit then a move into a missing parent in one batch, records the error, and deletes the child", async () => {
		const recorded: Recorded[] = [];
		vi.stubGlobal("fetch", errorShapeFetch(recorded, {childParent: SANDBOX_ID, editApplies: true}));
		await Probe.run(["error-shape", "--yes-live", "--out", outPath]);

		expect(recorded.map((request) => request.path)).toStrictEqual([
			"POST /api/v1/nodes/",
			`GET /api/v1/nodes/${CHILD_ID}`,
			"GET /api/v1/nodes",
			"POST /ajax_login",
			"GET /get_initialization_data",
			"POST /push_and_poll",
			`GET /api/v1/nodes/${CHILD_ID}`,
			`DELETE /api/v1/nodes/${CHILD_ID}`,
		]);
		const push = recorded.find((request) => request.path === "POST /push_and_poll");
		const pushData = JSON.parse(new URLSearchParams(push?.body).get("push_poll_data") ?? "") as {
			operations: {type: string; data: Record<string, unknown>}[];
		}[];
		expect(pushData[0]?.operations.map((op) => [op.type, op.data.projectid])).toStrictEqual([
			["edit", CHILD_ID],
			["move", CHILD_ID],
		]);
		expect(pushData[0]?.operations[0]?.data.name).toBe("probe error-shape: renamed");
		expect(pushData[0]?.operations[1]?.data.parentid).not.toBe(SANDBOX_ID);

		expect(fs.readFileSync(outPath, "utf8")).toBe(
			[
				"",
				"## error-shape (2026-10-18T12:00:00.000Z)",
				"",
				"- Fixture: fresh child created under the sandbox via the public API; ancestors verified",
				"- Batch: `edit` (rename the child) then `move` (into a nonexistent parent), one `/push_and_poll`",
				"- HTTP status: 200",
				"- `results[0]` keys: `error`",
				"- `results[0].error`: `error_encountered_running_operations`",
				"- `server_run_operation_transaction_json`: absent",
				"- Tx id advanced: unknown",
				"- First op (`edit`) applied: yes (name changed)",
				"- Child parent after push: sandbox",
				"- Cleanup: child deleted via the public API",
				"",
			].join("\n"),
		);
	});

	it("records an edit the server did not apply", async () => {
		vi.stubGlobal("fetch", errorShapeFetch([], {childParent: SANDBOX_ID, editApplies: false}));
		await Probe.run(["error-shape", "--yes-live", "--out", outPath]);
		expect(fs.readFileSync(outPath, "utf8")).toContain("- First op (`edit`) applied: no (name unchanged)\n");
	});

	it("refuses to push when the created child is not under the sandbox, and writes nothing else", async () => {
		const recorded: Recorded[] = [];
		vi.stubGlobal(
			"fetch",
			errorShapeFetch(recorded, {childParent: "0ther000-0000-4000-8000-000000000000", editApplies: true}),
		);
		await expect(Probe.run(["error-shape", "--yes-live", "--out", outPath])).rejects.toThrow(
			`Refusing to write outside the sandbox: ${SANDBOX_ID} is not an ancestor`,
		);
		expect(recorded.map((request) => request.path)).toStrictEqual([
			"POST /api/v1/nodes/",
			`GET /api/v1/nodes/${CHILD_ID}`,
			"GET /api/v1/nodes/0ther000-0000-4000-8000-000000000000",
		]);
		expect(fs.existsSync(outPath)).toBe(false);
	});

	it("requires WORKFLOWY_API_KEY", async () => {
		delete process.env.WORKFLOWY_API_KEY;
		await expect(Probe.run(["error-shape", "--yes-live", "--out", outPath])).rejects.toThrow(
			"WORKFLOWY_API_KEY environment variable is required",
		);
	});
});
