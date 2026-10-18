import {beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {RequestStatusError, applyOps, holdUndoSlot, recordOp, runInUndoBatch} from "../src/client/undo-batch.js";
import type {UndoAdapter} from "../src/client/undo-batch.js";
import {undoHistory} from "../src/client/undo-history.js";
import type {UndoBatch, UndoOp, ViewState} from "../src/client/undo-history.js";

const notifications = vi.hoisted((): string[][] => []);
vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: {
		getState: () => ({
			zoomedNodeId: "zoom",
			editingId: null,
			editingCaretOffset: null,
			editingNoteId: null,
			addErrorNotification(message: string, type = "error") {
				notifications.push([message, type]);
				return "id";
			},
		}),
	},
}));

type Call = [string, ...unknown[]];

function fakeAdapter(overrides: Partial<UndoAdapter> = {}): {adapter: UndoAdapter; calls: Call[]} {
	const calls: Call[] = [];
	const record =
		(name: string) =>
		async (...args: unknown[]): Promise<void> => {
			calls.push([name, ...args]);
			return Promise.resolve();
		};
	const adapter: UndoAdapter = {
		updateNode: record("updateNode"),
		deleteNode: record("deleteNode"),
		restoreNode: record("restoreNode"),
		moveNode: record("moveNode"),
		completeNode: record("completeNode"),
		uncompleteNode: record("uncompleteNode"),
		...overrides,
	};
	return {adapter, calls};
}

const viewA: ViewState = {zoomedNodeId: null, editing: null};
const viewB: ViewState = {zoomedNodeId: "z", editing: {nodeId: "x", field: "name", start: 0, end: 0}};

/** Records `ops` as one user command, then pops it back off the undo stack. */
async function recordAndUndo(...ops: UndoOp[]): Promise<UndoBatch> {
	let view = viewA;
	await runInUndoBatch(
		() => view,
		() => {
			for (const op of ops) {
				recordOp(op);
			}
			view = viewB;
		},
	);
	const batch = undoHistory.popUndo();
	if (batch === undefined) {
		throw new Error("expected an undo batch");
	}
	return batch;
}

beforeEach(() => {
	undoHistory.clear();
	notifications.length = 0;
});

describe("runInUndoBatch", () => {
	it("joins nested batches into ONE undo step with the outer view states", async () => {
		let view = viewA;
		await runInUndoBatch(
			() => view,
			async () => {
				recordOp({kind: "complete", nodeId: "a"});
				await runInUndoBatch(
					() => view,
					() => {
						recordOp({kind: "complete", nodeId: "b"});
					},
				);
				view = viewB;
			},
		);
		expect(undoHistory.popUndo()).toStrictEqual({
			ops: [
				{kind: "uncomplete", nodeId: "b"},
				{kind: "uncomplete", nodeId: "a"},
			],
			before: viewB,
			after: viewA,
		});
		expect(undoHistory.canUndo).toBe(false);
	});

	it("pushes nothing when the command recorded no ops", async () => {
		await runInUndoBatch(
			() => viewA,
			() => {},
		);
		expect(undoHistory.canUndo).toBe(false);
	});

	it("still closes the batch when the command throws", async () => {
		await expect(
			runInUndoBatch(
				() => viewA,
				() => {
					recordOp({kind: "complete", nodeId: "a"});
					throw new Error("boom");
				},
			),
		).rejects.toThrow("boom");
		await runInUndoBatch(
			() => viewA,
			() => {
				recordOp({kind: "complete", nodeId: "b"});
			},
		);
		expect(undoHistory.popUndo()?.ops).toStrictEqual([{kind: "uncomplete", nodeId: "b"}]);
	});

	it("drops ops recorded outside any batch", () => {
		recordOp({kind: "complete", nodeId: "a"});
		expect(undoHistory.canUndo).toBe(false);
	});
});

describe("holdUndoSlot", () => {
	const outlineView: ViewState = {zoomedNodeId: "zoom", editing: null};

	it("makes a standalone mutation its own undo step once it settles", () => {
		const slot = holdUndoSlot();
		expect(undoHistory.canUndo).toBe(false);
		slot.settle([{kind: "complete", nodeId: "a"}]);
		expect(undoHistory.popUndo()).toStrictEqual({
			ops: [{kind: "uncomplete", nodeId: "a"}],
			before: outlineView,
			after: outlineView,
		});
	});

	it("keeps two standalone mutations as two steps", () => {
		holdUndoSlot().settle([{kind: "complete", nodeId: "a"}]);
		holdUndoSlot().settle([{kind: "complete", nodeId: "b"}]);
		expect([undoHistory.popUndo()?.ops, undoHistory.popUndo()?.ops]).toStrictEqual([
			[{kind: "uncomplete", nodeId: "b"}],
			[{kind: "uncomplete", nodeId: "a"}],
		]);
	});

	it("holds a command's batch open until every mutation it issued settles, keeping issue order", async () => {
		let first: ReturnType<typeof holdUndoSlot> | undefined;
		let second: ReturnType<typeof holdUndoSlot> | undefined;
		await runInUndoBatch(
			() => viewA,
			() => {
				first = holdUndoSlot();
				second = holdUndoSlot();
			},
		);
		second?.settle([{kind: "create", nodeId: "n", parentId: "p", index: 1}]);
		expect(undoHistory.canUndo).toBe(false);
		first?.settle([{kind: "edit", nodeId: "a", field: "name", before: "ab", after: "a"}]);
		expect(undoHistory.popUndo()).toStrictEqual({
			ops: [
				{kind: "delete", nodeId: "n", parentId: "p", index: 1},
				{kind: "edit", nodeId: "a", field: "name", before: "a", after: "ab"},
			],
			before: viewA,
			after: viewA,
		});
		expect(undoHistory.canUndo).toBe(false);
	});

	it("does not let a later command join a finished command that is still settling", async () => {
		let pending: ReturnType<typeof holdUndoSlot> | undefined;
		await runInUndoBatch(
			() => viewA,
			() => {
				pending = holdUndoSlot();
			},
		);
		holdUndoSlot().settle([{kind: "complete", nodeId: "later"}]);
		expect(undoHistory.canUndo).toBe(false);
		pending?.settle([{kind: "complete", nodeId: "first"}]);
		expect([undoHistory.popUndo()?.ops, undoHistory.popUndo()?.ops]).toStrictEqual([
			[{kind: "uncomplete", nodeId: "later"}],
			[{kind: "uncomplete", nodeId: "first"}],
		]);
	});

	it("records nothing for a failed mutation settled with no ops", () => {
		holdUndoSlot().settle([]);
		expect(undoHistory.canUndo).toBe(false);
	});

	it("does not re-record mutations issued while applyOps replays a batch", async () => {
		const {adapter} = fakeAdapter({
			completeNode: async () => {
				holdUndoSlot().settle([{kind: "complete", nodeId: "echo"}]);
				return Promise.resolve();
			},
		});
		await applyOps([{kind: "complete", nodeId: "a"}], adapter);
		expect(undoHistory.canUndo).toBe(false);
	});
});

describe("applyOps", () => {
	it("undoes a create by deleting the same id", async () => {
		const {adapter, calls} = fakeAdapter();
		await applyOps((await recordAndUndo({kind: "create", nodeId: "X", parentId: "P", index: 2})).ops, adapter);
		expect(calls).toStrictEqual([["deleteNode", "X"]]);
	});

	it("redoes a create by restoring the same id at its slot", async () => {
		await recordAndUndo({kind: "create", nodeId: "X", parentId: "P", index: 2});
		const redo = undoHistory.popRedo();
		const {adapter, calls} = fakeAdapter();
		await applyOps(redo?.ops ?? [], adapter);
		expect(calls).toStrictEqual([["restoreNode", "X", {parent_id: "P", index: 2}]]);
	});

	it("undoes a delete with exactly one restore of the original id", async () => {
		const {adapter, calls} = fakeAdapter();
		await applyOps((await recordAndUndo({kind: "delete", nodeId: "A", parentId: "P", index: 1})).ops, adapter);
		expect(calls).toStrictEqual([["restoreNode", "A", {parent_id: "P", index: 1}]]);
	});

	it("undoes a move by moving back to the original parent and index", async () => {
		const {adapter, calls} = fakeAdapter();
		const batch = await recordAndUndo({
			kind: "move",
			nodeId: "M",
			from: {parentId: "P", index: 4},
			to: {parentId: "Q", index: 0},
		});
		await applyOps(batch.ops, adapter);
		expect(calls).toStrictEqual([["moveNode", "M", {parent_id: "P", index: 4}]]);
	});

	it("undoes a complete with uncomplete and an uncomplete with complete", async () => {
		const {adapter, calls} = fakeAdapter();
		await applyOps(
			(await recordAndUndo({kind: "complete", nodeId: "C"}, {kind: "uncomplete", nodeId: "D"})).ops,
			adapter,
		);
		expect(calls).toStrictEqual([
			["completeNode", "D"],
			["uncompleteNode", "C"],
		]);
	});

	it("undoes an edit by writing the old text to the same field", async () => {
		const {adapter, calls} = fakeAdapter();
		await applyOps(
			(await recordAndUndo({kind: "edit", nodeId: "E", field: "note", before: "old", after: "new"})).ops,
			adapter,
		);
		expect(calls).toStrictEqual([["updateNode", "E", {note: "old"}]]);
	});

	it("reports a 503 restore and clears both stacks", async () => {
		await runInUndoBatch(
			() => viewA,
			() => {
				recordOp({kind: "complete", nodeId: "other"});
			},
		);
		const batch = await recordAndUndo({kind: "delete", nodeId: "A", parentId: "P", index: 1});
		const {adapter} = fakeAdapter({
			restoreNode: async () =>
				Promise.reject(new RequestStatusError(503, "Failed to restore node: Service Unavailable")),
		});
		await applyOps(batch.ops, adapter);
		expect(notifications).toStrictEqual([
			[
				"Couldn't undo: undo of delete needs the Workflowy internal API (set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD)",
				"error",
			],
		]);
		expect([undoHistory.canUndo, undoHistory.canRedo]).toStrictEqual([false, false]);
	});

	it("rethrows other failures without clearing history", async () => {
		await runInUndoBatch(
			() => viewA,
			() => {
				recordOp({kind: "complete", nodeId: "other"});
			},
		);
		const {adapter} = fakeAdapter({
			deleteNode: async () =>
				Promise.reject(new RequestStatusError(500, "Failed to delete node: Internal Server Error")),
		});
		await expect(applyOps([{kind: "delete", nodeId: "A", parentId: "P", index: 1}], adapter)).rejects.toThrow(
			"Failed to delete node: Internal Server Error",
		);
		expect(undoHistory.canUndo).toBe(true);
	});
});

describe("restoreNode", () => {
	it("posts the slot to the restore route and answers the restored node", async () => {
		const requests: [string, RequestInit | undefined][] = [];
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
			requests.push([url, init]);
			return Promise.resolve(Response.json({node: {id: "A"}}));
		});
		const {restoreNode} = await import("../src/client/hooks/use-nodes.js");
		await expect(restoreNode("A", {parent_id: "P", index: 1})).resolves.toStrictEqual({id: "A"});
		expect(requests).toStrictEqual([
			[
				"/api/v1/nodes/A/restore",
				{method: "POST", headers: {"Content-Type": "application/json"}, body: '{"parent_id":"P","index":1}'},
			],
		]);
		vi.unstubAllGlobals();
	});

	it("keeps the HTTP status of a failed restore", async () => {
		vi.stubGlobal("fetch", async () =>
			Promise.resolve(new Response(null, {status: 503, statusText: "Service Unavailable"})),
		);
		const {restoreNode} = await import("../src/client/hooks/use-nodes.js");
		const error = await restoreNode("A", {parent_id: "P", index: 1}).catch((error_: unknown) => error_);
		expect(error).toStrictEqual(new RequestStatusError(503, "Failed to restore node: Service Unavailable"));
		expect((error as RequestStatusError).status).toBe(503);
		vi.unstubAllGlobals();
	});
});
