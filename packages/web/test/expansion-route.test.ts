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
		getExpansionState: vi.fn<WorkflowyInternalAdapter["getExpansionState"]>(async () =>
			Promise.resolve({expandedIds: [ALPHA], fetchedAt: 1234, refreshing: false, fingerprint: "f1"}),
		),
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
	const request = async (
		method: string,
		body?: unknown,
		query = "",
		path = "",
		headers: Record<string, string> = {},
	) => {
		const res = await app.fetch(
			new Request(`http://x/api/v1/expansion${path}${query}`, {
				method,
				headers: {"content-type": "application/json", ...headers},
				...(body === undefined ? {} : {body: JSON.stringify(body)}),
			}),
		);
		const text = await res.text();
		return {
			status: res.status,
			body: text === "" ? null : (JSON.parse(text) as unknown),
			etag: res.headers.get("etag"),
		};
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
	it("returns the adapter's expansion state, allowing cached keys, with an ETag", async () => {
		const {adapter, request} = setup(true);

		const res = await request("GET");

		expect({res, calls: adapter.getExpansionState.mock.calls}).toStrictEqual({
			res: {
				status: 200,
				body: {expandedIds: [ALPHA], fetchedAt: 1234, refreshing: false},
				etag: '"f1"',
			},
			calls: [[{fresh: false, wait: false}]],
		});
	});

	it("asks the adapter for fresh keys with ?fresh=1 and to wait on a refresh with ?wait=1", async () => {
		const {adapter, request} = setup(true);

		await request("GET", undefined, "?fresh=1");
		await request("GET", undefined, "?wait=1");

		expect(adapter.getExpansionState.mock.calls).toStrictEqual([
			[{fresh: true, wait: false}],
			[{fresh: false, wait: true}],
		]);
	});

	it("answers 304 with an empty body when If-None-Match is the current ETag, 200 once the keys change", async () => {
		const {adapter, request} = setup(true);

		const first = await request("GET");
		const unchanged = await request("GET", undefined, "", "", {"if-none-match": first.etag ?? ""});
		adapter.getExpansionState.mockResolvedValueOnce({
			expandedIds: [ALPHA, BRAVO],
			fetchedAt: 2000,
			refreshing: false,
			fingerprint: "f2",
		});
		const changed = await request("GET", undefined, "", "", {"if-none-match": first.etag ?? ""});

		expect({unchanged, changed}).toStrictEqual({
			unchanged: {status: 304, body: null, etag: '"f1"'},
			changed: {
				status: 200,
				body: {expandedIds: [ALPHA, BRAVO], fetchedAt: 2000, refreshing: false},
				etag: '"f2"',
			},
		});
	});

	it("answers 503 without the internal API", async () => {
		const {request} = setup(false);

		await expect(request("GET")).resolves.toStrictEqual({status: 503, body: {error: NOT_CONFIGURED}, etag: null});
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
			first: {status: 204, body: null, etag: null},
			second: {status: 204, body: null, etag: null},
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
			res: {status: 400, body: {error: "body must be {changes: {[nodeId]: boolean}}"}, etag: null},
			calls: [],
		});
	});

	it("answers 503 without the internal API", async () => {
		const {request} = setup(false);

		await expect(request("PATCH", {changes: {[ALPHA]: true}})).resolves.toStrictEqual({
			status: 503,
			body: {error: NOT_CONFIGURED},
			etag: null,
		});
	});

	it("retries a failed push with the failed changes merged under newer PATCHes", async () => {
		const {adapter, request} = setup(true);
		adapter.setExpanded.mockRejectedValueOnce(new Error("push failed"));
		vi.spyOn(console, "error").mockImplementation(() => {});

		await request("PATCH", {changes: {[ALPHA]: true}});
		await vi.advanceTimersByTimeAsync(500);
		await request("PATCH", {changes: {[BRAVO]: false}});
		await vi.advanceTimersByTimeAsync(1000);

		expect(adapter.setExpanded.mock.calls).toStrictEqual([[{[ALPHA]: true}], [{[ALPHA]: true, [BRAVO]: false}]]);
	});

	it("retries with the newer value when a later PATCH overrides a failed change", async () => {
		const {adapter, request} = setup(true);
		adapter.setExpanded.mockRejectedValueOnce(new Error("push failed"));
		vi.spyOn(console, "error").mockImplementation(() => {});

		await request("PATCH", {changes: {[ALPHA]: true}});
		await vi.advanceTimersByTimeAsync(500);
		await request("PATCH", {changes: {[ALPHA]: false}});
		await vi.advanceTimersByTimeAsync(1000);

		expect(adapter.setExpanded.mock.calls).toStrictEqual([[{[ALPHA]: true}], [{[ALPHA]: false}]]);
	});

	it("retries on a 1s/2s/4s/8s backoff, gives up after 4 retries and logs", async () => {
		const {adapter, request} = setup(true);
		adapter.setExpanded.mockRejectedValue(new Error("push failed"));
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});

		await request("PATCH", {changes: {[ALPHA]: true}});
		await vi.advanceTimersByTimeAsync(500);
		const attemptTimes: number[] = [];
		let elapsed = 0;
		for (const step of [999, 1, 1999, 1, 3999, 1, 7999, 1, 30_000]) {
			// oxlint-disable-next-line no-await-in-loop -- the clock advances sequentially by design.
			await vi.advanceTimersByTimeAsync(step);
			elapsed += step;
			attemptTimes.push(adapter.setExpanded.mock.calls.length);
		}

		expect({attemptTimes, elapsed, logged: errors.mock.calls.length > 0}).toStrictEqual({
			attemptTimes: [1, 2, 2, 3, 3, 4, 4, 5, 5],
			elapsed: 45_000,
			logged: true,
		});
	});
});

describe("/api/v1/expansion/left-bar", () => {
	it("lists the adapter's left-bar keys", async () => {
		const {request} = setup(true);

		await expect(request("GET", undefined, "", "/left-bar")).resolves.toStrictEqual({
			status: 200,
			body: {keys: ["leftbar__home__None/x/__abcdefgh"]},
			etag: null,
		});
	});

	it("pushes raw keys once, 500ms after the last PATCH", async () => {
		const {adapter, request} = setup(true);

		const first = await request("PATCH", {changes: {"leftbar__home__None/x/__abcdefgh": true}}, "", "/left-bar");
		await vi.advanceTimersByTimeAsync(499);
		const before = adapter.setRawExpansionKeys.mock.calls.length;
		await vi.advanceTimersByTimeAsync(1);

		expect({first, before, calls: adapter.setRawExpansionKeys.mock.calls}).toStrictEqual({
			first: {status: 204, body: null, etag: null},
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
