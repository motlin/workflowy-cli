import {describe, expect, it, vi} from "vite-plus/test";
import {Hono} from "hono";
import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import type {AppEnv, ServerContext} from "../src/server/context.js";
import {createAccountRouter} from "../src/server/routes/account.js";
import {createPreferencesRouter} from "../src/server/routes/preferences.js";

const NOT_CONFIGURED =
	"Workflowy internal API is not configured (set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD, or run './bin/run.js internal login')";
type MetadataChange = Parameters<WorkflowyInternalAdapter["setRootMetaValues"]>[0][number];

const NOTES = "1a2b3c4d-0000-4000-8000-000000000001";

/** Apply root-metadata changes to a plain object, as the real adapter's cache does. */
function applyChanges(meta: Record<string, unknown>, changes: MetadataChange[]): void {
	for (const {path, value} of changes) {
		let target = meta;
		for (const key of path.slice(0, -1)) {
			target[key] ??= {};
			target = target[key] as Record<string, unknown>;
		}
		const last = path.at(-1)!;
		if (value === undefined) {
			Reflect.deleteProperty(target, last);
		} else {
			target[last] = value;
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function setup(meta: Record<string, unknown> | undefined) {
	const adapter = {
		getRootMeta: vi.fn<WorkflowyInternalAdapter["getRootMeta"]>(async (path) =>
			Promise.resolve(path.reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), meta)),
		),
		setRootMetaValues: vi.fn<WorkflowyInternalAdapter["setRootMetaValues"]>(async (changes) => {
			applyChanges(meta!, changes);
			return Promise.resolve();
		}),
		getAccount: vi.fn<WorkflowyInternalAdapter["getAccount"]>(async () =>
			Promise.resolve({userId: 42, joinedAt: new Date(1_500_000_000 * 1000)}),
		),
	};
	const ctx = {
		internalAdapter: () => (meta ? (adapter as unknown as WorkflowyInternalAdapter) : undefined),
	} as unknown as ServerContext;
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});
	app.route("/api/v1/preferences", createPreferencesRouter());
	app.route("/api/v1/account", createAccountRouter());
	const request = async (method: string, path: string, body?: unknown) => {
		const res = await app.fetch(
			new Request(`http://x/api/v1${path}`, {
				method,
				headers: {"content-type": "application/json"},
				...(body === undefined ? {} : {body: JSON.stringify(body)}),
			}),
		);
		return {status: res.status, body: (await res.json()) as unknown};
	};
	return {adapter, request};
}

const EMPTY = {dateFormat: null, timeFormat: null, weekStartDay: null, slashDiscovered: false, notesRootId: null};

describe("GET /api/v1/preferences", () => {
	it("reads the root metadata fields", async () => {
		const {request} = setup({
			dateFormat: "MMM D, YYYY",
			timeFormat: "h:mm a",
			weekStartDay: 1,
			slash: {discovered: true},
			notesRootId: NOTES,
			starring: {locations: {}},
		});

		await expect(request("GET", "/preferences")).resolves.toStrictEqual({
			status: 200,
			body: {
				dateFormat: "MMM D, YYYY",
				timeFormat: "h:mm a",
				weekStartDay: 1,
				slashDiscovered: true,
				notesRootId: NOTES,
			},
		});
	});

	it("answers nulls and false for missing or mistyped values", async () => {
		const {request} = setup({dateFormat: 7, weekStartDay: "1", slash: "yes"});

		await expect(request("GET", "/preferences")).resolves.toStrictEqual({status: 200, body: EMPTY});
	});

	it("answers 503 without the internal API", async () => {
		const {request} = setup(undefined);

		await expect(request("GET", "/preferences")).resolves.toStrictEqual({
			status: 503,
			body: {error: NOT_CONFIGURED},
		});
	});
});

describe("PATCH /api/v1/preferences", () => {
	it("writes dateFormat once and answers the merged preferences", async () => {
		const {adapter, request} = setup({timeFormat: "HH:mm"});

		const response = await request("PATCH", "/preferences", {dateFormat: "YYYY-MM-DD ddd"});

		expect({response, writes: adapter.setRootMetaValues.mock.calls}).toStrictEqual({
			response: {status: 200, body: {...EMPTY, dateFormat: "YYYY-MM-DD ddd", timeFormat: "HH:mm"}},
			writes: [[[{path: ["dateFormat"], value: "YYYY-MM-DD ddd"}]]],
		});
	});

	it("writes slashDiscovered at slash.discovered", async () => {
		const {adapter, request} = setup({});

		const response = await request("PATCH", "/preferences", {slashDiscovered: true});

		expect({response, writes: adapter.setRootMetaValues.mock.calls}).toStrictEqual({
			response: {status: 200, body: {...EMPTY, slashDiscovered: true}},
			writes: [[[{path: ["slash", "discovered"], value: true}]]],
		});
	});

	it("writes several fields in one push and removes a field set to null", async () => {
		const {adapter, request} = setup({dateFormat: "MMM D", notesRootId: NOTES});

		const response = await request("PATCH", "/preferences", {weekStartDay: 0, notesRootId: null});

		expect({response, writes: adapter.setRootMetaValues.mock.calls}).toStrictEqual({
			response: {status: 200, body: {...EMPTY, dateFormat: "MMM D", weekStartDay: 0}},
			writes: [
				[
					[
						{path: ["weekStartDay"], value: 0},
						{path: ["notesRootId"], value: undefined},
					],
				],
			],
		});
	});

	it("rejects unknown keys and mistyped values without writing", async () => {
		const {adapter, request} = setup({});

		const bogus = await request("PATCH", "/preferences", {bogus: 1});
		const mistyped = await request("PATCH", "/preferences", {weekStartDay: "monday"});

		expect({
			bogus: bogus.status,
			mistyped: mistyped.status,
			writes: adapter.setRootMetaValues.mock.calls,
		}).toStrictEqual({bogus: 400, mistyped: 400, writes: []});
	});
});

describe("GET /api/v1/account", () => {
	it("returns the user id and ISO join date", async () => {
		const {request} = setup({});

		await expect(request("GET", "/account")).resolves.toStrictEqual({
			status: 200,
			body: {userId: 42, joinedAt: "2017-07-14T02:40:00.000Z"},
		});
	});

	it("answers 503 without the internal API", async () => {
		const {request} = setup(undefined);

		await expect(request("GET", "/account")).resolves.toStrictEqual({status: 503, body: {error: NOT_CONFIGURED}});
	});
});
