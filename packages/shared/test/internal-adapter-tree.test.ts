import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {z} from "zod";
import {WorkflowyApiClient} from "../src/api/workflowy-client.js";
import {WorkflowyInternalClient} from "../src/api/workflowy-internal-client.js";
import {CacheService} from "../src/cache/cache-service.js";
import {WorkflowyWriteThroughClient} from "../src/cache/workflowy-write-through-client.js";
import * as schema from "../src/db/schema.js";
import {WorkflowyInternalAdapter} from "../src/internal/adapter.js";
import {OperationRejected} from "../src/internal/errors.js";
import {createFakeInternalApi, json} from "./helpers/fake-internal-api.js";
import type {RecordedRequest} from "./helpers/fake-internal-api.js";

const migrationsFolder = join(import.meta.dirname, "../src/db/migrations");
const START_MS = 1_800_000_000_000;
/** The fake server's key for Home's children, matching upstream's root project id. */
const ROOT = "None";

const PushDataSchema = z.array(
	z.object({
		operations: z.array(z.object({type: z.string(), data: z.record(z.string(), z.unknown())}).loose()).optional(),
	}),
);
const OpDataSchema = z.object({
	projectid: z.string().optional(),
	parentid: z.string().optional(),
	priority: z.number().optional(),
	starting_priority: z.number().optional(),
	project_trees: z.string().optional(),
	projectids_json: z.string().optional(),
});
const TreesSchema = z.array(z.object({id: z.string(), nm: z.string()}).loose());
const IdsSchema = z.array(z.string());

interface ServerNode {
	name: string;
	parent: string;
}

/**
 * One server state behind both fakes: the internal `/push_and_poll` applies
 * ops to it, and the public `/api/v1/nodes*` reads it. Home holds `a,b,c`;
 * `a` holds `x`; `gone` was deleted from slot 1 of Home.
 */
function createServer() {
	const nodes = new Map<string, ServerNode>([
		["a", {name: "a", parent: ROOT}],
		["b", {name: "b", parent: ROOT}],
		["c", {name: "c", parent: ROOT}],
		["x", {name: "x", parent: "a"}],
	]);
	const order = new Map<string, string[]>([
		[ROOT, ["a", "b", "c"]],
		["a", ["x"]],
	]);
	const trash = new Map<string, {node: ServerNode; index: number}>([
		["gone", {node: {name: "gone", parent: ROOT}, index: 1}],
	]);
	const children = (parent: string) => order.get(parent) ?? [];
	const insert = (parent: string, index: number, ids: string[]) => {
		const list = [...children(parent)];
		list.splice(Math.min(index, list.length), 0, ...ids);
		order.set(parent, list);
	};
	const detach = (id: string) => {
		const node = nodes.get(id);
		if (node) {
			order.set(
				node.parent,
				children(node.parent).filter((child) => child !== id),
			);
		}
	};
	const place = (id: string, parent: string) => {
		const node = nodes.get(id) ?? {name: id, parent};
		nodes.set(id, {...node, parent});
	};

	function apply(type: string, rawData: Record<string, unknown>): void {
		const data = OpDataSchema.parse(rawData);
		const parent = data.parentid ?? ROOT;
		if (type === "bulk_create") {
			const trees = TreesSchema.parse(JSON.parse(data.project_trees ?? "[]"));
			for (const tree of trees) {
				nodes.set(tree.id, {name: tree.nm, parent});
			}
			insert(
				parent,
				data.starting_priority ?? 0,
				trees.map((tree) => tree.id),
			);
		} else if (type === "move" && data.projectid !== undefined) {
			detach(data.projectid);
			place(data.projectid, parent);
			insert(parent, data.priority ?? 0, [data.projectid]);
		} else if (type === "bulk_move") {
			const ids = IdsSchema.parse(JSON.parse(data.projectids_json ?? "[]"));
			for (const id of ids) {
				detach(id);
				place(id, parent);
			}
			insert(parent, data.priority ?? 0, ids);
		} else if (type === "undelete" && data.projectid !== undefined) {
			const deleted = trash.get(data.projectid);
			trash.delete(data.projectid);
			nodes.set(data.projectid, {name: deleted?.node.name ?? data.projectid, parent});
			insert(parent, data.priority ?? 0, [data.projectid]);
		}
	}

	function restoreFromTrash(id: string): boolean {
		const deleted = trash.get(id);
		if (!deleted) {
			return false;
		}
		trash.delete(id);
		nodes.set(id, deleted.node);
		insert(deleted.node.parent, deleted.index, [id]);
		return true;
	}

	function toApi(id: string) {
		const node = nodes.get(id);
		if (!node) {
			throw new Error(`no node ${id}`);
		}
		return {
			id,
			name: node.name,
			note: null,
			parent_id: node.parent === ROOT ? null : node.parent,
			priority: children(node.parent).indexOf(id) * 100,
			completed: false,
			createdAt: 0,
			modifiedAt: 0,
			completedAt: null,
		};
	}

	function publicFetch(url: string): Response {
		const path = url.replace("https://workflowy.test/api/v1", "");
		if (path === "/nodes" || path.startsWith("/nodes?")) {
			const parent = new URLSearchParams(path.split("?")[1] ?? "").get("parent_id") ?? ROOT;
			return Response.json({nodes: children(parent).map(toApi)});
		}
		const id = path.split("/")[2] ?? "";
		if (!nodes.has(id)) {
			return Response.json({error: "not found"}, {status: 404});
		}
		return Response.json({node: toApi(id)});
	}

	return {apply, restoreFromTrash, publicFetch};
}

const SERVER_RUN = JSON.stringify({ops: [], client_timestamp: 300_000_000});

function pushedOps(request: RecordedRequest): {type: string; data: Record<string, unknown>}[] {
	const fields = new URLSearchParams(request.body ?? "");
	const trees = PushDataSchema.parse(JSON.parse(fields.get("push_poll_data") ?? "[]"));
	return trees.flatMap((tree) => tree.operations ?? []);
}

function setup() {
	const sqlite = new DatabaseConstructor(":memory:");
	const db = drizzle(sqlite, {schema});
	migrate(db, {migrationsFolder});
	const server = createServer();
	const publicCalls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			publicCalls.push(`${init?.method ?? "GET"} ${url.replace("https://workflowy.test/api/v1", "")}`);
			return Promise.resolve(server.publicFetch(url));
		}),
	);
	const api = createFakeInternalApi();
	const pushes: {type: string; data: Record<string, unknown>}[][] = [];
	api.respond("/push_and_poll", (request) => {
		const ops = pushedOps(request);
		if (ops.length > 0) {
			pushes.push(ops);
		}
		for (const op of ops) {
			server.apply(op.type, op.data);
		}
		return json({
			results: [
				{
					new_most_recent_operation_transaction_id: "4568",
					server_run_operation_transaction_json: SERVER_RUN,
					concurrent_remote_operation_transactions: [],
				},
			],
		});
	});
	const restores: string[] = [];
	const internalFetch: typeof fetch = async (input, init) => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
		const match = /^\/trash\/restore\/([^/]+)\/$/u.exec(url.pathname);
		if (match?.[1] !== undefined && init?.method === "POST") {
			restores.push(match[1]);
			return Promise.resolve(json({succeeded: server.restoreFromTrash(match[1])}));
		}
		return api.fetch(input, init);
	};
	const client = new WorkflowyInternalClient({
		credentials: {username: "alice@example.com", password: "hunter2"},
		fetch: internalFetch,
		baseUrl: "https://workflowy.test",
		transientId: "6f1c1d1e-0000-4000-8000-000000000001",
	});
	const apiClient = new WorkflowyApiClient("test-key", undefined, "https://workflowy.test", {
		maxRetries: 0,
		baseDelayMs: 0,
		maxDelayMs: 0,
	});
	const cacheService = new CacheService(db);
	const writeThrough = new WorkflowyWriteThroughClient(apiClient, cacheService);
	const adapter = new WorkflowyInternalAdapter({
		client,
		db,
		writeThrough,
		now: () => START_MS,
		generateId: () => "new",
		pushAndPoll: {randomId: () => "pollid01", timezone: "America/New_York", sleep: async () => {}},
	});
	const order = (parentId: string | null) => cacheService.getChildren(parentId).map((node) => node.id);
	return {sqlite, api, adapter, writeThrough, cacheService, pushes, restores, publicCalls, order};
}

describe("WorkflowyInternalAdapter tree writes", () => {
	let open: DatabaseConstructor.Database[] = [];
	afterEach(() => {
		for (const sqlite of open) {
			sqlite.close();
		}
		open = [];
		vi.unstubAllGlobals();
	});
	async function tracked() {
		const result = setup();
		open.push(result.sqlite);
		await result.writeThrough.refreshChildren([null, "a"]);
		return result;
	}

	it("creates at an exact index with one bulk_create carrying the client-chosen id, then refreshes Home's order", async () => {
		const {adapter, pushes, order} = await tracked();

		await expect(adapter.createAt({parentId: "home", index: 1, name: ""})).resolves.toStrictEqual({id: "new"});

		expect(pushes).toStrictEqual([
			[
				{
					type: "bulk_create",
					data: {
						parentid: "None",
						starting_priority: 1,
						project_trees: JSON.stringify([{id: "new", nm: "", ct: 300_000_000, cb: 123, ch: []}]),
						isForSearch: false,
					},
					client_timestamp: 300_000_000,
					undo_data: {},
				},
			],
		]);
		expect(order(null)).toStrictEqual(["a", "new", "b", "c"]);
	});

	it("clamps a create index past the end to the fresh sibling count", async () => {
		const {adapter, pushes, order} = await tracked();

		await adapter.createAt({parentId: "a", index: 9, name: "y", note: "n", metadata: {layoutMode: "board"}});

		expect(pushes.map((ops) => ops.map((op) => op.data))).toStrictEqual([
			[
				{
					parentid: "a",
					starting_priority: 1,
					project_trees: JSON.stringify([
						{
							id: "new",
							nm: "y",
							no: "n",
							metadata: {layoutMode: "board"},
							ct: 300_000_000,
							cb: 123,
							ch: [],
						},
					]),
					isForSearch: false,
				},
			],
		]);
		expect(order("a")).toStrictEqual(["x", "new"]);
	});

	it("moves one node to the top with one move at priority 0", async () => {
		const {adapter, pushes, order} = await tracked();

		await adapter.moveTo({ids: ["c"], parentId: "home", index: 0});

		expect(pushes.map((ops) => ops.map((op) => [op.type, op.data]))).toStrictEqual([
			[["move", {projectid: "c", parentid: "None", priority: 0}]],
		]);
		expect(order(null)).toStrictEqual(["c", "a", "b"]);
	});

	it("moves a node down within its parent with the post-removal priority", async () => {
		const {adapter, pushes, order} = await tracked();

		await adapter.moveTo({ids: ["a"], parentId: "home", index: 3});

		expect(pushes.map((ops) => ops.map((op) => [op.type, op.data]))).toStrictEqual([
			[["move", {projectid: "a", parentid: "None", priority: 2}]],
		]);
		expect(order(null)).toStrictEqual(["b", "c", "a"]);
	});

	it("moves several nodes with one bulk_move and refreshes both parents", async () => {
		const {adapter, pushes, order} = await tracked();

		await adapter.moveTo({ids: ["b", "c"], parentId: "x", index: 0});

		expect(pushes.map((ops) => ops.map((op) => [op.type, op.data]))).toStrictEqual([
			[["bulk_move", {projectids_json: JSON.stringify(["b", "c"]), parentid: "x", priority: 0}]],
		]);
		expect({home: order(null), x: order("x")}).toStrictEqual({home: ["a"], x: ["b", "c"]});
	});

	it("restores into a given slot with one undelete", async () => {
		const {adapter, pushes, restores, order} = await tracked();

		await adapter.restore({id: "gone", parentId: "home", index: 0});

		expect({restores, pushes: pushes.map((ops) => ops.map((op) => [op.type, op.data]))}).toStrictEqual({
			restores: [],
			pushes: [[["undelete", {projectid: "gone", parentid: "None", priority: 0}]]],
		});
		expect(order(null)).toStrictEqual(["gone", "a", "b", "c"]);
	});

	it("restores to the original place through /trash/restore when no slot is given", async () => {
		const {adapter, pushes, restores, order} = await tracked();

		await adapter.restore({id: "gone"});

		expect({restores, pushes}).toStrictEqual({restores: ["gone"], pushes: []});
		expect(order(null)).toStrictEqual(["a", "gone", "b", "c"]);
	});

	it("sets node metadata with one edit, and maps home to None", async () => {
		const {adapter, pushes} = await tracked();

		await adapter.setNodeMeta("a", ["layoutMode"], "board");
		await adapter.setNodeMeta("home", ["layoutMode"], "board");

		expect(pushes.map((ops) => ops.map((op) => [op.type, op.data]))).toStrictEqual([
			[
				[
					"edit",
					{
						projectid: "a",
						metadataPatches: [{op: "add", path: ["layoutMode"], value: "board"}],
						metadataInversePatches: [{op: "remove", path: ["layoutMode"]}],
					},
				],
			],
			[
				[
					"edit",
					{
						projectid: "None",
						metadataPatches: [{op: "add", path: ["layoutMode"], value: "board"}],
						metadataInversePatches: [{op: "remove", path: ["layoutMode"]}],
					},
				],
			],
		]);
	});

	it("leaves the cache untouched and reads nothing back when the push is rejected", async () => {
		const {api, adapter, order, publicCalls} = await tracked();
		api.respond("/push_and_poll", () =>
			json({results: [{new_most_recent_operation_transaction_id: "4568", error: "bad op"}]}),
		);
		const callsBefore = publicCalls.length;

		await expect(adapter.moveTo({ids: ["c"], parentId: "home", index: 0})).rejects.toBeInstanceOf(
			OperationRejected,
		);

		expect(order(null)).toStrictEqual(["a", "b", "c"]);
		expect(publicCalls.slice(callsBefore)).toStrictEqual(["GET /nodes/c", "GET /nodes"]);
	});
});
