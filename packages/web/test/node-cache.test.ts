import {QueryClient} from "@tanstack/react-query";
import {describe, expect, it} from "vite-plus/test";
import {
	nodeKeys,
	patchCachedNode,
	readChildren,
	readDetail,
	readItemNode,
	readNode,
	removeFoundDates,
	seedResolvedId,
	spliceBlock,
	spliceChildren,
} from "../src/client/node-cache.js";
import type {NodeResponse} from "../src/node-types.js";

describe("nodeKeys", () => {
	it("builds stable, namespaced keys", () => {
		expect(nodeKeys.all).toStrictEqual(["nodes"]);
		expect(nodeKeys.children("p")).toStrictEqual(["nodes", "children", "p"]);
		expect(nodeKeys.children(null)).toStrictEqual(["nodes", "children", null]);
		expect(nodeKeys.detail("n")).toStrictEqual(["nodes", "detail", "n"]);
		expect(nodeKeys.ancestors("n")).toStrictEqual(["nodes", "ancestors", "n"]);
	});
});

describe("readChildren / readDetail", () => {
	it("reads through the matching key", () => {
		const qc = new QueryClient();
		const kids: NodeResponse[] = [
			{
				id: "a",
				parent_id: "parent",
				name: "a",
				note: null,
				priority: 0,
				data: {layoutMode: null},
				createdAt: null,
				modifiedAt: null,
				completedAt: null,
			},
		];
		qc.setQueryData(nodeKeys.children("parent"), kids);
		qc.setQueryData(nodeKeys.detail("n"), {id: "n"});

		expect(readChildren(qc, "parent")).toBe(kids);
		expect(readDetail(qc, "n")).toStrictEqual({id: "n"});
	});

	it("returns undefined on a cache miss", () => {
		const qc = new QueryClient();
		expect(readChildren(qc, "absent")).toBeUndefined();
		expect(readDetail(qc, "absent")).toBeUndefined();
	});
});

function row(id: string, priority: number): NodeResponse {
	return {
		id,
		parent_id: "p",
		name: id,
		note: null,
		priority,
		data: {layoutMode: null},
		createdAt: null,
		modifiedAt: null,
		completedAt: null,
	};
}

const ids = (rows: NodeResponse[]) => rows.map((r) => r.id);

describe("spliceChildren", () => {
	const abc = [row("a", 100), row("b", 200), row("c", 300)];

	it("moves a row within its parent to a slot counted before removal, without duplicating it", () => {
		expect([
			ids(spliceChildren(abc, abc[0], 2)),
			ids(spliceChildren(abc, abc[0], 1)),
			ids(spliceChildren(abc, abc[2], 0)),
			ids(spliceChildren(abc, abc[0], 3)),
		]).toStrictEqual([
			["b", "a", "c"],
			["a", "b", "c"],
			["c", "a", "b"],
			["b", "c", "a"],
		]);
	});

	it("inserts a new row at the index", () => {
		expect(ids(spliceChildren([row("y", 5), row("z", 9)], row("x", 0), 0))).toStrictEqual(["x", "y", "z"]);
	});

	it("clamps an index past the end", () => {
		expect(ids(spliceChildren(abc, row("x", 0), 9))).toStrictEqual(["a", "b", "c", "x"]);
	});

	it("sorts by priority and renumbers priorities", () => {
		const shuffled = [row("c", 30), row("a", 10), row("b", 20)];
		expect(spliceChildren(shuffled, shuffled[0], 0).map((r) => [r.id, r.priority])).toStrictEqual([
			["c", 100],
			["a", 200],
			["b", 300],
		]);
	});
});

describe("spliceBlock", () => {
	it("removes every moved row then inserts the block contiguously in order", () => {
		const children = [row("d", 1), row("c", 2), row("b", 3), row("a", 4)];
		expect([
			ids(spliceBlock(children, [children[1], children[2]], 4)),
			ids(spliceBlock(children, [children[1], children[2]], 3)),
			ids(spliceBlock(children, [children[1], children[2]], 0)),
		]).toStrictEqual([
			["d", "a", "c", "b"],
			["d", "c", "b", "a"],
			["c", "b", "d", "a"],
		]);
	});
});

describe("patchCachedNode", () => {
	it("patches the node's detail and its row in every cached children list, leaving other rows alone", () => {
		const qc = new QueryClient();
		qc.setQueryData(nodeKeys.children("p"), [row("a", 100), row("b", 200)]);
		qc.setQueryData(nodeKeys.detail("a"), row("a", 100));
		patchCachedNode(qc, "a", (node) => ({...node, name: "alpha"}));
		expect({
			children: qc.getQueryData<NodeResponse[]>(nodeKeys.children("p"))?.map((r) => [r.id, r.name]),
			detail: qc.getQueryData<NodeResponse>(nodeKeys.detail("a"))?.name,
		}).toStrictEqual({
			children: [
				["a", "alpha"],
				["b", "b"],
			],
			detail: "alpha",
		});
	});

	it("returns snapshots that restore every touched entry", () => {
		const qc = new QueryClient();
		qc.setQueryData(nodeKeys.children("p"), [row("a", 100)]);
		const restore = patchCachedNode(qc, "a", (node) => ({...node, name: "alpha"}));
		restore();
		expect(qc.getQueryData<NodeResponse[]>(nodeKeys.children("p"))?.map((r) => r.name)).toStrictEqual(["a"]);
	});
});

describe("readItemNode", () => {
	it("falls back to the cached row while the edited node's fetch is still pending", () => {
		const qc = new QueryClient();
		qc.setQueryData(nodeKeys.children("p"), [row("a", 100), row("b", 200)]);
		expect(readItemNode(qc, "b", undefined)).toStrictEqual(row("b", 200));
	});

	it("prefers the fetched edited node when it is the item", () => {
		const qc = new QueryClient();
		qc.setQueryData(nodeKeys.children("p"), [row("a", 100)]);
		const fetched = {...row("a", 100), name: "fetched"};
		expect(readItemNode(qc, "a", fetched)).toStrictEqual(fetched);
	});

	it("reads the cache when the edited node is another row", () => {
		const qc = new QueryClient();
		qc.setQueryData(nodeKeys.children("p"), [row("a", 100), row("b", 200)]);
		expect(readItemNode(qc, "b", row("a", 100))).toStrictEqual(row("b", 200));
	});

	it("is undefined with no item or an uncached item", () => {
		const qc = new QueryClient();
		expect([readItemNode(qc, undefined, row("a", 100)), readItemNode(qc, "x", undefined)]).toStrictEqual([
			undefined,
			undefined,
		]);
	});
});

describe("Found Dates rows", () => {
	const found = (id: string): NodeResponse => ({...row(id, 1), isMirror: true, originalNodeId: id});

	it("readNode falls back to a cached Found Dates row, read as its original", () => {
		const qc = new QueryClient();
		qc.setQueryData(nodeKeys.foundDates("day"), {items: [{node: found("due"), crumbs: []}]});

		expect({due: readNode(qc, "due"), absent: readNode(qc, "absent")}).toStrictEqual({
			due: {...row("due", 1), isMirror: false, originalNodeId: null},
			absent: undefined,
		});
	});

	it("readNode prefers the node's own row to its Found Dates row", () => {
		const qc = new QueryClient();
		qc.setQueryData(nodeKeys.children("p"), [row("due", 1)]);
		qc.setQueryData(nodeKeys.foundDates("day"), {items: [{node: found("due"), crumbs: []}]});

		expect(readNode(qc, "due")).toStrictEqual(row("due", 1));
	});

	it("removeFoundDates drops the rows from every cached Found Dates list", () => {
		const qc = new QueryClient();
		qc.setQueryData(nodeKeys.foundDates("d1"), {
			items: [
				{node: found("a"), crumbs: []},
				{node: found("b"), crumbs: []},
			],
		});
		qc.setQueryData(nodeKeys.foundDates("d2"), {items: [{node: found("a"), crumbs: []}]});

		removeFoundDates(qc, ["a"]);

		expect({
			d1: qc.getQueryData(nodeKeys.foundDates("d1")),
			d2: qc.getQueryData(nodeKeys.foundDates("d2")),
		}).toStrictEqual({d1: {items: [{node: found("b"), crumbs: []}]}, d2: {items: []}});
	});
});

describe("seedResolvedId", () => {
	it("caches the node's short URL id as resolved, so the hash route zooms without a lookup request", () => {
		const queryClient = new QueryClient();
		seedResolvedId(queryClient, "4823cefa-5fc0-478c-88ac-35035d443bf1");
		expect(queryClient.getQueryData(nodeKeys.resolvedId("35035d443bf1"))).toBe(
			"4823cefa-5fc0-478c-88ac-35035d443bf1",
		);
	});
});
