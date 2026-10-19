import {describe, expect, it} from "vite-plus/test";
import {
	caretAfterArrowClear,
	commandTargets,
	contentMouseDownAction,
	deleteCaretTarget,
	editorSelectAllTakesOver,
	editorShiftArrowTakesOver,
	emptySelection,
	expand,
	isCovered,
	isEntry,
	leadId,
	pivotTo,
	rangeFromDrag,
	removeIds,
	selectIds,
	selectionKeyAction,
	sortedIds,
	toggleClick,
} from "../src/client/item-selection.js";
import type {FlatRow, SelectionState, TreeView} from "../src/client/item-selection.js";

// R; Alpha{A1,A2}, Bravo, Charlie{C1}, Delta, Echo; all expanded.
const children: Record<string, string[]> = {
	R: ["Alpha", "Bravo", "Charlie", "Delta", "Echo"],
	Alpha: ["A1", "A2"],
	Charlie: ["C1"],
};

function fixtureTree(): TreeView {
	const parents = new Map<string, string>();
	for (const [parent, kids] of Object.entries(children)) {
		for (const kid of kids) {
			parents.set(kid, parent);
		}
	}
	const visibleOrder: string[] = ["R"];
	const walk = (id: string) => {
		for (const kid of children[id] ?? []) {
			visibleOrder.push(kid);
			walk(kid);
		}
	};
	walk("R");
	const sibling = (id: string, offset: number): string | null => {
		const parent = parents.get(id);
		if (parent === undefined) {
			return null;
		}
		const kids = children[parent] ?? [];
		return kids[kids.indexOf(id) + offset] ?? null;
	};
	return {
		zoomRootId: "R",
		parentOf: (id) => parents.get(id) ?? null,
		visibleOrder,
		nextPotentiallyVisibleSiblingOf: (id) => sibling(id, 1),
		previousPotentiallyVisibleSiblingOf: (id) => sibling(id, -1),
	};
}

const tree = fixtureTree();

describe("expand", () => {
	it("walks the verified shift-arrow sequence from Bravo", () => {
		const steps: string[][] = [];
		let state: SelectionState = selectIds(emptySelection(), tree, ["Bravo"]);
		for (const dir of ["down", "down", "up", "up", "up", "up", "up", "down"] as const) {
			state = expand(state, tree, dir);
			steps.push(sortedIds(state, tree));
		}
		expect(steps).toStrictEqual([
			["Bravo", "Charlie"],
			["Bravo", "Charlie", "Delta"],
			["Bravo", "Charlie"],
			["Bravo"],
			["Alpha", "Bravo"],
			["R"],
			["R"],
			["Alpha", "Bravo"],
		]);
	});

	it("leaves an empty selection alone", () => {
		expect(expand(emptySelection(), tree, "down")).toStrictEqual(emptySelection());
	});

	it("never descends into children going down and stops at the zoom root's last row", () => {
		let state = selectIds(emptySelection(), tree, ["A2"]);
		const steps: string[][] = [];
		for (let i = 0; i < 5; i++) {
			state = expand(state, tree, "down");
			steps.push(sortedIds(state, tree));
		}
		expect(steps).toStrictEqual([
			["A2", "Bravo"],
			["A2", "Bravo", "Charlie"],
			["A2", "Bravo", "Charlie", "Delta"],
			["A2", "Bravo", "Charlie", "Delta", "Echo"],
			["A2", "Bravo", "Charlie", "Delta", "Echo"],
		]);
	});

	it("bumps the consecutive selected rows beyond the new row so the lead lands at the run's end", () => {
		const state = expand(selectIds(emptySelection(), tree, ["Delta", "Bravo"]), tree, "down");
		expect({sorted: sortedIds(state, tree), lead: leadId(state)}).toStrictEqual({
			sorted: ["Bravo", "Charlie", "Delta"],
			lead: "Delta",
		});
	});
});

describe("toggleClick", () => {
	it("adds non-contiguous rows and removes the covering ancestor", () => {
		const alpha = toggleClick(emptySelection(), tree, "Alpha");
		const alphaDelta = toggleClick(alpha, tree, "Delta");
		const delta = toggleClick(alphaDelta, tree, "A1");
		expect([sortedIds(alphaDelta, tree), sortedIds(delta, tree)]).toStrictEqual([["Alpha", "Delta"], ["Delta"]]);
	});
});

describe("pivotTo", () => {
	it("selects the walked range from the focused row and retracts it on the next shift-click", () => {
		const toDelta = pivotTo(emptySelection(), tree, "Delta", "Bravo");
		const toA1 = pivotTo(toDelta, tree, "A1", "Bravo");
		expect([sortedIds(toDelta, tree), sortedIds(toA1, tree)]).toStrictEqual([
			["Bravo", "Charlie", "Delta"],
			["A1", "A2", "Bravo"],
		]);
	});

	it("falls back to the zoom root's first child with no pivot, lead or focus", () => {
		expect(sortedIds(pivotTo(emptySelection(), tree, "Bravo", null), tree)).toStrictEqual(["Alpha", "Bravo"]);
	});

	it("steps into the clicked row's ancestor instead of skipping past it", () => {
		expect(sortedIds(pivotTo(emptySelection(), tree, "C1", "Alpha"), tree)).toStrictEqual([
			"Alpha",
			"Bravo",
			"Charlie",
		]);
	});
});

describe("selectIds", () => {
	it("subsumes selected descendants when an ancestor is selected", () => {
		const state = selectIds(selectIds(emptySelection(), tree, ["A1"]), tree, ["R"]);
		expect(state.entries).toStrictEqual([{id: "R", leadOrder: 2, subsumedIds: ["A1"]}]);
	});

	it("skips covered and unknown ids", () => {
		const state = selectIds(selectIds(emptySelection(), tree, ["Alpha"]), tree, ["A1", "Nope", "Alpha"]);
		expect(state.entries).toStrictEqual([{id: "Alpha", leadOrder: 1, subsumedIds: []}]);
	});
});

describe("removeIds", () => {
	it("drops entries and clears a removed pivot", () => {
		const state = removeIds(toggleClick(toggleClick(emptySelection(), tree, "Bravo"), tree, "Delta"), ["Delta"]);
		expect(state).toStrictEqual({
			entries: [{id: "Bravo", leadOrder: 1, subsumedIds: []}],
			pivotId: null,
			retractableIds: [],
			counter: 2,
		});
	});
});

describe("isCovered", () => {
	it("is true for a selected row and its descendants only", () => {
		const state = selectIds(emptySelection(), tree, ["Alpha"]);
		expect(["Alpha", "A2", "Bravo"].map((id) => isCovered(state, tree, id))).toStrictEqual([true, true, false]);
	});
});

describe("isEntry", () => {
	it("marks only the selected entries; descendants are covered by the entry's nested .project", () => {
		const state = selectIds(emptySelection(), tree, ["Charlie", "Echo"]);
		expect(["Charlie", "C1", "Delta", "Echo"].map((id) => isEntry(state, id))).toStrictEqual([
			true,
			false,
			false,
			true,
		]);
	});
});

// The navigable rows in display order: the zoom root's title, then every visible row.
const flattened: FlatRow[] = tree.visibleOrder.map((id) => ({id, parentId: id === "R" ? null : tree.parentOf(id)}));

describe("editorShiftArrowTakesOver", () => {
	it("takes over only at the caret boundary of the name editor", () => {
		expect([
			editorShiftArrowTakesOver({dir: "down", start: 2, end: 3, length: 5, inNote: false}),
			editorShiftArrowTakesOver({dir: "down", start: 2, end: 5, length: 5, inNote: false}),
			editorShiftArrowTakesOver({dir: "up", start: 0, end: 3, length: 5, inNote: false}),
			editorShiftArrowTakesOver({dir: "up", start: 1, end: 5, length: 5, inNote: false}),
			editorShiftArrowTakesOver({dir: "up", start: 0, end: 0, length: 5, inNote: true}),
		]).toStrictEqual([false, true, true, false, false]);
	});
});

describe("editorSelectAllTakesOver", () => {
	it("takes over once the whole row text is already selected", () => {
		expect([
			editorSelectAllTakesOver({start: 0, end: 5, length: 5}),
			editorSelectAllTakesOver({start: 1, end: 5, length: 5}),
			editorSelectAllTakesOver({start: 0, end: 4, length: 5}),
			editorSelectAllTakesOver({start: 0, end: 0, length: 0}),
		]).toStrictEqual([true, false, false, true]);
	});
});

describe("caretAfterArrowClear", () => {
	it("places the caret beside the selection for each arrow", () => {
		expect([
			caretAfterArrowClear("down", ["Alpha", "Bravo"], flattened),
			caretAfterArrowClear("up", ["Bravo"], flattened),
			caretAfterArrowClear("right", ["Alpha"], flattened),
			caretAfterArrowClear("left", ["Bravo", "Delta"], flattened),
			caretAfterArrowClear("down", ["Alpha"], flattened),
		]).toStrictEqual([
			{id: "Charlie", offset: 0},
			{id: "A2", offset: 0},
			{id: "A2", offset: "end"},
			{id: "Bravo", offset: 0},
			{id: "Bravo", offset: 0},
		]);
	});

	it("falls back to the selection's own rows at the outline's edges", () => {
		expect([
			caretAfterArrowClear("down", ["Echo"], flattened),
			caretAfterArrowClear("up", ["R"], flattened),
			caretAfterArrowClear("down", ["R"], flattened),
			caretAfterArrowClear("left", [], flattened),
		]).toStrictEqual([{id: "Echo", offset: "end"}, {id: "R", offset: 0}, {id: "Echo", offset: "end"}, null]);
	});
});

describe("deleteCaretTarget", () => {
	it("is the end of the row above the first selected row", () => {
		expect([
			deleteCaretTarget(["Echo"], flattened),
			deleteCaretTarget(["Charlie", "Echo"], flattened),
			deleteCaretTarget(["A1"], flattened),
		]).toStrictEqual([
			{id: "Delta", offset: "end"},
			{id: "Bravo", offset: "end"},
			{id: "Alpha", offset: "end"},
		]);
	});

	it("falls back to the start of the row after the selection, else nowhere", () => {
		const rows = flattened.slice(1);
		expect([
			deleteCaretTarget(["Alpha"], rows),
			deleteCaretTarget(["Alpha", "Bravo", "Charlie", "Delta", "Echo"], rows),
		]).toStrictEqual([{id: "Bravo", offset: 0}, null]);
	});
});

describe("selectionKeyAction", () => {
	const key = (k: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
		key: k,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		...mods,
	});

	it("maps the keys a selection owns on mac", () => {
		expect(
			[
				key("ArrowUp", {shiftKey: true}),
				key("ArrowDown", {shiftKey: true}),
				key("a", {metaKey: true}),
				key("a", {ctrlKey: true}),
				key("ArrowLeft"),
				key("ArrowRight"),
				key("ArrowUp"),
				key("ArrowDown"),
				key("Backspace"),
				key("Delete"),
				key("Escape"),
				key("ArrowUp", {metaKey: true, shiftKey: true}),
				key("x"),
			].map((event) => selectionKeyAction(event, true)),
		).toStrictEqual([
			"EXPAND_UP",
			"EXPAND_DOWN",
			"SELECT_ALL",
			null,
			"CLEAR_LEFT",
			"CLEAR_RIGHT",
			"CLEAR_UP",
			"CLEAR_DOWN",
			"DELETE",
			"DELETE",
			"ESCAPE",
			null,
			null,
		]);
	});

	it("selects all with ctrl elsewhere", () => {
		expect([
			selectionKeyAction(key("a", {ctrlKey: true}), false),
			selectionKeyAction(key("a", {metaKey: true}), false),
		]).toStrictEqual(["SELECT_ALL", null]);
	});
});

describe("rangeFromDrag", () => {
	const ids = tree.visibleOrder.slice(1);
	const parentOf = (id: string) => tree.parentOf(id);
	it("selects the rows between the drag start and the pointer, dropping rows whose parent is in range", () => {
		expect([
			rangeFromDrag(ids, parentOf, "Bravo", "Delta"),
			rangeFromDrag(ids, parentOf, "Delta", "A1"),
			rangeFromDrag(ids, parentOf, "Bravo", "Bravo"),
			rangeFromDrag(ids, parentOf, "Bravo", "missing"),
		]).toStrictEqual([["Bravo", "Charlie", "Delta"], ["A1", "A2", "Bravo", "Charlie", "Delta"], [], []]);
	});
});

describe("contentMouseDownAction", () => {
	const press = (
		mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
		extra: Partial<{button: number; onBullet: boolean; isEditingRow: boolean}> = {},
	) => ({
		button: 0,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		onBullet: false,
		isEditingRow: false,
		...mods,
		...extra,
	});

	it("toggles on ⌘/⌥, pivots on ⇧ off the edited row, and arms a drag on a plain left press", () => {
		expect(
			[
				press({metaKey: true}),
				press({altKey: true}),
				press({ctrlKey: true}),
				press({shiftKey: true}),
				press({shiftKey: true}, {isEditingRow: true}),
				press(),
				press({}, {isEditingRow: true}),
				press({}, {button: 2}),
				press({metaKey: true}, {onBullet: true}),
			].map((event) => contentMouseDownAction(event, true)),
		).toStrictEqual(["TOGGLE", "TOGGLE", null, "PIVOT", null, "DRAG", "DRAG", null, null]);
	});

	it("toggles with ctrl elsewhere", () => {
		expect([
			contentMouseDownAction(press({ctrlKey: true}), false),
			contentMouseDownAction(press({metaKey: true}), false),
		]).toStrictEqual(["TOGGLE", null]);
	});
});

describe("commandTargets", () => {
	it("returns the selection in display order", () => {
		const state = selectIds(emptySelection(), tree, ["Bravo", "Alpha"]);
		expect(commandTargets(state, () => tree, "Charlie")).toStrictEqual(["Alpha", "Bravo"]);
	});

	it("falls back to the edited row without a selection", () => {
		expect(commandTargets(emptySelection(), () => tree, "alice")).toStrictEqual(["alice"]);
	});

	it("is empty with neither a selection nor an edited row", () => {
		expect(commandTargets(emptySelection(), () => tree, null)).toStrictEqual([]);
	});
});
