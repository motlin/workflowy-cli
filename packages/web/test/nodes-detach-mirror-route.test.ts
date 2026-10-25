import {beforeEach, describe, expect, it, vi} from "vite-plus/test";
import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {Hono} from "hono";
import {join} from "node:path";
import type * as SharedCache from "@workflowy/shared/cache";
import * as schema from "@workflowy/shared/db";
import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import type {WorkflowyNode} from "@workflowy/shared/types";
import type {AppEnv, ServerContext} from "../src/server/context.js";

const deleteNode = vi.hoisted(() => vi.fn<SharedCache.WorkflowyWriteThroughClient["deleteNode"]>());

vi.mock("@workflowy/shared/cache", async (importOriginal) => {
	const actual = await importOriginal<typeof SharedCache>();
	return {
		...actual,
		WorkflowyWriteThroughClient: class {
			deleteNode = deleteNode;
		},
	};
});

const {CacheService} = await import("@workflowy/shared/cache");
const {nodesRouter} = await import("../src/server/routes/nodes.js");

const migrationsFolder = join(import.meta.dirname, "../../shared/src/db/migrations");

function apiNode(
	id: string,
	parentId: string | null,
	priority: number,
	extra: Partial<WorkflowyNode> = {},
): WorkflowyNode {
	return {
		id,
		name: id.toLowerCase(),
		note: null,
		parent_id: parentId,
		priority,
		createdAt: 100,
		modifiedAt: 200,
		...extra,
	};
}

/** Home holds P and O; O holds C (which holds G). P holds A, M (mirror of O), B. */
function setup() {
	const sqlite = new DatabaseConstructor(":memory:");
	const db = drizzle(sqlite, {schema});
	migrate(db, {migrationsFolder});
	const cacheService = new CacheService(db);
	cacheService.insertNode(apiNode("P", null, 0), null);
	cacheService.insertNode(apiNode("O", null, 1, {note: "n", completed: true, completedAt: 5}), null);
	cacheService.insertNode(apiNode("C", "O", 0), "O");
	cacheService.insertNode(apiNode("G", "C", 0), "C");
	cacheService.insertNode(apiNode("A", "P", 0), "P");
	cacheService.insertNode(apiNode("M", "P", 1), "P");
	cacheService.insertNode(apiNode("B", "P", 2), "P");
	sqlite
		.prepare("INSERT INTO mirrors (mirror_id, original_id, system_from, system_to) VALUES (?, ?, ?, ?)")
		.run("M", "O", "2000-01-01T00:00:00.000Z", FAR_FUTURE_DATE);
	const createTreesAt = vi.fn<WorkflowyInternalAdapter["createTreesAt"]>(async (input) => {
		cacheService.insertNode(apiNode("COPY", input.parentId === "home" ? null : input.parentId, 9), null);
		return Promise.resolve({ids: ["COPY"]});
	});
	const ctx = {
		db,
		cacheService,
		apiKey: "test-key",
		internalAuth: {},
		internalAdapter: () => ({createTreesAt}) as unknown as WorkflowyInternalAdapter,
	} as unknown as ServerContext;
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});
	app.route("/api/v1/nodes", nodesRouter);
	const post = async (path: string) => app.fetch(new Request(`http://x/api/v1/nodes${path}`, {method: "POST"}));
	return {createTreesAt, post};
}

beforeEach(() => {
	deleteNode.mockReset();
	deleteNode.mockResolvedValue({mirrorIds: [], promotions: [], nodeId: "x"});
});

describe("POST /api/v1/nodes/:id/detach-mirror", () => {
	it("copies the original's subtree into the mirror's slot, open, then removes the mirror", async () => {
		const {createTreesAt, post} = setup();

		const res = await post("/M/detach-mirror");

		expect({status: res.status, calls: createTreesAt.mock.calls, deleted: deleteNode.mock.calls}).toStrictEqual({
			status: 201,
			calls: [
				[
					{
						parentId: "P",
						index: 1,
						trees: [{name: "o", note: "n", children: [{name: "c", children: [{name: "g"}]}]}],
					},
				],
			],
			deleted: [["M"]],
		});
		expect(((await res.json()) as {node: {id: string; isMirror: boolean}}).node).toMatchObject({
			id: "COPY",
			isMirror: false,
		});
	});

	it("copies an original with mirrors in place and deletes it", async () => {
		const {createTreesAt, post} = setup();

		const res = await post("/O/detach-mirror");

		expect({
			status: res.status,
			parent: createTreesAt.mock.calls[0]?.[0].parentId,
			deleted: deleteNode.mock.calls,
		}).toStrictEqual({
			status: 201,
			parent: "home",
			deleted: [["O"]],
		});
	});

	it("refuses a plain node", async () => {
		const {createTreesAt, post} = setup();

		const res = await post("/A/detach-mirror");

		expect({status: res.status, calls: createTreesAt.mock.calls.length}).toStrictEqual({status: 400, calls: 0});
	});
});
