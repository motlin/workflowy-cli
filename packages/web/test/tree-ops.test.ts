import {QueryClient} from "@tanstack/react-query";
import {describe, expect, it} from "vite-plus/test";
import type {NodeResponse} from "../src/node-types.js";
import {nodeKeys, spliceChildren} from "../src/client/node-cache.js";
import {
	defaultIndexIn,
	dropIndex,
	planAddChild,
	planBackspaceAtStart,
	planDeleteAtEnd,
	planDuplicate,
	planIndent,
	planInsertFirstChild,
	isPotentiallyVisible,
	planInsertSiblingAfter,
	planMoveDown,
	planMoveUp,
	planOutdent,
	planSplit,
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
	node({id: "a", parent_id: "p", priority: 100}),
	node({id: "b", parent_id: "p", priority: 200}),
	node({id: "c", parent_id: "p", priority: 300}),
];

describe("planInsertSiblingAfter / planDuplicate", () => {
	it("inserts an empty sibling at the index after the node", () => {
		const qc = seed({p: siblings});
		expect(planInsertSiblingAfter(qc, siblings[1])).toStrictEqual({parent_id: "p", name: "", index: 2});
	});

	it("counts a completed sibling in the index", () => {
		const done = node({id: "x", parent_id: "p", priority: 150, completedAt: 1});
		const qc = seed({p: [siblings[2], done, siblings[0], siblings[1]]});
		expect(planInsertSiblingAfter(qc, siblings[1])).toStrictEqual({parent_id: "p", name: "", index: 3});
	});

	it("omits the index (bottom) when the siblings are not cached", () => {
		expect(planInsertSiblingAfter(seed({}), siblings[1])).toStrictEqual({parent_id: "p", name: ""});
	});

	it("carries name and note when duplicating", () => {
		const qc = seed({p: siblings});
		const src = node({id: "a", parent_id: "p", priority: 100, name: "Hi", note: "yo"});
		expect(planDuplicate(qc, src)).toStrictEqual({parent_id: "p", name: "Hi", note: "yo", index: 1});
	});
});

describe("planInsertFirstChild", () => {
	it("creates an empty child at index 0 (Enter in the zoom title)", () => {
		expect(planInsertFirstChild("p")).toStrictEqual({parent_id: "p", name: "", index: 0});
	});
});

describe("planIndent", () => {
	it("appends the node last under its previous sibling's cached children", () => {
		const bKids = [node({id: "b1", parent_id: "b", priority: 0}), node({id: "b2", parent_id: "b", priority: 1})];
		const qc = seed({p: siblings, b: bKids});
		expect(planIndent(qc, siblings[2])).toStrictEqual({nodeId: "c", parent_id: "b", index: 2});
	});

	it("uses index 0 when the previous sibling has no children", () => {
		const qc = seed({p: [siblings[0], {...siblings[1], hasChildren: false}, siblings[2]]});
		expect(planIndent(qc, siblings[2])).toStrictEqual({nodeId: "c", parent_id: "b", index: 0});
	});

	it("omits the index (bottom = last) when the previous sibling's children are not cached", () => {
		const qc = seed({p: [siblings[0], {...siblings[1], hasChildren: true}, siblings[2]]});
		expect(planIndent(qc, siblings[2])).toStrictEqual({nodeId: "c", parent_id: "b"});
	});

	it("returns null for the first sibling", () => {
		const qc = seed({p: siblings});
		expect(planIndent(qc, siblings[0])).toBeNull();
	});
});

describe("planOutdent", () => {
	it("moves the node to the slot after its parent among the grandparent's children", () => {
		const parent = node({id: "p", parent_id: "gp", priority: 400});
		const parentSiblings = [
			node({id: "q0", parent_id: "gp", priority: 100}),
			node({id: "q1", parent_id: "gp", priority: 200}),
			node({id: "q2", parent_id: "gp", priority: 300, completedAt: 1}),
			parent,
			node({id: "q4", parent_id: "gp", priority: 500}),
		];
		const qc = seed({gp: parentSiblings, p: siblings}, [parent]);
		expect(planOutdent(qc, siblings[0])).toStrictEqual({nodeId: "a", parent_id: "gp", index: 4});
	});

	it("returns null for a root-level node", () => {
		const qc = seed({});
		expect(planOutdent(qc, node({id: "x", parent_id: null}))).toBeNull();
	});

	it("finds the parent in the zoomed root's cached children when its detail is not cached", () => {
		const parent = node({id: "p", parent_id: "zoom", priority: 100});
		const qc = seed({zoom: [parent, node({id: "q", parent_id: "zoom", priority: 200})], p: siblings});
		expect(planOutdent(qc, siblings[0])).toStrictEqual({nodeId: "a", parent_id: "zoom", index: 1});
	});
});

describe("planMoveUp / planMoveDown", () => {
	it("moves up to the previous sibling's index", () => {
		const qc = seed({p: siblings});
		expect(planMoveUp(qc, siblings[2])).toStrictEqual({nodeId: "c", parent_id: "p", index: 1});
	});
	it("returns null moving up the first sibling", () => {
		expect(planMoveUp(seed({p: siblings}), siblings[0])).toBeNull();
	});
	it("moves down past the next sibling (slot counted before removal, like the move endpoint)", () => {
		const qc = seed({p: siblings});
		expect(planMoveDown(qc, siblings[0])).toStrictEqual({nodeId: "a", parent_id: "p", index: 2});
	});
	it("swaps with the neighbour when the plan is spliced into the cache", () => {
		const qc = seed({p: siblings});
		const down = planMoveDown(qc, siblings[1]);
		const up = planMoveUp(qc, siblings[1]);
		expect([
			spliceChildren(siblings, siblings[1], down?.index ?? -1).map((child) => child.id),
			spliceChildren(siblings, siblings[1], up?.index ?? -1).map((child) => child.id),
		]).toStrictEqual([
			["a", "c", "b"],
			["b", "a", "c"],
		]);
	});
	it("returns null moving down the last sibling", () => {
		expect(planMoveDown(seed({p: siblings}), siblings[2])).toBeNull();
	});
});

describe("defaultIndexIn", () => {
	it("is the top without defaultToBottom", () => {
		expect([defaultIndexIn({defaultToBottom: false}, 3), defaultIndexIn({}, 3)]).toStrictEqual([0, 0]);
	});

	it("is the child count with defaultToBottom", () => {
		expect(defaultIndexIn({defaultToBottom: true}, 3)).toBe(3);
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

describe("planSplit", () => {
	const base = {
		id: "n",
		parent_id: "p",
		index: 4,
		layoutMode: null,
		hasVisibleChildren: false,
		isExpanded: false,
		isZoomRoot: false,
		isEmpty: false,
		hasNextSibling: true,
		canOutdent: true,
	};

	it("puts the text before a mid caret in a new row above and keeps the rest in the current row", () => {
		expect(planSplit({node: base, html: "Bravo text", selection: {start: 5, end: 5}})).toStrictEqual({
			kind: "create",
			parentId: "p",
			index: 4,
			newName: "Bravo",
			currentName: " text",
			focus: "current",
			layoutMode: null,
		});
	});

	it("creates an empty row after when the caret is at the end", () => {
		expect(planSplit({node: base, html: "Bravo text", selection: {start: 10, end: 10}})).toStrictEqual({
			kind: "create",
			parentId: "p",
			index: 5,
			newName: "",
			currentName: "Bravo text",
			focus: "new",
			layoutMode: null,
		});
	});

	it("treats a caret inside trailing whitespace as the end", () => {
		expect(planSplit({node: base, html: "Bravo&nbsp; ", selection: {start: 5, end: 5}})).toStrictEqual({
			kind: "create",
			parentId: "p",
			index: 5,
			newName: "&nbsp; ",
			currentName: "Bravo",
			focus: "new",
			layoutMode: null,
		});
	});

	it("creates an empty row above when the caret is at the start of a non-empty row", () => {
		expect(planSplit({node: base, html: "Bravo text", selection: {start: 0, end: 0}})).toStrictEqual({
			kind: "create",
			parentId: "p",
			index: 4,
			newName: "",
			currentName: "Bravo text",
			focus: "new",
			layoutMode: null,
		});
	});

	it("drops a selection and splits around it", () => {
		expect(planSplit({node: base, html: "XyCharlie", selection: {start: 1, end: 3}})).toStrictEqual({
			kind: "create",
			parentId: "p",
			index: 4,
			newName: "X",
			currentName: "harlie",
			focus: "current",
			layoutMode: null,
		});
	});

	it("creates the first child of an expanded row with visible children when the caret is at the end", () => {
		expect(
			planSplit({
				node: {...base, hasVisibleChildren: true, isExpanded: true},
				html: "Bravo text",
				selection: {start: 10, end: 10},
			}),
		).toStrictEqual({
			kind: "create",
			parentId: "n",
			index: 0,
			newName: "",
			currentName: "Bravo text",
			focus: "new",
			layoutMode: null,
		});
	});

	it("creates an empty first child of the zoom root and keeps its full text", () => {
		expect(
			planSplit({node: {...base, isZoomRoot: true}, html: "<b>Bravo</b> text", selection: {start: 3, end: 3}}),
		).toStrictEqual({
			kind: "create",
			parentId: "n",
			index: 0,
			newName: "",
			currentName: "<b>Bravo</b> text",
			focus: "new",
			layoutMode: null,
		});
	});

	it("outdents an empty last child instead of creating a row", () => {
		expect(
			planSplit({node: {...base, isEmpty: true, hasNextSibling: false}, html: "", selection: {start: 0, end: 0}}),
		).toStrictEqual({kind: "outdent"});
	});

	it("creates a row after an empty row that has a next sibling", () => {
		expect(planSplit({node: {...base, isEmpty: true}, html: "", selection: {start: 0, end: 0}})).toStrictEqual({
			kind: "create",
			parentId: "p",
			index: 5,
			newName: "",
			currentName: "",
			focus: "new",
			layoutMode: null,
		});
	});

	it("creates a row after an empty last child that cannot outdent", () => {
		expect(
			planSplit({
				node: {...base, isEmpty: true, hasNextSibling: false, canOutdent: false},
				html: "",
				selection: {start: 0, end: 0},
			}),
		).toStrictEqual({
			kind: "create",
			parentId: "p",
			index: 5,
			newName: "",
			currentName: "",
			focus: "new",
			layoutMode: null,
		});
	});

	it("inherits a todo layout", () => {
		expect(
			planSplit({node: {...base, layoutMode: "todo"}, html: "Bravo text", selection: {start: 10, end: 10}}),
		).toStrictEqual({
			kind: "create",
			parentId: "p",
			index: 5,
			newName: "",
			currentName: "Bravo text",
			focus: "new",
			layoutMode: "todo",
		});
	});

	it("does not inherit a bullets layout", () => {
		expect(
			planSplit({node: {...base, layoutMode: "bullets"}, html: "Bravo text", selection: {start: 10, end: 10}}),
		).toStrictEqual({
			kind: "create",
			parentId: "p",
			index: 5,
			newName: "",
			currentName: "Bravo text",
			focus: "new",
			layoutMode: null,
		});
	});
});

describe("planBackspaceAtStart / planDeleteAtEnd", () => {
	const row = {html: "", hasChildren: false, hasNote: false, completed: false, isMirror: false, layoutMode: null};
	const current = {...row, id: "cur", html: " text"};
	const bravo = {...row, id: "bravo", html: "Bravo"};

	it("merges the previous sibling's text into the start of the current row", () => {
		expect(planBackspaceAtStart({current, previousSibling: bravo})).toStrictEqual({
			kind: "merge",
			keepId: "cur",
			deleteId: "bravo",
			name: "Bravo text",
			caret: 5,
		});
	});

	it("refuses when the previous sibling has a note", () => {
		expect(planBackspaceAtStart({current, previousSibling: {...bravo, hasNote: true}})).toStrictEqual({
			kind: "none",
		});
	});

	it("refuses when the previous row is the parent (no previous sibling)", () => {
		expect(planBackspaceAtStart({current, previousSibling: null})).toStrictEqual({kind: "none"});
	});

	it("refuses when the previous sibling is completed", () => {
		expect(planBackspaceAtStart({current, previousSibling: {...bravo, completed: true}})).toStrictEqual({
			kind: "none",
		});
	});

	it("refuses when the previous sibling has children, a mirror, a board, or a different layout", () => {
		expect(
			[
				{...bravo, hasChildren: true},
				{...bravo, isMirror: true},
				{...bravo, layoutMode: "board"},
				{...bravo, layoutMode: "todo"},
			].map((previousSibling) => planBackspaceAtStart({current, previousSibling})),
		).toStrictEqual([{kind: "none"}, {kind: "none"}, {kind: "none"}, {kind: "none"}]);
	});

	it("merges two todo rows", () => {
		expect(
			planBackspaceAtStart({
				current: {...current, layoutMode: "todo"},
				previousSibling: {...bravo, layoutMode: "todo"},
			}),
		).toStrictEqual({kind: "merge", keepId: "cur", deleteId: "bravo", name: "Bravo text", caret: 5});
	});

	it("merges the current row into the start of the next sibling, which keeps its id", () => {
		expect(
			planDeleteAtEnd({
				current: {...row, id: "bravo", html: "Bravo text"},
				nextSibling: {...row, id: "alpha", html: "Alpha", hasChildren: true},
			}),
		).toStrictEqual({kind: "merge", keepId: "alpha", deleteId: "bravo", name: "Bravo textAlpha", caret: 10});
	});

	it("refuses Delete at the end when the current row is completed", () => {
		expect(
			planDeleteAtEnd({
				current: {...row, id: "bravo", html: "Bravo text", completed: true},
				nextSibling: {...row, id: "alpha", html: "Alpha"},
			}),
		).toStrictEqual({kind: "none"});
	});

	it("refuses Delete at the end of the last sibling", () => {
		expect(planDeleteAtEnd({current: {...row, id: "bravo", html: "Bravo"}, nextSibling: null})).toStrictEqual({
			kind: "none",
		});
	});
});

describe("dropIndex", () => {
	it("indexes the target among all siblings, the dragged row included", () => {
		expect([
			dropIndex(siblings, "b", "below"),
			dropIndex(siblings, "a", "above"),
			dropIndex(siblings, "c", "above"),
			dropIndex(siblings, "c", "below"),
		]).toStrictEqual([2, 0, 2, 3]);
	});

	it("lands a same-parent drag exactly next to the target when spliced", () => {
		expect([
			spliceChildren(siblings, siblings[0], dropIndex(siblings, "b", "below")).map((child) => child.id),
			spliceChildren(siblings, siblings[0], dropIndex(siblings, "c", "above")).map((child) => child.id),
			spliceChildren(siblings, siblings[2], dropIndex(siblings, "a", "below")).map((child) => child.id),
		]).toStrictEqual([
			["b", "a", "c"],
			["b", "a", "c"],
			["a", "c", "b"],
		]);
	});

	it("indexes a row dragged in from another parent the same way", () => {
		expect(dropIndex(siblings, "b", "below")).toBe(2);
	});

	it("orders siblings by priority", () => {
		expect(dropIndex([siblings[2], siblings[1], siblings[0]], "a", "above")).toBe(0);
	});
});
