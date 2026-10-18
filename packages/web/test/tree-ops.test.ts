import {QueryClient} from "@tanstack/react-query";
import {describe, expect, it} from "vite-plus/test";
import type {NodeResponse} from "../src/node-types.js";
import {nodeKeys} from "../src/client/node-cache.js";
import {
	planAddChild,
	planDuplicate,
	planIndent,
	planInsertFirstChild,
	isPotentiallyVisible,
	planInsertSiblingAfter,
	planMoveDown,
	planMoveUp,
	planOutdent,
	planToggleComplete,
} from "../src/client/tree-ops.js";

function node(partial: Partial<NodeResponse> & {id: string}): NodeResponse {
	return {
		parent_id: null,
		name: null,
		note: null,
		priority: 0,
		data: {layoutMode: null},
		createdAt: null,
		modifiedAt: null,
		completedAt: null,
		...partial,
	};
}

function seed(children: Record<string, NodeResponse[]>, details: NodeResponse[] = []): QueryClient {
	const qc = new QueryClient();
	for (const [parentId, kids] of Object.entries(children)) {
		qc.setQueryData(nodeKeys.children(parentId === "root" ? null : parentId), kids);
	}
	for (const d of details) {
		qc.setQueryData(nodeKeys.detail(d.id), d);
	}
	return qc;
}

const siblings = [
	node({id: "a", parent_id: "p", priority: 0}),
	node({id: "b", parent_id: "p", priority: 100}),
	node({id: "c", parent_id: "p", priority: 200}),
];

describe("planInsertSiblingAfter / planDuplicate", () => {
	it("inserts an empty sibling at the midpoint after the node", () => {
		const qc = seed({p: siblings});
		expect(planInsertSiblingAfter(qc, siblings[0])).toStrictEqual({parent_id: "p", name: "", position: 50});
	});

	it("steps +100 past the last sibling", () => {
		const qc = seed({p: siblings});
		expect(planInsertSiblingAfter(qc, siblings[2])).toStrictEqual({parent_id: "p", name: "", position: 300});
	});

	it("carries name and note when duplicating", () => {
		const qc = seed({p: siblings});
		const src = node({id: "a", parent_id: "p", priority: 0, name: "Hi", note: "yo"});
		expect(planDuplicate(qc, src)).toStrictEqual({parent_id: "p", name: "Hi", note: "yo", position: 50});
	});
});

describe("planInsertFirstChild", () => {
	it("prepends an empty child below the first child's priority (Enter in the zoom title)", () => {
		const qc = seed({p: siblings});
		expect(planInsertFirstChild(qc, "p")).toStrictEqual({parent_id: "p", name: "", position: -100});
	});

	it("stays negative so the server places it at the top when the first child sits above zero", () => {
		const qc = seed({p: [node({id: "a", parent_id: "p", priority: 150})]});
		expect(planInsertFirstChild(qc, "p")).toStrictEqual({parent_id: "p", name: "", position: -100});
	});

	it("goes below a negative first child", () => {
		const qc = seed({p: [node({id: "a", parent_id: "p", priority: -300})]});
		expect(planInsertFirstChild(qc, "p")).toStrictEqual({parent_id: "p", name: "", position: -400});
	});
});

describe("planIndent", () => {
	it("moves the node under its previous sibling", () => {
		const qc = seed({p: siblings});
		expect(planIndent(qc, siblings[1])).toStrictEqual({nodeId: "b", parent_id: "a"});
	});

	it("returns null for the first sibling", () => {
		const qc = seed({p: siblings});
		expect(planIndent(qc, siblings[0])).toBeNull();
	});
});

describe("planOutdent", () => {
	it("positions the node after its parent among the grandparent children", () => {
		const parent = node({id: "p", parent_id: "gp", priority: 100});
		const parentSiblings = [
			node({id: "p", parent_id: "gp", priority: 100}),
			node({id: "q", parent_id: "gp", priority: 200}),
		];
		const qc = seed({gp: parentSiblings, p: siblings}, [parent]);
		expect(planOutdent(qc, siblings[0])).toStrictEqual({nodeId: "a", parent_id: "gp", position: 150});
	});

	it("returns null for a root-level node", () => {
		const qc = seed({});
		expect(planOutdent(qc, node({id: "x", parent_id: null}))).toBeNull();
	});
});

describe("planMoveUp / planMoveDown", () => {
	it("moves up before the previous sibling", () => {
		const qc = seed({p: siblings});
		expect(planMoveUp(qc, siblings[2])).toStrictEqual({nodeId: "c", parent_id: "p", position: 50});
	});
	it("returns null moving up the first sibling", () => {
		expect(planMoveUp(seed({p: siblings}), siblings[0])).toBeNull();
	});
	it("moves down after the next sibling", () => {
		const qc = seed({p: siblings});
		expect(planMoveDown(qc, siblings[0])).toStrictEqual({nodeId: "a", parent_id: "p", position: 150});
	});
	it("returns null moving down the last sibling", () => {
		expect(planMoveDown(seed({p: siblings}), siblings[2])).toBeNull();
	});
});

describe("planAddChild", () => {
	it("appends an empty last child that inherits a todo layout from the previous visible row", () => {
		expect(planAddChild({childCount: 3, zoomedId: "z", prevVisibleLayout: "todo"})).toStrictEqual({
			parent_id: "z",
			index: 3,
			name: "",
			layoutMode: "todo",
		});
	});

	it("leaves the layout unset after a bullets row", () => {
		expect(planAddChild({childCount: 3, zoomedId: "z", prevVisibleLayout: "bullets"})).toStrictEqual({
			parent_id: "z",
			index: 3,
			name: "",
			layoutMode: null,
		});
	});
});

describe("planToggleComplete", () => {
	it("completes every item when any item is not completed", () => {
		expect(
			planToggleComplete([
				{id: "a", completedAt: null},
				{id: "b", completedAt: 123},
			]),
		).toStrictEqual({action: "complete", ids: ["a", "b"]});
	});

	it("uncompletes every item when all items are completed", () => {
		expect(
			planToggleComplete([
				{id: "a", completedAt: 1},
				{id: "b", completedAt: 2},
			]),
		).toStrictEqual({action: "uncomplete", ids: ["a", "b"]});
	});

	it("does nothing for an empty list", () => {
		expect(planToggleComplete([])).toStrictEqual({action: "none", ids: []});
	});
});

describe("isPotentiallyVisible", () => {
	it("keeps a completed row that is animating its completion while completed rows are hidden", () => {
		expect(isPotentiallyVisible({id: "c", completedAt: 1}, false, new Set(["c"]))).toBe(true);
	});

	it("hides a completed row that is not animating while completed rows are hidden", () => {
		expect(isPotentiallyVisible({id: "c", completedAt: 1}, false, new Set())).toBe(false);
	});

	it("shows a completed row when completed rows are shown", () => {
		expect(isPotentiallyVisible({id: "c", completedAt: 1}, true, new Set())).toBe(true);
	});

	it("shows an open row while completed rows are hidden", () => {
		expect(isPotentiallyVisible({id: "o", completedAt: null}, false, new Set())).toBe(true);
	});
});
