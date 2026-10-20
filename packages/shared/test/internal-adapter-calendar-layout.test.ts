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
import {calendarLayoutWrites, layoutWriteParents} from "../src/internal/calendar-layout-apply.js";
import {CalendarWeekUnsupported} from "../src/internal/calendar-layout.js";
import {applyMetadataPatches} from "../src/internal/metadata-patch.js";
import type {MetadataPatch} from "../src/internal/metadata-patch.js";
import {createFakeInternalApi, json} from "./helpers/fake-internal-api.js";
import type {RecordedRequest} from "./helpers/fake-internal-api.js";

const migrationsFolder = join(import.meta.dirname, "../src/db/migrations");
const ROOT = "None";
const SANDBOX = "aaaaaaaa-0000-4000-8000-000000000000";
const CAL = "aaaaaaaa-0000-4000-8000-000000000001";
const Y2026 = "aaaaaaaa-0000-4000-8000-000000000002";
const M10 = "aaaaaaaa-0000-4000-8000-000000000003";
const D1019 = "aaaaaaaa-0000-4000-8000-000000000004";
const D1020 = "aaaaaaaa-0000-4000-8000-000000000005";
const ENTRY = "aaaaaaaa-0000-4000-8000-000000000006";
const TIMED = "aaaaaaaa-0000-4000-8000-000000000007";
const NOTES = "aaaaaaaa-0000-4000-8000-000000000008";
const NEW1 = "00000000-0000-4000-8000-000000000001";

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
	metadataPatches: z.array(z.custom<MetadataPatch>()).optional(),
});
const TreesSchema = z.array(
	z.object({id: z.string(), nm: z.string(), metadata: z.record(z.string(), z.unknown()).optional()}).loose(),
);

interface ServerNode {
	name: string;
	parent: string;
	metadata: Record<string, unknown>;
}

/** One server state behind both fakes: `/push_and_poll` applies ops, `/get_tree_data/` and `/api/v1/nodes*` read it. */
function createServer(initial: [string, ServerNode][]) {
	const nodes = new Map(initial);
	const trash = new Map<string, ServerNode>();
	const order = new Map<string, string[]>();
	for (const [id, node] of initial) {
		order.set(node.parent, [...(order.get(node.parent) ?? []), id]);
	}
	const children = (parent: string) => order.get(parent) ?? [];
	const insert = (parent: string, index: number, ids: string[]) => {
		const list = [...children(parent)];
		list.splice(index, 0, ...ids);
		order.set(parent, list);
	};
	const remove = (id: string, parent: string) => {
		order.set(
			parent,
			children(parent).filter((child) => child !== id),
		);
	};

	function apply(type: string, rawData: Record<string, unknown>): void {
		const data = OpDataSchema.parse(rawData);
		const id = data.projectid ?? "";
		const node = nodes.get(id);
		if (type === "bulk_create") {
			const parent = data.parentid ?? ROOT;
			const trees = TreesSchema.parse(JSON.parse(data.project_trees ?? "[]"));
			for (const tree of trees) {
				if (nodes.has(tree.id)) {
					throw new Error(`duplicate id ${tree.id}`);
				}
				nodes.set(tree.id, {name: tree.nm, parent, metadata: tree.metadata ?? {}});
			}
			insert(
				parent,
				data.starting_priority ?? 0,
				trees.map((tree) => tree.id),
			);
		} else if (type === "move" && node) {
			remove(id, node.parent);
			node.parent = data.parentid ?? ROOT;
			insert(node.parent, data.priority ?? 0, [id]);
		} else if (type === "delete" && node) {
			if (children(id).length > 0) {
				throw new Error(`deleting non-empty ${id}`);
			}
			remove(id, node.parent);
			nodes.delete(id);
			trash.set(id, node);
		} else if (type === "undelete") {
			const restored = trash.get(id);
			if (restored) {
				const parent = data.parentid ?? ROOT;
				nodes.set(id, {...restored, parent});
				trash.delete(id);
				insert(parent, data.priority ?? 0, [id]);
			}
		} else if (type === "edit" && node) {
			node.metadata = applyMetadataPatches(node.metadata, data.metadataPatches ?? []);
		} else {
			throw new Error(`unexpected ${type} of ${id}`);
		}
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
			if (parent !== ROOT && !nodes.has(parent)) {
				return Response.json({code: "not_found", message: "Parent item not found"}, {status: 404});
			}
			return Response.json({nodes: children(parent).map(toApi)});
		}
		const id = path.split("/")[2] ?? "";
		if (!nodes.has(id)) {
			return Response.json({error: "not found"}, {status: 404});
		}
		return Response.json({node: toApi(id)});
	}

	/** The subtree under `id` as `{name: children}` outlines, for whole-tree assertions. */
	function outline(id: string): unknown[] {
		return children(id).map((child) => {
			const name = nodes.get(child)?.name ?? "?";
			const below = outline(child);
			return below.length === 0 ? name : {[name]: below};
		});
	}

	const treeData = () => [...nodes].map(([id, node]) => ({id, metadata: node.metadata}));
	return {apply, publicFetch, treeData, outline, nodes};
}

const SERVER_RUN = JSON.stringify({ops: [], client_timestamp: 300_000_000});

function pushedOps(request: RecordedRequest): {type: string; data: Record<string, unknown>}[] {
	const fields = new URLSearchParams(request.body ?? "");
	const trees = PushDataSchema.parse(JSON.parse(fields.get("push_poll_data") ?? "[]"));
	return trees.flatMap((tree) => tree.operations ?? []);
}

const node = (name: string, parent: string, metadata: Record<string, unknown> = {}): ServerNode => ({
	name,
	parent,
	metadata,
});
const time = (day: number, hour?: number) =>
	`<time startYear="2026" startMonth="10" startDay="${day}"${hour === undefined ? "" : ` startHour="${hour}" startMinute="0"`}>x</time>`;
const level = (name: string, dateId: number) => ({calendar: {level: name, dateId}});

/** A calendar copy in a sandbox: 2026 > 10 > 19 (one entry), 20 (one entry), plus a timed node and notes at its root. */
const CALENDAR: [string, ServerNode][] = [
	[SANDBOX, node("🧪 Sync", ROOT)],
	[CAL, node("📆 Calendar copy", SANDBOX)],
	[Y2026, node("2026", CAL, level("year", 20_260_000))],
	[TIMED, node(`Standup ${time(20, 10)}`, CAL)],
	[NOTES, node("Notes", CAL)],
	[M10, node("10", Y2026, level("month", 20_261_000))],
	[D1019, node(time(19), M10, level("day", 20_261_019))],
	[D1020, node(time(20), M10, level("day", 20_261_020))],
	[ENTRY, node("entry", D1020)],
];

async function setup(initial: [string, ServerNode][]) {
	const sqlite = new DatabaseConstructor(":memory:");
	const db = drizzle(sqlite, {schema});
	migrate(db, {migrationsFolder});
	const server = createServer(initial);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => Promise.resolve(server.publicFetch(url))),
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
	api.respond("/get_tree_data/", () =>
		json({
			items: server.treeData(),
			shared_projects: {},
			most_recent_operation_transaction_id: "9999",
			server_expanded_projects_list: [],
		}),
	);
	const client = new WorkflowyInternalClient({
		credentials: {username: "alice@example.com", password: "hunter2"},
		fetch: api.fetch,
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
	let next = 0;
	const adapter = new WorkflowyInternalAdapter({
		client,
		db,
		writeThrough,
		now: () => 1_800_000_000_000,
		generateId: () => `00000000-0000-4000-8000-00000000000${++next}`,
		pushAndPoll: {randomId: () => "pollid01", timezone: "America/New_York", sleep: async () => {}},
	});
	const parents = [...new Set(initial.map(([, value]) => value.parent))];
	await writeThrough.refreshChildren(parents.map((parent) => (parent === ROOT ? null : parent)));
	const cachedOutline = (id: string): unknown[] =>
		cacheService.getChildren(id).map((child) => {
			const below = cachedOutline(child.id);
			return below.length === 0 ? child.name : {[child.name ?? ""]: below};
		});
	return {sqlite, adapter, pushes, server, cachedOutline};
}

const ORIGINAL_OUTLINE = [{"2026": [{"10": [time(19), {[time(20)]: ["entry"]}]}]}, `Standup ${time(20, 10)}`, "Notes"];

describe("calendarLayoutWrites", () => {
	it("patches metadata against fresh metadata and inverts every write, last first", () => {
		const {writes, undo, touchedParents} = calendarLayoutWrites(
			[
				{op: "set-calendar", id: "n", calendar: null},
				{op: "move", id: "a", parentId: "p", index: 3, from: {parentId: "p", index: 0}},
				{op: "move", id: "b", parentId: "q", index: 0, from: {parentId: "p", index: 1}},
				{op: "delete", id: "m", from: {parentId: "y", index: 2}},
				{op: "set-levels", id: "cal", levels: {year: true, day: true}},
			],
			new Map([
				["n", {calendar: {level: "day", dateId: 1}, other: 1}],
				["cal", {calendar: {root: true, levels: {year: true, month: true, day: true}}}],
			]),
		);
		expect({writes, undo, touchedParents}).toStrictEqual({
			writes: [
				{
					op: "edit",
					id: "n",
					patches: [{op: "remove", path: ["calendar"]}],
					inverse: [{op: "add", path: ["calendar"], value: {level: "day", dateId: 1}}],
				},
				{op: "move", id: "a", parentId: "p", index: 3, from: {parentId: "p", index: 0}},
				{op: "move", id: "b", parentId: "q", index: 0, from: {parentId: "p", index: 1}},
				{op: "delete", id: "m", from: {parentId: "y", index: 2}},
				{
					op: "edit",
					id: "cal",
					patches: [{op: "replace", path: ["calendar", "levels"], value: {year: true, day: true}}],
					inverse: [
						{op: "replace", path: ["calendar", "levels"], value: {year: true, month: true, day: true}},
					],
				},
			],
			undo: [
				{
					op: "edit",
					id: "cal",
					patches: [
						{op: "replace", path: ["calendar", "levels"], value: {year: true, month: true, day: true}},
					],
					inverse: [{op: "replace", path: ["calendar", "levels"], value: {year: true, day: true}}],
				},
				{op: "undelete", id: "m", parentId: "y", index: 2},
				{op: "move", id: "b", parentId: "p", index: 1, from: {parentId: "q", index: 0}},
				{op: "move", id: "a", parentId: "p", index: 0, from: {parentId: "p", index: 2}},
				{
					op: "edit",
					id: "n",
					patches: [{op: "add", path: ["calendar"], value: {level: "day", dateId: 1}}],
					inverse: [{op: "remove", path: ["calendar"]}],
				},
			],
			touchedParents: ["p", "q", "y"],
		});
	});
});

describe("layoutWriteParents", () => {
	it("leaves out parents the writes delete, unless a later write brings them back", () => {
		expect([
			layoutWriteParents([
				{op: "move", id: "d", parentId: "y", index: 0, from: {parentId: "m", index: 0}},
				{op: "delete", id: "m", from: {parentId: "y", index: 1}},
			]),
			layoutWriteParents([
				{op: "undelete", id: "m", parentId: "y", index: 1},
				{op: "move", id: "d", parentId: "m", index: 0, from: {parentId: "y", index: 0}},
			]),
		]).toStrictEqual([["y"], ["y", "m"]]);
	});
});

describe("WorkflowyInternalAdapter.applyCalendarLayout", () => {
	let open: DatabaseConstructor.Database[] = [];
	afterEach(() => {
		for (const sqlite of open) {
			sqlite.close();
		}
		open = [];
		vi.unstubAllGlobals();
	});
	async function tracked(initial: [string, ServerNode][]) {
		const result = await setup(initial);
		open.push(result.sqlite);
		return result;
	}

	it("restructures an explicit calendar root in one push, refreshes the cache, and undoes it", async () => {
		const {adapter, pushes, server, cachedOutline} = await tracked(CALENDAR);

		const applied = await adapter.applyCalendarLayout({year: true, month: false, day: true}, {rootId: CAL});
		const after = {
			result: applied,
			pushed: pushes.map((ops) => ops.map((op) => `${op.type} ${z.string().parse(op.data.projectid)}`)),
			server: server.outline(CAL),
			cache: cachedOutline(CAL),
			levels: server.nodes.get(CAL)?.metadata,
		};
		const undone = await adapter.undoCalendarLayout();
		const undoneAgain = await adapter.undoCalendarLayout();

		expect({
			after,
			undone,
			undoneAgain,
			server: server.outline(CAL),
			cache: cachedOutline(CAL),
			levels: server.nodes.get(CAL)?.metadata,
		}).toStrictEqual({
			after: {
				result: {rootId: CAL, writes: 5},
				pushed: [[`edit ${CAL}`, `move ${D1019}`, `move ${D1020}`, `move ${TIMED}`, `delete ${M10}`]],
				server: [{"2026": [time(19), {[time(20)]: ["entry", `Standup ${time(20, 10)}`]}]}, "Notes"],
				cache: [{"2026": [time(19), {[time(20)]: ["entry", `Standup ${time(20, 10)}`]}]}, "Notes"],
				levels: {calendar: {levels: {year: true, day: true}}},
			},
			undone: {rootId: CAL, writes: 5},
			undoneAgain: undefined,
			server: ORIGINAL_OUTLINE,
			cache: ORIGINAL_OUTLINE,
			levels: {},
		});
	});

	it("creates level nodes with generated ids under an explicit root, never the account's deterministic ids", async () => {
		const {adapter, server, cachedOutline} = await tracked([
			[SANDBOX, node("🧪 Sync", ROOT)],
			[CAL, node("📆 Calendar copy", SANDBOX, {calendar: {levels: {day: true}}})],
			[D1019, node(time(19), CAL, level("day", 20_261_019))],
		]);

		const applied = await adapter.applyCalendarLayout({year: true, month: false, day: true}, {rootId: CAL});

		expect({
			applied,
			server: server.outline(CAL),
			cache: cachedOutline(CAL),
			created: server.nodes.get(NEW1),
		}).toStrictEqual({
			applied: {rootId: CAL, writes: 3},
			server: [{"2026": [time(19)]}],
			cache: [{"2026": [time(19)]}],
			created: node("2026", CAL, {
				restorableUniqueNode: true,
				calendar: {level: "year", value: "2026", timestamp: new Date(2026, 0, 1).getTime(), dateId: 20_260_000},
			}),
		});
	});

	it("pushes nothing when the layout is already in place, and rejects week levels", async () => {
		const {adapter, pushes} = await tracked([
			[SANDBOX, node("🧪 Sync", ROOT)],
			[CAL, node("📆 Calendar copy", SANDBOX, {calendar: {levels: {day: true}}})],
			[D1019, node(time(19), CAL, level("day", 20_261_019))],
		]);

		const applied = await adapter.applyCalendarLayout({day: true}, {rootId: CAL});

		expect({applied, pushes, undo: await adapter.undoCalendarLayout()}).toStrictEqual({
			applied: {rootId: CAL, writes: 0},
			pushes: [],
			undo: undefined,
		});
		await expect(adapter.applyCalendarLayout({week: true, day: true}, {rootId: CAL})).rejects.toThrow(
			CalendarWeekUnsupported,
		);
	});
});
