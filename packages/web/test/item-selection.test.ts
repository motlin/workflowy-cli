import {describe, expect, it} from "vite-plus/test";
import {
	emptySelection,
	expand,
	isCovered,
	isEntry,
	leadId,
	pivotTo,
	removeIds,
	selectIds,
	sortedIds,
	toggleClick,
} from "../src/client/item-selection.js";
import type {SelectionState, TreeView} from "../src/client/item-selection.js";

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
