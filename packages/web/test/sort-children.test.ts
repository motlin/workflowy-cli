import {describe, expect, it} from "vite-plus/test";
import {planSortMove, runSortChildren, sortChildNames} from "../src/client/sort-children.js";
import type {SortMoveRequest, SortToast, SortableChild} from "../src/client/sort-children.js";

const DATE_A = '<time startYear="2026" startMonth="3" startDay="5">Mar 5</time> later';
const DATE_B = '<time startYear="2025" startMonth="12" startDay="1">Dec 1</time> earlier';

describe("sortChildNames", () => {
	it("sorts names ignoring case", () => {
		expect(sortChildNames(["Banana", "apple", "Cherry"], "asc")).toStrictEqual(["apple", "Banana", "Cherry"]);
		expect(sortChildNames(["Banana", "apple", "Cherry"], "desc")).toStrictEqual(["Cherry", "Banana", "apple"]);
	});

	it("sorts numeric names numerically and before non-numeric names", () => {
		expect(sortChildNames(["10", "b", "9"], "asc")).toStrictEqual(["9", "10", "b"]);
		expect(sortChildNames(["10", "b", "9"], "desc")).toStrictEqual(["b", "10", "9"]);
	});

	it("sorts names starting with a date by that date, dated before undated", () => {
		expect(sortChildNames(["alpha", DATE_A, DATE_B], "asc")).toStrictEqual([DATE_B, DATE_A, "alpha"]);
		expect(sortChildNames(["alpha", DATE_A, DATE_B], "desc")).toStrictEqual(["alpha", DATE_A, DATE_B]);
	});

	it("compares HTML names by their plain text", () => {
		expect(sortChildNames(["<b>zeta</b>", "beta"], "asc")).toStrictEqual(["beta", "<b>zeta</b>"]);
	});
});

const child = (id: string, name: string, movable = true): SortableChild => ({id, name, movable});

/** Moves `ids` as one block under the parent at `index`, keeping the rest in order. */
function simulateBlockMove(order: string[], ids: string[], index: number): string[] {
	const rest = order.filter((id) => !ids.includes(id));
	return [...rest.slice(0, index), ...ids, ...rest.slice(index)];
}

describe("planSortMove", () => {
	it("moves the sorted movable children to index 0 as one block", () => {
		expect(planSortMove([child("a", "a"), child("c", "c"), child("b", "b")], "asc")).toStrictEqual({
			ids: ["a", "b", "c"],
			index: 0,
		});
	});

	it("returns null when the children are already sorted", () => {
		expect(planSortMove([child("a", "a"), child("b", "b"), child("c", "c")], "asc")).toBeNull();
		expect(planSortMove([child("c", "c"), child("b", "b"), child("a", "a")], "desc")).toBeNull();
	});

	it("leaves unmovable children out of the block so they end up last", () => {
		const children = [child("c", "c"), child("u", "u", false), child("a", "a")];
		const plan = planSortMove(children, "asc");
		expect(plan).toStrictEqual({ids: ["a", "c"], index: 0});
		expect(simulateBlockMove(["c", "u", "a"], plan?.ids ?? [], 0)).toStrictEqual(["a", "c", "u"]);
	});

	it("returns null when there are no movable children", () => {
		expect(planSortMove([child("u", "u", false)], "asc")).toBeNull();
	});
});

describe("runSortChildren", () => {
	function run(direction: "asc" | "desc", children: SortableChild[]) {
		const moves: SortMoveRequest[] = [];
		const toasts: SortToast[] = [];
		runSortChildren({
			parentId: "p",
			children,
			direction,
			moveNodes: (request) => {
				moves.push(request);
			},
			showToast: (toast) => {
				toasts.push(toast);
			},
		});
		return {moves, toasts};
	}

	it("issues one block move and a toast whose Undo moves the previous order back", () => {
		const {moves, toasts} = run("asc", [child("b", "b"), child("a", "a")]);
		expect(moves).toStrictEqual([{ids: ["a", "b"], parent_id: "p", index: 0}]);
		expect(toasts.map(({text, timeout, undoLabel}) => ({text, timeout, undoLabel}))).toStrictEqual([
			{text: "Sorted A-Z", timeout: 5000, undoLabel: "Undo"},
		]);
		toasts[0]?.undo();
		expect(moves).toStrictEqual([
			{ids: ["a", "b"], parent_id: "p", index: 0},
			{ids: ["b", "a"], parent_id: "p", index: 0},
		]);
	});

	it("labels the Z-A toast", () => {
		const {moves, toasts} = run("desc", [child("a", "a"), child("b", "b")]);
		expect(moves).toStrictEqual([{ids: ["b", "a"], parent_id: "p", index: 0}]);
		expect(toasts.map((toast) => toast.text)).toStrictEqual(["Sorted Z-A"]);
	});

	it("does nothing when already sorted", () => {
		expect(run("asc", [child("a", "a"), child("b", "b")])).toStrictEqual({moves: [], toasts: []});
	});
});
