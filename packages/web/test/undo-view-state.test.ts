import {describe, expect, it} from "vite-plus/test";
import {locationUrl} from "../src/client/location.js";
import {editPatches, planRestore, runUndo} from "../src/client/undo-view-state.js";
import type {UndoRunner} from "../src/client/undo-view-state.js";
import type {UndoBatch, UndoOp, ViewState} from "../src/client/undo-history.js";

const editing = (nodeId: string, start: number, end = start): ViewState["editing"] => ({
	nodeId,
	field: "name",
	start,
	end,
});

describe("planRestore", () => {
	it("stays on the page when the zoom matches and focuses the saved caret", () => {
		expect(
			planRestore({zoomedNodeId: "z", editing: null}, {zoomedNodeId: "z", editing: editing("a", 2, 4)}, 10),
		).toStrictEqual({navigateTo: null, focus: {nodeId: "a", field: "name", start: 2, end: 4}});
	});

	it("navigates to the saved zoom when it differs", () => {
		expect(
			planRestore({zoomedNodeId: "z", editing: null}, {zoomedNodeId: "y", editing: editing("a", 0)}, 3),
		).toStrictEqual({navigateTo: locationUrl({id: "y"}), focus: {nodeId: "a", field: "name", start: 0, end: 0}});
	});

	it("navigates home when the saved zoom is the root", () => {
		expect(planRestore({zoomedNodeId: "z", editing: null}, {zoomedNodeId: null, editing: null}, 0)).toStrictEqual({
			navigateTo: "/",
			focus: null,
		});
	});

	it("clamps a caret past the end of the text", () => {
		expect(
			planRestore({zoomedNodeId: null, editing: null}, {zoomedNodeId: null, editing: editing("a", 12)}, 5),
		).toStrictEqual({navigateTo: null, focus: {nodeId: "a", field: "name", start: 5, end: 5}});
	});

	it("focuses nothing when nothing was being edited", () => {
		expect(
			planRestore({zoomedNodeId: null, editing: editing("a", 1)}, {zoomedNodeId: null, editing: null}, 5),
		).toStrictEqual({navigateTo: null, focus: null});
	});
});

type Call = [string, ...unknown[]];

const ops: UndoOp[] = [{kind: "uncomplete", nodeId: "a"}];
const batch: UndoBatch = {
	ops,
	before: {zoomedNodeId: "z", editing: editing("b", 1)},
	after: {zoomedNodeId: "y", editing: editing("a", 9)},
};

function fakeRunner(popped: UndoBatch | undefined): {runner: UndoRunner; calls: Call[]} {
	const calls: Call[] = [];
	const runner: UndoRunner = {
		flush() {
			calls.push(["flush"]);
		},
		async settled() {
			calls.push(["settled"]);
			return Promise.resolve();
		},
		pop(direction) {
			calls.push(["pop", direction]);
			return popped;
		},
		blur() {
			calls.push(["blur"]);
		},
		async apply(applied) {
			calls.push(["apply", applied]);
			return Promise.resolve();
		},
		current() {
			return {zoomedNodeId: "z", editing: null};
		},
		textLength(nodeId, field) {
			calls.push(["textLength", nodeId, field]);
			return 4;
		},
		zoomTo(nodeId) {
			calls.push(["zoomTo", nodeId]);
		},
		focus(target) {
			calls.push(["focus", target]);
		},
	};
	return {runner, calls};
}

describe("runUndo", () => {
	it("flushes and waits before popping, then applies and restores the batch's saved view", async () => {
		const {runner, calls} = fakeRunner(batch);
		await runUndo("undo", runner);
		expect(calls).toStrictEqual([
			["flush"],
			["settled"],
			["pop", "undo"],
			["blur"],
			["apply", ops],
			["textLength", "a", "name"],
			["zoomTo", "y"],
			["focus", {nodeId: "a", field: "name", start: 4, end: 4}],
		]);
	});

	it("does nothing past the pop when the stack is empty", async () => {
		const {runner, calls} = fakeRunner(undefined);
		await runUndo("redo", runner);
		expect(calls).toStrictEqual([["flush"], ["settled"], ["pop", "redo"]]);
	});
});

describe("editPatches", () => {
	it("lists the final text each edited field takes, in replay order, skipping other ops", () => {
		expect(
			editPatches([
				{kind: "edit", nodeId: "a", field: "name", before: "x", after: "y"},
				{kind: "complete", nodeId: "b"},
				{kind: "edit", nodeId: "a", field: "note", before: "", after: "n"},
			]),
		).toStrictEqual([
			{nodeId: "a", field: "name", value: "y"},
			{nodeId: "a", field: "note", value: "n"},
		]);
	});
});
