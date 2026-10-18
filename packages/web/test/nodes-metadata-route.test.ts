import {beforeEach, describe, expect, it, vi} from "vite-plus/test";
import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {Hono} from "hono";
import {join} from "node:path";
import type * as SharedCache from "@workflowy/shared/cache";
import * as schema from "@workflowy/shared/db";
import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import type {WorkflowyNode} from "@workflowy/shared/types";
import type {AppEnv, ServerContext} from "../src/server/context.js";

const updateNode = vi.hoisted(() => vi.fn<SharedCache.WorkflowyWriteThroughClient["updateNode"]>());

vi.mock("@workflowy/shared/cache", async (importOriginal) => {
	const actual = await importOriginal<typeof SharedCache>();
	return {
		...actual,
		WorkflowyWriteThroughClient: class {
			updateNode = updateNode;
		},
	};
});

const {CacheService} = await import("@workflowy/shared/cache");
const {homeRouter, nodesRouter} = await import("../src/server/routes/nodes.js");

const migrationsFolder = join(import.meta.dirname, "../../shared/src/db/migrations");
const NOT_CONFIGURED =
	"Workflowy internal API is not configured (set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD, or run './bin/run.js internal login')";

function apiNode(id: string, layoutMode?: string): WorkflowyNode {
	return {
		id,
		name: id.toUpperCase(),
		note: null,
		parent_id: null,
		priority: 0,
		createdAt: 100,
		modifiedAt: 200,
		...(layoutMode === undefined ? {} : {data: {layoutMode}}),
	};
}

function dto(id: string, layoutMode: string | null, numberedStart: number | null) {
	return {
		id,
		parent_id: null,
		name: id.toUpperCase(),
		note: null,
		priority: 0,
		data: {layoutMode},
		numberedStart,
		createdAt: 100,
		modifiedAt: 200,
		completedAt: null,
		hasChildren: false,
		isMirror: false,
		originalNodeId: null,
		attachment: null,
	};
}

interface FakeAdapter {
	setNodeMetaValues: ReturnType<typeof vi.fn<WorkflowyInternalAdapter["setNodeMetaValues"]>>;
	getRootMeta: ReturnType<typeof vi.fn<WorkflowyInternalAdapter["getRootMeta"]>>;
}

/** Home holds `n1`; the fake adapter writes metadata changes to the cache as the real one does. */
function setup(configured: boolean, rootLayoutMode?: string) {
	const sqlite = new DatabaseConstructor(":memory:");
	const db = drizzle(sqlite, {schema});
	migrate(db, {migrationsFolder});
	const cacheService = new CacheService(db);
	cacheService.insertNode(apiNode("n1"), null);
	const writeMetadata = (id: string, metadata: Record<string, unknown>) =>
		sqlite
			.prepare(
				"INSERT INTO node_internal_metadata (node_id, metadata_json, fetched_at) VALUES (?, ?, 0) ON CONFLICT(node_id) DO UPDATE SET metadata_json = excluded.metadata_json",
			)
			.run(id, JSON.stringify(metadata));
	const adapter: FakeAdapter = {
		setNodeMetaValues: vi.fn<WorkflowyInternalAdapter["setNodeMetaValues"]>(async (id, changes) => {
			if (id !== "home") {
				const metadata: Record<string, unknown> = {};
				for (const {path, value} of changes) {
					if (path[0] === "layoutMode") {
						cacheService.insertNode(apiNode(id, typeof value === "string" ? value : undefined), null);
					} else if (value !== undefined) {
						metadata[path[0]] = value;
					}
				}
				writeMetadata(id, metadata);
			}
			return Promise.resolve();
		}),
		getRootMeta: vi.fn<WorkflowyInternalAdapter["getRootMeta"]>(async () => Promise.resolve(rootLayoutMode)),
	};
	const ctx = {
		db,
		cacheService,
		apiKey: "test-key",
		internalAuth: configured ? {} : undefined,
		internalAdapter: () => (configured ? (adapter as unknown as WorkflowyInternalAdapter) : undefined),
	} as unknown as ServerContext;
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});
	app.route("/api/v1/nodes", nodesRouter);
	app.route("/api/v1/home", homeRouter);
	const request = async (method: string, path: string, body?: unknown) => {
		const res = await app.fetch(
			new Request(`http://x/api/v1${path}`, {
				method,
				headers: {"content-type": "application/json"},
				...(body === undefined ? {} : {body: JSON.stringify(body)}),
			}),
		);
		return {status: res.status, body: await res.json()};
	};
	return {adapter, request, writeMetadata};
}

beforeEach(() => {
	updateNode.mockReset();
});

describe("PATCH /api/v1/nodes/home", () => {
	it("sets Home's layout to board through the root metadata", async () => {
		const {adapter, request} = setup(true);

		const res = await request("PATCH", "/nodes/home", {layoutMode: "board"});

		expect({res, calls: adapter.setNodeMetaValues.mock.calls}).toStrictEqual({
			res: {status: 200, body: {layoutMode: "board"}},
			calls: [["home", [{path: ["layoutMode"], value: "board"}]]],
		});
	});

	it("removes the layoutMode key for bullets", async () => {
		const {adapter, request} = setup(true);

		const res = await request("PATCH", "/nodes/home", {layoutMode: "bullets"});

		expect({res, calls: adapter.setNodeMetaValues.mock.calls}).toStrictEqual({
			res: {status: 200, body: {layoutMode: "bullets"}},
			calls: [["home", [{path: ["layoutMode"], value: undefined}]]],
		});
	});

	it.each([
		[{layoutMode: "table"}, "Home's layoutMode must be bullets or board"],
		[{layoutMode: "board", numberedStart: 2}, "Home accepts only layoutMode"],
		[{name: "x"}, "Home accepts only layoutMode"],
		[{}, "Home accepts only layoutMode"],
	])("rejects %j", async (body, error) => {
		const {adapter, request} = setup(true);

		const res = await request("PATCH", "/nodes/home", body);

		expect({res, calls: adapter.setNodeMetaValues.mock.calls}).toStrictEqual({
			res: {status: 400, body: {error}},
			calls: [],
		});
	});

	it("answers 503 without the internal API", async () => {
		const {request} = setup(false);

		await expect(request("PATCH", "/nodes/home", {layoutMode: "board"})).resolves.toStrictEqual({
			status: 503,
			body: {error: NOT_CONFIGURED},
		});
	});
});

describe("GET /api/v1/home", () => {
	it("returns Home's layoutMode", async () => {
		const {request} = setup(true, "board");

		await expect(request("GET", "/home")).resolves.toStrictEqual({status: 200, body: {layoutMode: "board"}});
	});

	it("defaults to bullets when the root has no layoutMode", async () => {
		const {request} = setup(true);

		await expect(request("GET", "/home")).resolves.toStrictEqual({status: 200, body: {layoutMode: "bullets"}});
	});

	it("answers 503 without the internal API", async () => {
		const {request} = setup(false);

		await expect(request("GET", "/home")).resolves.toStrictEqual({status: 503, body: {error: NOT_CONFIGURED}});
	});
});

describe("PATCH /api/v1/nodes/:id metadata", () => {
	it("sets layoutMode and numberedStart with one adapter call", async () => {
		const {adapter, request} = setup(true);

		const res = await request("PATCH", "/nodes/n1", {layoutMode: "numbered", numberedStart: 5});

		expect({res, calls: adapter.setNodeMetaValues.mock.calls, updates: updateNode.mock.calls}).toStrictEqual({
			res: {status: 200, body: {node: dto("n1", "numbered", 5)}},
			calls: [
				[
					"n1",
					[
						{path: ["layoutMode"], value: "numbered"},
						{path: ["numbered_start"], value: 5},
					],
				],
			],
			updates: [],
		});
	});

	it("removes numbered_start for a null numberedStart and the layoutMode key for bullets", async () => {
		const {adapter, request} = setup(true);

		await request("PATCH", "/nodes/n1", {layoutMode: "bullets", numberedStart: null});

		expect(adapter.setNodeMetaValues.mock.calls).toStrictEqual([
			[
				"n1",
				[
					{path: ["layoutMode"], value: undefined},
					{path: ["numbered_start"], value: undefined},
				],
			],
		]);
	});

	it("writes the name through the public API and the metadata through the adapter", async () => {
		const {adapter, request} = setup(true);
		updateNode.mockResolvedValue(apiNode("n1"));

		await request("POST", "/nodes/n1", {name: "Buy milk", numberedStart: 3});

		expect({calls: adapter.setNodeMetaValues.mock.calls, updates: updateNode.mock.calls}).toStrictEqual({
			calls: [["n1", [{path: ["numbered_start"], value: 3}]]],
			updates: [["n1", {name: "Buy milk"}]],
		});
	});

	it("rejects a numberedStart that is not an integer or null", async () => {
		const {adapter, request} = setup(true);

		const res = await request("PATCH", "/nodes/n1", {numberedStart: "5"});

		expect({res, calls: adapter.setNodeMetaValues.mock.calls}).toStrictEqual({
			res: {status: 400, body: {error: "numberedStart must be an integer or null"}},
			calls: [],
		});
	});

	it("answers 503 for numberedStart without the internal API", async () => {
		const {request} = setup(false);

		await expect(request("PATCH", "/nodes/n1", {numberedStart: 5})).resolves.toStrictEqual({
			status: 503,
			body: {error: NOT_CONFIGURED},
		});
	});

	it("falls back to the public API for layoutMode without the internal API", async () => {
		const {request} = setup(false);
		updateNode.mockResolvedValue(apiNode("n1", "board"));

		await request("PATCH", "/nodes/n1", {layoutMode: "board"});

		expect(updateNode.mock.calls).toStrictEqual([["n1", {layoutMode: "board"}]]);
	});
});

describe("node DTO numberedStart", () => {
	it("comes from the cached internal metadata", async () => {
		const {request, writeMetadata} = setup(false);
		writeMetadata("n1", {numbered_start: 5});

		await expect(request("GET", "/nodes/n1")).resolves.toStrictEqual({
			status: 200,
			body: {node: dto("n1", null, 5)},
		});
	});

	it("is null without cached metadata", async () => {
		const {request} = setup(false);

		await expect(request("GET", "/nodes?parent_id=None")).resolves.toStrictEqual({
			status: 200,
			body: {nodes: [dto("n1", null, null)]},
		});
	});
});
