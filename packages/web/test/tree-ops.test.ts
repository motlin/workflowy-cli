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
	planOutdent,
	planSplit,
	planToggleComplete,
	planVerticalMove,
	cacheMoveTree,
} from "../src/client/tree-ops.js";
import type {VerticalMoveTree} from "../src/client/tree-ops.js";

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

interface Row {
	id: string;
	children?: Row[];
	expanded?: boolean;
	hidden?: boolean;
}

/** A `VerticalMoveTree` over nested rows under an implicit root (`null`). */
function rowTree(rows: Row[]): VerticalMoveTree {
	const parents = new Map<string, string | null>();
	const children = new Map<string | null, string[]>();
	const expanded = new Set<string>();
	const hidden = new Set<string>();
	const walk = (parentId: string | null, list: Row[]): void => {
		children.set(
			parentId,
			list.map((row) => row.id),
		);
		for (const row of list) {
			parents.set(row.id, parentId);
			if (row.expanded === true) {
				expanded.add(row.id);
			}
			if (row.hidden === true) {
				hidden.add(row.id);
			}
			walk(row.id, row.children ?? []);
		}
	};
	walk(null, rows);
	return {
		parentOf: (id) => parents.get(id) ?? null,
		childrenOf: (id) => children.get(id) ?? [],
		isExpanded: (id) => expanded.has(id),
		isVisible: (id) => !hidden.has(id),
	};
}

describe("planVerticalMove", () => {
	const delta = (expanded = false): Row => ({id: "delta", expanded, children: [{id: "d1"}]});
	const bravo: Row = {id: "bravo", expanded: true, children: [{id: "b1"}, {id: "b2"}]};
	const alpha = (expanded: boolean): Row => ({id: "alpha", expanded, children: [{id: "a1"}, {id: "a2"}]});

	it("moves the first child up to the end of an open uncle", () => {
		const tree = rowTree([delta(), {id: "charlie"}, bravo, alpha(true)]);
		expect(planVerticalMove({nodeId: "a1", direction: "up", zoomRootId: null, tree})).toStrictEqual({
			nodeId: "a1",
			parentId: "bravo",
			index: 2,
			expandParentId: null,
		});
	});
	it("moves the first child up to the top of a collapsed uncle and expands it", () => {
		const tree = rowTree([delta(), {id: "charlie", expanded: true, children: [{id: "c1"}]}]);
		expect(planVerticalMove({nodeId: "c1", direction: "up", zoomRootId: null, tree})).toStrictEqual({
			nodeId: "c1",
			parentId: "delta",
			index: 0,
			expandParentId: "delta",
		});
	});
	it("moves the first child up into a leaf uncle and expands it", () => {
		const tree = rowTree([delta(), {id: "charlie"}, bravo, alpha(true)]);
		expect(planVerticalMove({nodeId: "b1", direction: "up", zoomRootId: null, tree})).toStrictEqual({
			nodeId: "b1",
			parentId: "charlie",
			index: 0,
			expandParentId: "charlie",
		});
	});
	it("moves the last child down to the top of a leaf uncle", () => {
		const tree = rowTree([delta(true), {id: "charlie"}, bravo, alpha(false)]);
		expect(planVerticalMove({nodeId: "d1", direction: "down", zoomRootId: null, tree})).toStrictEqual({
			nodeId: "d1",
			parentId: "charlie",
			index: 0,
			expandParentId: "charlie",
		});
	});
	it("moves the last child down to the top of a collapsed uncle", () => {
		const tree = rowTree([delta(), {id: "charlie"}, bravo, alpha(false)]);
		expect(planVerticalMove({nodeId: "b2", direction: "down", zoomRootId: null, tree})).toStrictEqual({
			nodeId: "b2",
			parentId: "alpha",
			index: 0,
			expandParentId: "alpha",
		});
	});
	it("moves the last child down to the top of an open uncle without expanding it", () => {
		const tree = rowTree([delta(), {id: "charlie"}, bravo, alpha(true)]);
		expect(planVerticalMove({nodeId: "b2", direction: "down", zoomRootId: null, tree})).toStrictEqual({
			nodeId: "b2",
			parentId: "alpha",
			index: 0,
			expandParentId: null,
		});
	});
	it("returns null with no uncle in that direction", () => {
		const tree = rowTree([delta(true), {id: "charlie"}, bravo, alpha(true)]);
		expect([
			planVerticalMove({nodeId: "d1", direction: "up", zoomRootId: null, tree}),
			planVerticalMove({nodeId: "a2", direction: "down", zoomRootId: null, tree}),
			planVerticalMove({nodeId: "delta", direction: "up", zoomRootId: null, tree}),
			planVerticalMove({nodeId: "alpha", direction: "down", zoomRootId: null, tree}),
		]).toStrictEqual([null, null, null, null]);
	});
	it("never leaves the zoomed page", () => {
		const tree = rowTree([delta(), {id: "charlie"}, bravo, alpha(true)]);
		expect([
			planVerticalMove({nodeId: "b1", direction: "up", zoomRootId: "bravo", tree}),
			planVerticalMove({nodeId: "b2", direction: "down", zoomRootId: "bravo", tree}),
			planVerticalMove({nodeId: "bravo", direction: "up", zoomRootId: "bravo", tree}),
		]).toStrictEqual([null, null, null]);
	});
	it("swaps with the previous sibling", () => {
		const tree = rowTree([{id: "p", expanded: true, children: [{id: "a"}, {id: "b"}, {id: "c"}]}]);
		expect(planVerticalMove({nodeId: "c", direction: "up", zoomRootId: null, tree})).toStrictEqual({
			nodeId: "c",
			parentId: "p",
			index: 1,
			expandParentId: null,
		});
	});
	it("moves down past the next sibling (slot counted before removal, like the move endpoint)", () => {
		const tree = rowTree([{id: "p", expanded: true, children: [{id: "a"}, {id: "b"}, {id: "c"}]}]);
		expect(planVerticalMove({nodeId: "a", direction: "down", zoomRootId: null, tree})).toStrictEqual({
			nodeId: "a",
			parentId: "p",
			index: 2,
			expandParentId: null,
		});
	});
	it("skips a hidden completed sibling, counting it in the index", () => {
		const tree = rowTree([
			{id: "p", expanded: true, children: [{id: "a"}, {id: "b"}, {id: "x", hidden: true}, {id: "c"}]},
		]);
		expect([
			planVerticalMove({nodeId: "c", direction: "up", zoomRootId: null, tree}),
			planVerticalMove({nodeId: "b", direction: "down", zoomRootId: null, tree}),
		]).toStrictEqual([
			{nodeId: "c", parentId: "p", index: 1, expandParentId: null},
			{nodeId: "b", parentId: "p", index: 4, expandParentId: null},
		]);
	});
	it("lands after the open uncle's last rendered child, before its hidden completed ones", () => {
		const tree = rowTree([
			{id: "u", expanded: true, children: [{id: "u1"}, {id: "u2", hidden: true}]},
			{id: "p", expanded: true, children: [{id: "a"}]},
		]);
		expect(planVerticalMove({nodeId: "a", direction: "up", zoomRootId: null, tree})).toStrictEqual({
			nodeId: "a",
			parentId: "u",
			index: 1,
			expandParentId: null,
		});
	});
	it("skips a hidden completed uncle", () => {
		const tree = rowTree([
			{id: "u", expanded: true, children: [{id: "u1"}]},
			{id: "h", hidden: true},
			{id: "p", expanded: true, children: [{id: "a"}]},
		]);
		expect(planVerticalMove({nodeId: "a", direction: "up", zoomRootId: null, tree})).toStrictEqual({
			nodeId: "a",
			parentId: "u",
			index: 1,
			expandParentId: null,
		});
	});
});

describe("cacheMoveTree", () => {
	it("reads parents and priority-ordered children from the cache, visibility from completion", () => {
		const done = node({id: "d", parent_id: "p", priority: 50, completedAt: 1});
		const qc = seed({root: [node({id: "p", priority: 1})], p: [siblings[1], done, siblings[0]]});
		const tree = cacheMoveTree(qc, {
			expandedIds: new Set(["p"]),
			showCompleted: false,
			animatingCompletionIds: new Set(),
		});
		expect([
			tree.parentOf("a"),
			tree.parentOf("p"),
			tree.childrenOf("p"),
			tree.childrenOf("a"),
			tree.isExpanded("p"),
			tree.isExpanded("a"),
			tree.isVisible("d"),
			tree.isVisible("a"),
		]).toStrictEqual(["p", null, ["d", "a", "b"], [], true, false, false, true]);
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
