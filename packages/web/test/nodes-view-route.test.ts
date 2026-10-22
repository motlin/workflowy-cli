import {describe, expect, it} from "vite-plus/test";
import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {Hono} from "hono";
import {join} from "node:path";
import * as schema from "@workflowy/shared/db";
import type {WorkflowyNode} from "@workflowy/shared/types";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import type {AppEnv, ServerContext} from "../src/server/context.js";

const {CacheService} = await import("@workflowy/shared/cache");
const {nodesRouter} = await import("../src/server/routes/nodes.js");

const migrationsFolder = join(import.meta.dirname, "../../shared/src/db/migrations");

function apiNode(id: string, parentId: string | null, priority: number, completedAt?: number): WorkflowyNode {
	return {
		id,
		name: id,
		note: null,
		parent_id: parentId,
		priority,
		createdAt: 100,
		modifiedAt: 200,
		completed: completedAt !== undefined,
		...(completedAt === undefined ? {} : {completedAt}),
	};
}

/** Home holds Alpha>{A1>{A1a}, A2 (completed)>{A2a}} and Beta>{B1}. */
function setup() {
	const sqlite = new DatabaseConstructor(":memory:");
	const db = drizzle(sqlite, {schema});
	migrate(db, {migrationsFolder});
	const cacheService = new CacheService(db);
	cacheService.insertNode(apiNode("Alpha", null, 0), null);
	cacheService.insertNode(apiNode("Beta", null, 1), null);
	cacheService.insertNode(apiNode("A1", "Alpha", 0), "Alpha");
	cacheService.insertNode(apiNode("A2", "Alpha", 1, 300), "Alpha");
	cacheService.insertNode(apiNode("A1a", "A1", 0), "A1");
	cacheService.insertNode(apiNode("A2a", "A2", 0), "A2");
	cacheService.insertNode(apiNode("B1", "Beta", 0), "Beta");
	const ctx = {db, cacheService} as unknown as ServerContext;
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});
	app.route("/api/v1/nodes", nodesRouter);
	const post = async (body: unknown) => {
		const res = await app.fetch(
			new Request("http://x/api/v1/nodes/view", {
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify(body),
			}),
		);
		return {status: res.status, body: await res.json()};
	};
	/** Make `mirrorId` (a new child of `parentId`) a mirror of `originalId`. */
	const mirror = (mirrorId: string, parentId: string, originalId: string) => {
		cacheService.insertNode(apiNode(mirrorId, parentId, 9), parentId);
		sqlite
			.prepare("INSERT INTO mirrors (mirror_id, original_id, system_from, system_to) VALUES (?, ?, ?, ?)")
			.run(mirrorId, originalId, "2000-01-01T00:00:00.000Z", FAR_FUTURE_DATE);
	};
	return {post, mirror};
}

interface ListBody {
	parentId: string | null;
	nodes: {id: string}[];
	backlinks: unknown;
}

/** Each list as [parentId, child ids, backlinks]. */
function lists(body: {lists: ListBody[]}): [string | null, string[], unknown][] {
	return body.lists.map((list) => [list.parentId, list.nodes.map((node) => node.id), list.backlinks]);
}

const NO_BACKLINKS = {rootId: null, items: []};

describe("POST /api/v1/nodes/view", () => {
	it("lists the root's and every expanded rendered row's children depth-first, with their Backlinks", async () => {
		const {post} = setup();

		const {status, body} = await post({
			rootId: null,
			expandedIds: ["Alpha", "A1", "A2", "Beta"],
			limit: 100,
			showCompleted: false,
		});

		expect({status, lists: lists(body)}).toStrictEqual({
			status: 200,
			lists: [
				[null, ["Alpha", "Beta"], null],
				["Alpha", ["A1", "A2"], NO_BACKLINKS],
				["A1", ["A1a"], NO_BACKLINKS],
				["Beta", ["B1"], NO_BACKLINKS],
			],
		});
	});

	it("descends into a completed expanded row when completed rows show", async () => {
		const {post} = setup();

		const {body} = await post({rootId: "Alpha", expandedIds: ["A2"], limit: 100, showCompleted: true});

		expect(lists(body)).toStrictEqual([
			["Alpha", ["A1", "A2"], NO_BACKLINKS],
			["A2", ["A2a"], NO_BACKLINKS],
		]);
	});

	it("stops descending once the row budget is spent", async () => {
		const {post} = setup();

		const {body} = await post({
			rootId: null,
			expandedIds: ["Alpha", "A1", "Beta"],
			limit: 3,
			showCompleted: false,
		});

		expect(lists(body)).toStrictEqual([
			[null, ["Alpha", "Beta"], null],
			["Alpha", ["A1", "A2"], NO_BACKLINKS],
			["A1", ["A1a"], NO_BACKLINKS],
		]);
	});

	it("lists an expanded mirror's original's children under the mirror's id", async () => {
		const {post, mirror} = setup();
		mirror("M", "Beta", "Alpha");

		const {body} = await post({rootId: "Beta", expandedIds: ["M"], limit: 100, showCompleted: false});

		expect(lists(body)).toStrictEqual([
			["Beta", ["B1", "M"], NO_BACKLINKS],
			["M", ["A1", "A2"], NO_BACKLINKS],
		]);
	});

	it("answers 404 for an unresolvable short root id and 400 for a malformed body", async () => {
		const {post} = setup();

		await expect(
			Promise.all([
				post({rootId: "0123456789ab", expandedIds: [], limit: 10, showCompleted: false}),
				post({rootId: null, expandedIds: "Alpha", limit: 10, showCompleted: false}),
			]),
		).resolves.toStrictEqual([
			{status: 404, body: {error: "Node not found"}},
			{status: 400, body: {error: "body must be {rootId, expandedIds, limit, showCompleted}"}},
		]);
	});
});
