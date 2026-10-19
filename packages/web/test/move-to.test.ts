import {describe, expect, it} from "vite-plus/test";
import {canMoveUnder, executeMoveTo, moveToastText, planMoveTo, runMoveTo} from "../src/client/move-to.js";
import type {MoveToRequest, MoveToToast} from "../src/client/move-to.js";

// home > grandpa > {dad > {item > {child > {grandchild}}}, uncle}
const PARENTS: Record<string, string | null> = {
	grandpa: null,
	dad: "grandpa",
	uncle: "grandpa",
	item: "dad",
	child: "item",
	grandchild: "child",
};
const parentOf = (id: string): string | null => PARENTS[id] ?? null;

describe("canMoveUnder", () => {
	it("is false for the item itself", () => {
		expect(canMoveUnder(parentOf, "item", "item")).toBe(false);
	});

	it("is false for a descendant of the item", () => {
		expect(canMoveUnder(parentOf, "item", "grandchild")).toBe(false);
	});

	it("is true for an uncle", () => {
		expect(canMoveUnder(parentOf, "item", "uncle")).toBe(true);
	});
});

describe("planMoveTo", () => {
	it("lands at the top of the target by default", () => {
		expect(planMoveTo({item: "a2", target: {id: "bravo", defaultToBottom: false}, childCount: 2})).toStrictEqual({
			nodeId: "a2",
			parent_id: "bravo",
			index: 0,
		});
	});

	it("lands at the bottom when the target defaults to bottom", () => {
		expect(planMoveTo({item: "a2", target: {id: "bravo", defaultToBottom: true}, childCount: 2})).toStrictEqual({
			nodeId: "a2",
			parent_id: "bravo",
			index: 2,
		});
	});
});

describe("moveToastText", () => {
	it("names the target", () => {
		expect(moveToastText("moved", "Charlie")).toBe("Moved to 'Charlie'");
		expect(moveToastText("cant", "Charlie")).toBe("Can't move to 'Charlie'");
	});
});

interface Recorded {
	moves: MoveToRequest[];
	toasts: MoveToToast[];
	views: string[];
}

function run(targetId: string, defaultToBottom = false): Recorded & {moved: boolean} {
	const recorded: Recorded = {moves: [], toasts: [], views: []};
	const moved = runMoveTo({
		itemId: "item",
		from: {parentId: "dad", index: 3},
		target: {id: targetId, name: "Uncle", defaultToBottom},
		childCount: 4,
		parentOf,
		moveNode: (request) => {
			recorded.moves.push(request);
		},
		showToast: (toast) => {
			recorded.toasts.push(toast);
		},
		view: (id) => {
			recorded.views.push(id);
		},
	});
	return {...recorded, moved};
}

describe("runMoveTo", () => {
	it("moves the item to the target's default slot and toasts View and Undo for 5s", () => {
		const result = run("uncle");
		expect({
			moved: result.moved,
			moves: result.moves,
			toasts: result.toasts.map(({text, timeout, actions}) => ({
				text,
				timeout,
				actions: actions.map(({label, shortcut}) => ({label, shortcut})),
			})),
		}).toStrictEqual({
			moved: true,
			moves: [{nodeId: "item", parent_id: "uncle", index: 0}],
			toasts: [
				{
					text: "Moved to 'Uncle'",
					timeout: 5000,
					actions: [
						{label: "View", shortcut: "shift+return"},
						{label: "Undo", shortcut: undefined},
					],
				},
			],
		});
	});

	it("uses the bottom slot for a defaultToBottom target", () => {
		expect(run("uncle", true).moves).toStrictEqual([{nodeId: "item", parent_id: "uncle", index: 4}]);
	});

	it("View zooms to the target and Undo moves the item back to its old slot", () => {
		const result = run("uncle");
		for (const action of result.toasts[0]?.actions ?? []) {
			action.run();
		}
		expect({views: result.views, moves: result.moves}).toStrictEqual({
			views: ["uncle"],
			moves: [
				{nodeId: "item", parent_id: "uncle", index: 0},
				{nodeId: "item", parent_id: "dad", index: 3},
			],
		});
	});

	it("refuses a descendant target: no move, a Can't move toast", () => {
		const result = run("grandchild");
		expect({moved: result.moved, moves: result.moves, toasts: result.toasts}).toStrictEqual({
			moved: false,
			moves: [],
			toasts: [{text: "Can't move to 'Uncle'", timeout: 5000, actions: []}],
		});
	});
});

async function execute(picked: {id: string} | {createdId: string} | undefined) {
	const log: string[] = [];
	const moved = await executeMoveTo({
		itemId: "item",
		from: {parentId: "dad", index: 3},
		pick: async () => Promise.resolve(picked),
		loadTarget: async (id) => {
			log.push(`load ${id}`);
			return Promise.resolve({target: {id, name: "Uncle"}, childCount: 2, parentOf});
		},
		leaveItem: () => {
			log.push("leave");
		},
		moveNode: (request) => {
			log.push(`move ${request.nodeId} ${String(request.parent_id)} ${request.index}`);
		},
		showToast: (toast) => {
			log.push(`toast ${toast.text}`);
		},
		view: () => {},
	});
	return {moved, log};
}

describe("executeMoveTo", () => {
	it("does nothing when the picker closes without a choice", async () => {
		await expect(execute(undefined)).resolves.toStrictEqual({moved: false, log: []});
	});

	it("loads the chosen location, leaves the item's row, then moves it and toasts", async () => {
		await expect(execute({id: "uncle"})).resolves.toStrictEqual({
			moved: true,
			log: ["load uncle", "leave", "move item uncle 0", "toast Moved to 'Uncle'"],
		});
	});

	it("moves into a location the picker just created", async () => {
		expect((await execute({createdId: "fresh"})).log).toStrictEqual([
			"load fresh",
			"leave",
			"move item fresh 0",
			"toast Moved to 'Uncle'",
		]);
	});

	it("keeps the caret on the item when the location is under it", async () => {
		await expect(execute({id: "grandchild"})).resolves.toStrictEqual({
			moved: false,
			log: ["load grandchild", "toast Can't move to 'Uncle'"],
		});
	});
});
