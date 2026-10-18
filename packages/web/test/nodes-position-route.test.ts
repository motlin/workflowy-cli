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

const createNode = vi.hoisted(() => vi.fn<SharedCache.WorkflowyWriteThroughClient["createNode"]>());
const moveNode = vi.hoisted(() => vi.fn<SharedCache.WorkflowyWriteThroughClient["moveNode"]>());

vi.mock("@workflowy/shared/cache", async (importOriginal) => {
	const actual = await importOriginal<typeof SharedCache>();
	return {
		...actual,
		WorkflowyWriteThroughClient: class {
			createNode = createNode;
			moveNode = moveNode;
		},
	};
});

const {CacheService} = await import("@workflowy/shared/cache");
const {nodesRouter} = await import("../src/server/routes/nodes.js");

const migrationsFolder = join(import.meta.dirname, "../../shared/src/db/migrations");
const NOT_CONFIGURED =
	"Workflowy internal API is not configured (set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD, or run './bin/run.js internal login')";

function apiNode(id: string, parentId: string | null, priority: number): WorkflowyNode {
	return {id, name: id.toUpperCase(), note: null, parent_id: parentId, priority, createdAt: 100, modifiedAt: 200};
}

function dto(id: string, parentId: string | null, priority: number, hasChildren = false) {
	return {
		id,
		parent_id: parentId,
		name: id.toUpperCase(),
		note: null,
		priority,
		data: {layoutMode: null},
		createdAt: 100,
		modifiedAt: 200,
		completedAt: null,
		hasChildren,
		isMirror: false,
		originalNodeId: null,
		attachment: null,
	};
}

interface FakeAdapter {
	createAt: ReturnType<typeof vi.fn<WorkflowyInternalAdapter["createAt"]>>;
	moveTo: ReturnType<typeof vi.fn<WorkflowyInternalAdapter["moveTo"]>>;
	restore: ReturnType<typeof vi.fn<WorkflowyInternalAdapter["restore"]>>;
}

/** Home holds `a`, `b`, `c` (priorities 0..2); `a` is empty. */
function setup(configured: boolean) {
	const sqlite = new DatabaseConstructor(":memory:");
	const db = drizzle(sqlite, {schema});
	migrate(db, {migrationsFolder});
	const cacheService = new CacheService(db);
	for (const [index, id] of ["a", "b", "c"].entries()) {
		cacheService.insertNode(apiNode(id, null, index), null);
	}
	const adapter: FakeAdapter = {
		createAt: vi.fn<WorkflowyInternalAdapter["createAt"]>(async (input) => {
			cacheService.insertNode(apiNode("new", input.parentId === "home" ? null : input.parentId, 1), null);
			return Promise.resolve({id: "new"});
		}),
		moveTo: vi.fn<WorkflowyInternalAdapter["moveTo"]>(async () => {}),
		restore: vi.fn<WorkflowyInternalAdapter["restore"]>(async (input) => {
			cacheService.insertNode(apiNode(input.id, null, 0), null);
			return Promise.resolve();
		}),
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
	const post = async (path: string, body: unknown) =>
		app.fetch(
			new Request(`http://x/api/v1/nodes${path}`, {
				method: "POST",
				headers: {"content-type": "application/json"},
				body: JSON.stringify(body),
			}),
		);
	return {adapter, post};
}

beforeEach(() => {
	createNode.mockReset();
	moveNode.mockReset();
});

describe("POST /api/v1/nodes with the internal API", () => {
	it("creates at the exact index", async () => {
		const {adapter, post} = setup(true);

		const res = await post("", {parent_id: "home", name: "", index: 1});

		expect(res.status).toBe(201);
		expect(adapter.createAt.mock.calls).toStrictEqual([[{parentId: "home", index: 1, name: ""}]]);
		await expect(res.json()).resolves.toStrictEqual({node: dto("new", null, 1)});
	});

	it("creates at the bottom when the index is omitted", async () => {
		const {adapter, post} = setup(true);

		await post("", {parent_id: "home", name: "x"});

		expect(adapter.createAt.mock.calls).toStrictEqual([[{parentId: "home", index: 3, name: "x"}]]);
	});

	it("passes note and layoutMode through and treats a null parent as Home", async () => {
		const {adapter, post} = setup(true);

		await post("", {parent_id: null, name: "x", note: "n", layoutMode: "board", index: 0});

		expect(adapter.createAt.mock.calls).toStrictEqual([
			[{parentId: "home", index: 0, name: "x", note: "n", metadata: {layoutMode: "board"}}],
		]);
	});

	it("maps a legacy negative position to the top", async () => {
		const {adapter, post} = setup(true);

		await post("", {parent_id: "a", name: "x", position: -1});

		expect(adapter.createAt.mock.calls).toStrictEqual([[{parentId: "a", index: 0, name: "x"}]]);
	});
});

describe("POST /api/v1/nodes/:id/move with the internal API", () => {
	it("moves to the exact index and returns the affected sibling lists", async () => {
		const {adapter, post} = setup(true);

		const res = await post("/c/move", {parent_id: "home", index: 0});

		expect(res.status).toBe(200);
		expect(adapter.moveTo.mock.calls).toStrictEqual([[{ids: ["c"], parentId: "home", index: 0}]]);
		await expect(res.json()).resolves.toStrictEqual({
			nodes: [dto("a", null, 0), dto("b", null, 1), dto("c", null, 2)],
		});
	});

	it("moves to the bottom when the index is omitted", async () => {
		const {adapter, post} = setup(true);

		const res = await post("/c/move", {parent_id: "a"});

		expect(adapter.moveTo.mock.calls).toStrictEqual([[{ids: ["c"], parentId: "a", index: 0}]]);
		await expect(res.json()).resolves.toStrictEqual({
			nodes: [dto("a", null, 0), dto("b", null, 1), dto("c", null, 2)],
		});
	});
});

describe("POST /api/v1/nodes/move with the internal API", () => {
	it("moves a block in one call", async () => {
		const {adapter, post} = setup(true);

		const res = await post("/move", {ids: ["b", "c"], parent_id: "a", index: 0});

		expect(res.status).toBe(200);
		expect(adapter.moveTo.mock.calls).toStrictEqual([[{ids: ["b", "c"], parentId: "a", index: 0}]]);
		await expect(res.json()).resolves.toStrictEqual({
			nodes: [dto("a", null, 0), dto("b", null, 1), dto("c", null, 2)],
		});
	});

	it("rejects a body without ids", async () => {
		const {adapter, post} = setup(true);

		const res = await post("/move", {parent_id: "a", index: 0});

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toStrictEqual({error: "ids must be a non-empty array of strings"});
		expect(adapter.moveTo.mock.calls).toStrictEqual([]);
	});
});

describe("POST /api/v1/nodes/:id/restore", () => {
	it("restores into the given slot and returns the node under its original id", async () => {
		const {adapter, post} = setup(true);

		const res = await post("/gone/restore", {parent_id: "home", index: 0});

		expect(res.status).toBe(200);
		expect(adapter.restore.mock.calls).toStrictEqual([[{id: "gone", parentId: "home", index: 0}]]);
		await expect(res.json()).resolves.toStrictEqual({node: dto("gone", null, 0)});
	});

	it("restores to the original location without a slot", async () => {
		const {adapter, post} = setup(true);

		await post("/gone/restore", {});

		expect(adapter.restore.mock.calls).toStrictEqual([[{id: "gone"}]]);
	});

	it("answers 409 when the node is not deleted", async () => {
		const {adapter, post} = setup(true);

		const res = await post("/a/restore", {});

		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toStrictEqual({error: "Node is not deleted"});
		expect(adapter.restore.mock.calls).toStrictEqual([]);
	});

	it("answers 503 when the internal API is not configured", async () => {
		const {post} = setup(false);

		const res = await post("/gone/restore", {});

		expect(res.status).toBe(503);
		await expect(res.json()).resolves.toStrictEqual({error: NOT_CONFIGURED});
	});
});

describe("public-API fallback when the internal API is not configured", () => {
	const created = {...apiNode("n1", "a", 0), completedAt: null};

	it("maps create index 0 to top and the child count to bottom", async () => {
		const {post} = setup(false);
		createNode.mockResolvedValue(created);

		const top = await post("", {parent_id: "home", name: "x", index: 0});
		const bottom = await post("", {parent_id: "home", name: "y", index: 3});
		const omitted = await post("", {parent_id: "home", name: "z"});

		expect([top.status, bottom.status, omitted.status]).toStrictEqual([201, 201, 201]);
		expect(createNode.mock.calls).toStrictEqual([
			[{parent_id: "home", name: "x", note: undefined, layoutMode: undefined, position: "top"}],
			[{parent_id: "home", name: "y", note: undefined, layoutMode: undefined, position: "bottom"}],
			[{parent_id: "home", name: "z", note: undefined, layoutMode: undefined, position: "bottom"}],
		]);
		await expect(top.json()).resolves.toStrictEqual({node: dto("n1", null, 0, true)});
	});

	it("answers 503 for a create at a middle index", async () => {
		const {post} = setup(false);

		const res = await post("", {parent_id: "home", name: "x", index: 1});

		expect(res.status).toBe(503);
		await expect(res.json()).resolves.toStrictEqual({error: NOT_CONFIGURED});
		expect(createNode.mock.calls).toStrictEqual([]);
	});

	it("maps move index 0 to top and the child count to bottom, and a middle index to 503", async () => {
		const {post} = setup(false);
		moveNode.mockResolvedValue(apiNode("c", null, 0));

		const top = await post("/c/move", {parent_id: "home", index: 0});
		const bottom = await post("/c/move", {parent_id: "home", index: 3});
		const middle = await post("/c/move", {parent_id: "home", index: 1});

		expect([top.status, bottom.status, middle.status]).toStrictEqual([200, 200, 503]);
		expect(moveNode.mock.calls).toStrictEqual([
			["c", null, -1],
			["c", null, 0],
		]);
	});

	it("moves a block to the top last-first so it keeps its order", async () => {
		const {post} = setup(false);
		moveNode.mockResolvedValue(apiNode("b", null, 0));

		const res = await post("/move", {ids: ["b", "c"], parent_id: "home", index: 0});

		expect(res.status).toBe(200);
		expect(moveNode.mock.calls).toStrictEqual([
			["c", null, -1],
			["b", null, -1],
		]);
	});
});
