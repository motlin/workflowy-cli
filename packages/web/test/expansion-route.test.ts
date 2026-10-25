import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Hono} from "hono";
import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import type {AppEnv, ServerContext} from "../src/server/context.js";
import {createExpansionRouter} from "../src/server/routes/expansion.js";

const NOT_CONFIGURED =
	"Workflowy internal API is not configured (set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD, or run './bin/run.js internal login')";
const ALPHA = "1a2b3c4d-0000-4000-8000-000000000001";
const BRAVO = "5e6f7a8b-0000-4000-8000-000000000002";

function setup(configured: boolean) {
	const adapter = {
		getExpandedIds: vi.fn<WorkflowyInternalAdapter["getExpandedIds"]>(async () => Promise.resolve([ALPHA])),
		setExpanded: vi.fn<WorkflowyInternalAdapter["setExpanded"]>(async () => Promise.resolve()),
		getLeftBarExpansionKeys: vi.fn<WorkflowyInternalAdapter["getLeftBarExpansionKeys"]>(async () =>
			Promise.resolve(["leftbar__home__None/x/__abcdefgh"]),
		),
		setRawExpansionKeys: vi.fn<WorkflowyInternalAdapter["setRawExpansionKeys"]>(async () => Promise.resolve()),
	};
	const ctx = {
		internalAuth: configured ? {} : undefined,
		internalAdapter: () => (configured ? (adapter as unknown as WorkflowyInternalAdapter) : undefined),
	} as unknown as ServerContext;
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});
	app.route("/api/v1/expansion", createExpansionRouter());
	const request = async (method: string, body?: unknown, query = "", path = "") => {
		const res = await app.fetch(
			new Request(`http://x/api/v1/expansion${path}${query}`, {
				method,
				headers: {"content-type": "application/json"},
				...(body === undefined ? {} : {body: JSON.stringify(body)}),
			}),
		);
		const text = await res.text();
		return {status: res.status, body: text === "" ? null : (JSON.parse(text) as unknown)};
	};
	return {adapter, request};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("GET /api/v1/expansion", () => {
	it("returns the adapter's resolved expanded ids, allowing cached keys", async () => {
		const {adapter, request} = setup(true);

		const res = await request("GET");

		expect({res, calls: adapter.getExpandedIds.mock.calls}).toStrictEqual({
			res: {status: 200, body: {expandedIds: [ALPHA]}},
			calls: [[{fresh: false}]],
		});
	});

	it("asks the adapter for fresh keys with ?fresh=1", async () => {
		const {adapter, request} = setup(true);

		const res = await request("GET", undefined, "?fresh=1");

		expect({res, calls: adapter.getExpandedIds.mock.calls}).toStrictEqual({
			res: {status: 200, body: {expandedIds: [ALPHA]}},
			calls: [[{fresh: true}]],
		});
	});

	it("answers 503 without the internal API", async () => {
		const {request} = setup(false);

		await expect(request("GET")).resolves.toStrictEqual({status: 503, body: {error: NOT_CONFIGURED}});
	});
});

describe("PATCH /api/v1/expansion", () => {
	it("debounces PATCHes into one push 500ms after the last, the latest value per id winning", async () => {
		const {adapter, request} = setup(true);

		const first = await request("PATCH", {changes: {[ALPHA]: false, [BRAVO]: false}});
		await vi.advanceTimersByTimeAsync(200);
		const second = await request("PATCH", {changes: {[ALPHA]: true}});
		await vi.advanceTimersByTimeAsync(499);
		const callsBeforeFlush = adapter.setExpanded.mock.calls.length;
		await vi.advanceTimersByTimeAsync(1);

		expect({first, second, callsBeforeFlush, calls: adapter.setExpanded.mock.calls}).toStrictEqual({
			first: {status: 204, body: null},
			second: {status: 204, body: null},
			callsBeforeFlush: 0,
			calls: [[{[ALPHA]: true, [BRAVO]: false}]],
		});
	});

	it("starts a new batch after a flush", async () => {
		const {adapter, request} = setup(true);

		await request("PATCH", {changes: {[ALPHA]: true}});
		await vi.advanceTimersByTimeAsync(500);
		await request("PATCH", {changes: {[BRAVO]: false}});
		await vi.advanceTimersByTimeAsync(500);

		expect(adapter.setExpanded.mock.calls).toStrictEqual([[{[ALPHA]: true}], [{[BRAVO]: false}]]);
	});

	it.each([[{}], [{changes: {[ALPHA]: "yes"}}], [{changes: [ALPHA]}]])("rejects %j", async (body) => {
		const {adapter, request} = setup(true);

		const res = await request("PATCH", body);
		await vi.advanceTimersByTimeAsync(500);

		expect({res, calls: adapter.setExpanded.mock.calls}).toStrictEqual({
			res: {status: 400, body: {error: "body must be {changes: {[nodeId]: boolean}}"}},
			calls: [],
		});
	});

	it("answers 503 without the internal API", async () => {
		const {request} = setup(false);

		await expect(request("PATCH", {changes: {[ALPHA]: true}})).resolves.toStrictEqual({
			status: 503,
			body: {error: NOT_CONFIGURED},
		});
	});
});

describe("/api/v1/expansion/left-bar", () => {
	it("lists the adapter's left-bar keys", async () => {
		const {request} = setup(true);

		await expect(request("GET", undefined, "", "/left-bar")).resolves.toStrictEqual({
			status: 200,
			body: {keys: ["leftbar__home__None/x/__abcdefgh"]},
		});
	});

	it("pushes raw keys once, 500ms after the last PATCH", async () => {
		const {adapter, request} = setup(true);

		const first = await request("PATCH", {changes: {"leftbar__home__None/x/__abcdefgh": true}}, "", "/left-bar");
		await vi.advanceTimersByTimeAsync(499);
		const before = adapter.setRawExpansionKeys.mock.calls.length;
		await vi.advanceTimersByTimeAsync(1);

		expect({first, before, calls: adapter.setRawExpansionKeys.mock.calls}).toStrictEqual({
			first: {status: 204, body: null},
			before: 0,
			calls: [[{"leftbar__home__None/x/__abcdefgh": true}]],
		});
	});

	it("rejects keys that are not left-bar keys", async () => {
		const {adapter, request} = setup(true);

		const res = await request("PATCH", {changes: {main__abc: true}}, "", "/left-bar");
		await vi.advanceTimersByTimeAsync(1000);

		expect({status: res.status, calls: adapter.setRawExpansionKeys.mock.calls}).toStrictEqual({
			status: 400,
			calls: [],
		});
	});
});
