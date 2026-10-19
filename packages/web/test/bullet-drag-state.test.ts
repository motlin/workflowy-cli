import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import {
	IDLE_BULLET_DRAG,
	buildDropRows,
	bulletDragReducer,
	dropBulletDrag,
	dragItems,
	dropClearsSelection,
	dropIndicatorFor,
	planDrop,
} from "../src/client/bullet-drag-state.js";
import type {BulletDragState} from "../src/client/bullet-drag-state.js";
import {emptySelection, selectionOf} from "../src/client/item-selection.js";
import type {TreeView} from "../src/client/item-selection.js";
import {resolveDropTarget} from "../src/client/outline-drop-target.js";

const armed: BulletDragState = bulletDragReducer(IDLE_BULLET_DRAG, {
	type: "start",
	id: "delta",
	x: 100,
	y: 200,
	itemIds: ["delta"],
	home: {parentId: "dnd", index: 3},
});

const dragging: BulletDragState = bulletDragReducer(armed, {type: "move", x: 100, y: 203});

describe("bulletDragReducer", () => {
	it("arms on mousedown without dragging anything", () => {
		expect(armed).toStrictEqual({
			phase: "armed",
			sourceId: "delta",
			origin: {x: 100, y: 200},
			home: {parentId: "dnd", index: 3},
			itemIds: ["delta"],
			draggingIds: [],
			indicator: null,
			ghostTransform: null,
			target: null,
		});
	});

	it("stays armed below the 3px threshold", () => {
		expect(bulletDragReducer(armed, {type: "move", x: 102, y: 200})).toStrictEqual(armed);
	});

	it("starts dragging at 3px and moves the ghost by the pointer delta", () => {
		expect(dragging).toStrictEqual({
			phase: "dragging",
			sourceId: "delta",
			origin: {x: 100, y: 200},
			home: {parentId: "dnd", index: 3},
			itemIds: ["delta"],
			draggingIds: ["delta"],
			indicator: null,
			ghostTransform: "translate3d(0px, 3px, 0px)",
			target: null,
		});
		expect(bulletDragReducer(dragging, {type: "move", x: 90, y: 250}).ghostTransform).toBe(
			"translate3d(-10px, 50px, 0px)",
		);
	});

	it("records the hovered target and its indicator only while dragging", () => {
		const hover = {
			type: "hover",
			target: {parentId: "charlie", index: 0, ambiguous: false},
			indicator: {kind: "in", parentId: "charlie"},
		} as const;
		expect(bulletDragReducer(armed, hover)).toStrictEqual(armed);
		expect(bulletDragReducer(dragging, hover)).toStrictEqual({
			...dragging,
			target: {parentId: "charlie", index: 0, ambiguous: false},
			indicator: {kind: "in", parentId: "charlie"},
		});
	});

	it("clears the indicator but keeps the last target when the pointer leaves the window", () => {
		const hovered = bulletDragReducer(dragging, {
			type: "hover",
			target: {parentId: "charlie", index: 0, ambiguous: false},
			indicator: {kind: "in", parentId: "charlie"},
		});
		expect(bulletDragReducer(hovered, {type: "leave"})).toStrictEqual({
			...dragging,
			target: {parentId: "charlie", index: 0, ambiguous: false},
			indicator: null,
		});
	});

	it("cancels back to idle", () => {
		expect(bulletDragReducer(dragging, {type: "cancel"})).toStrictEqual({
			phase: "idle",
			sourceId: null,
			origin: null,
			home: null,
			itemIds: [],
			draggingIds: [],
			indicator: null,
			ghostTransform: null,
			target: null,
		});
	});

	it("drags every item the press armed once the drag starts", () => {
		const selectionArmed = bulletDragReducer(IDLE_BULLET_DRAG, {
			type: "start",
			id: "charlie",
			x: 100,
			y: 200,
			itemIds: ["bravo", "charlie"],
			home: {parentId: "dnd", index: 1},
		});
		expect(bulletDragReducer(selectionArmed, {type: "move", x: 100, y: 203}).draggingIds).toStrictEqual([
			"bravo",
			"charlie",
		]);
	});
});

describe("dragItems", () => {
	// DnD{Alpha, Bravo, Charlie{C1}, Delta}; all expanded.
	const children: Record<string, string[]> = {dnd: ["alpha", "bravo", "charlie", "delta"], charlie: ["c1"]};
	const parents = new Map(
		Object.entries(children).flatMap(([parentId, ids]) => ids.map((id) => [id, parentId] as const)),
	);
	const tree: TreeView = {
		zoomRootId: "dnd",
		parentOf: (id) => parents.get(id) ?? null,
		visibleOrder: ["dnd", "alpha", "bravo", "charlie", "c1", "delta"],
		nextPotentiallyVisibleSiblingOf: () => null,
		previousPotentiallyVisibleSiblingOf: () => null,
	};
	const childIdsOf = (id: string) => children[id] ?? [];
	const items = (sourceId: string, ids: readonly string[]) =>
		dragItems({sourceId, selection: ids.length === 0 ? emptySelection() : selectionOf(ids), tree, childIdsOf});

	it("drags only the pressed row when it is not a selection entry", () => {
		expect([items("delta", []), items("c1", ["charlie"])]).toStrictEqual([
			{ids: ["delta"], home: {parentId: "dnd", index: 3}, selection: false},
			{ids: ["c1"], home: {parentId: "charlie", index: 0}, selection: false},
		]);
	});

	it("drags the whole selection in document order when the pressed row is an entry", () => {
		expect(items("bravo", ["charlie", "bravo"])).toStrictEqual({
			ids: ["bravo", "charlie"],
			home: {parentId: "dnd", index: 1},
			selection: true,
		});
	});

	it("has no home for a selection that is not one contiguous sibling block", () => {
		expect([items("alpha", ["alpha", "charlie"]), items("bravo", ["bravo", "c1"])]).toStrictEqual([
			{ids: ["alpha", "charlie"], home: null, selection: true},
			{ids: ["bravo", "c1"], home: null, selection: true},
		]);
	});
});

describe("dropClearsSelection", () => {
	const plan = (flashParentId: string | null) => ({
		move: {ids: ["bravo", "charlie"], parentId: "alpha", index: 0},
		expandId: null,
		flashParentId,
		animate: flashParentId !== null,
	});

	it("keeps the selection unless the rows dropped into a collapsed parent", () => {
		expect([
			dropClearsSelection(plan(null)),
			dropClearsSelection(plan("alpha")),
			dropClearsSelection({move: null, expandId: null, flashParentId: null, animate: false}),
		]).toStrictEqual([false, true, false]);
	});
});

describe("dropBulletDrag", () => {
	const leafFacts = {childCount: 0, wasLeaf: true, wasCollapsed: false, defaultToBottom: false};
	const dndFacts = {childCount: 5, wasLeaf: false, wasCollapsed: false, defaultToBottom: false};
	const factsOf = (parentId: string) => (parentId === "dnd" ? dndFacts : leafFacts);
	const nothing = {move: null, expandId: null, flashParentId: null, animate: false};
	const dropOn = (parentId: string, index: number) =>
		dropBulletDrag(
			bulletDragReducer(dragging, {
				type: "hover",
				target: {parentId, index, ambiguous: false},
				indicator: null,
			}),
			factsOf,
		);

	it("moves nothing when the parent and index are unchanged", () => {
		expect([dropOn("dnd", 3), dropOn("dnd", 4)]).toStrictEqual([
			{state: IDLE_BULLET_DRAG, plan: nothing},
			{state: IDLE_BULLET_DRAG, plan: nothing},
		]);
	});

	it("plans the drop with the facts about the target's parent", () => {
		expect([dropOn("dnd", 2), dropOn("charlie", 0)]).toStrictEqual([
			{
				state: IDLE_BULLET_DRAG,
				plan: {
					move: {ids: ["delta"], parentId: "dnd", index: 2},
					expandId: null,
					flashParentId: null,
					animate: false,
				},
			},
			{
				state: IDLE_BULLET_DRAG,
				plan: {
					move: {ids: ["delta"], parentId: "charlie", index: 0},
					expandId: "charlie",
					flashParentId: null,
					animate: false,
				},
			},
		]);
	});

	it("moves nothing when released before the drag started or with no target", () => {
		expect([dropBulletDrag(armed, factsOf), dropBulletDrag(dragging, factsOf)]).toStrictEqual([
			{state: IDLE_BULLET_DRAG, plan: nothing},
			{state: IDLE_BULLET_DRAG, plan: nothing},
		]);
	});
});

describe("planDrop", () => {
	const facts = {childCount: 0, wasLeaf: false, wasCollapsed: false, defaultToBottom: false};
	const nothing = {move: null, expandId: null, flashParentId: null, animate: false};

	it("drops into a collapsed parent at the top, keeps it collapsed, flashes it and animates", () => {
		expect(
			planDrop({
				target: {parentId: "alpha", index: 0, ambiguous: true},
				draggingIds: ["delta"],
				home: {parentId: "dnd", index: 3},
				...facts,
				childCount: 2,
				wasCollapsed: true,
			}),
		).toStrictEqual({
			move: {ids: ["delta"], parentId: "alpha", index: 0},
			expandId: null,
			flashParentId: "alpha",
			animate: true,
		});
	});

	it("drops into a collapsed defaultToBottom parent after its last child", () => {
		expect(
			planDrop({
				target: {parentId: "alpha", index: 0, ambiguous: true},
				draggingIds: ["delta"],
				home: {parentId: "dnd", index: 3},
				...facts,
				childCount: 2,
				wasCollapsed: true,
				defaultToBottom: true,
			}).move,
		).toStrictEqual({ids: ["delta"], parentId: "alpha", index: 2});
	});

	it("expands a leaf it drops into, without the flash or the animation", () => {
		expect(
			planDrop({
				target: {parentId: "charlie", index: 0, ambiguous: false},
				draggingIds: ["delta"],
				home: {parentId: "dnd", index: 3},
				...facts,
				wasLeaf: true,
			}),
		).toStrictEqual({
			move: {ids: ["delta"], parentId: "charlie", index: 0},
			expandId: "charlie",
			flashParentId: null,
			animate: false,
		});
	});

	it("moves several dragged rows as one block", () => {
		expect(
			planDrop({
				target: {parentId: "dnd", index: 0, ambiguous: false},
				draggingIds: ["bravo", "charlie"],
				home: {parentId: "dnd", index: 1},
				...facts,
				childCount: 4,
			}),
		).toStrictEqual({
			move: {ids: ["bravo", "charlie"], parentId: "dnd", index: 0},
			expandId: null,
			flashParentId: null,
			animate: false,
		});
	});

	it("moves nothing when dropped back where the rows are", () => {
		const home = {parentId: "dnd", index: 1};
		const at = (index: number) =>
			planDrop({
				target: {parentId: "dnd", index, ambiguous: false},
				draggingIds: ["bravo", "charlie"],
				home,
				...facts,
				childCount: 4,
			});
		expect([at(1), at(2), at(3)]).toStrictEqual([nothing, nothing, nothing]);
	});
});

describe("dropIndicatorFor", () => {
	const children = ["alpha", "bravo", "charlie"];

	it("draws the line inside the parent for the first slot", () => {
		expect(dropIndicatorFor({parentId: "dnd", index: 0, ambiguous: false}, children)).toStrictEqual({
			kind: "in",
			parentId: "dnd",
		});
	});

	it("draws the line under the child before the slot", () => {
		expect(dropIndicatorFor({parentId: "dnd", index: 2, ambiguous: false}, children)).toStrictEqual({
			kind: "at",
			rowId: "bravo",
		});
	});

	it("draws nothing without a target", () => {
		expect(dropIndicatorFor(null, children)).toBeNull();
	});
});

describe("buildDropRows", () => {
	// DnD > [Alpha(collapsed) > [A1, A2], Bravo > [B1], Charlie, Delta]; A1 and A2 are not rendered.
	const parents: Record<string, string> = {
		alpha: "dnd",
		a1: "alpha",
		a2: "alpha",
		bravo: "dnd",
		b1: "bravo",
		charlie: "dnd",
		delta: "dnd",
	};
	const children: Record<string, string[]> = {
		dnd: ["alpha", "bravo", "charlie", "delta"],
		alpha: ["a1", "a2"],
		bravo: ["b1"],
	};
	const depth = (id: string): number => (id === "dnd" ? 0 : 1 + depth(parents[id] ?? "dnd"));
	const rows = buildDropRows({
		order: ["dnd", "alpha", "bravo", "b1", "charlie", "delta"],
		parentOf: (id) => parents[id] ?? null,
		childIdsOf: (id) => children[id] ?? [],
		isCollapsed: (id) => id === "alpha",
		left: (id) => 80 + 36 * depth(id),
	});

	it("walks rendered rows in document order", () => {
		expect(
			["dnd", "alpha", "b1", "delta"].map((id) => [rows.previousInDocument(id), rows.nextInDocument(id)]),
		).toStrictEqual([
			[null, "alpha"],
			["dnd", "bravo"],
			["bravo", "charlie"],
			["charlie", null],
		]);
	});

	it("answers parent, index, rendering, collapse and ancestry from the tree", () => {
		expect({
			parent: rows.parentOf("b1"),
			index: rows.indexOf("charlie"),
			renderedA1: rows.isRendered("a1"),
			renderedB1: rows.isRendered("b1"),
			collapsed: rows.isCollapsed("alpha"),
			descendant: rows.isDescendantOf("b1", "dnd"),
			notDescendant: rows.isDescendantOf("b1", "alpha"),
			left: rows.left("b1"),
		}).toStrictEqual({
			parent: "bravo",
			index: 2,
			renderedA1: false,
			renderedB1: true,
			collapsed: true,
			descendant: true,
			notDescendant: false,
			left: 152,
		});
	});

	it("feeds the drop-target resolver", () => {
		expect(
			resolveDropTarget({
				x: 90,
				rows,
				predecessorId: "b1",
				movingIds: new Set(["delta"]),
				zoomRootId: "dnd",
			}),
		).toStrictEqual({parentId: "dnd", index: 2, ambiguous: false});
	});
});

describe("drop rotate animation CSS", () => {
	it("swings the moved bullet half a turn under its new collapsed parent", () => {
		const css = readFileSync(new URL("../src/client/styles.css", import.meta.url), "utf8")
			.replaceAll(/\s+/gu, "")
			.replaceAll(";}", "}");
		expect({
			rule: css.includes(
				".moved-bullet-rotate{position:fixed;z-index:200;width:18px;height:18px;border-radius:14px;pointer-events:none;color:var(--wf-text-primary);animation:animateMovedBulletUnderneathNewParent0.4sease-outforwards}",
			),
			keyframes: css.includes(
				"@keyframesanimateMovedBulletUnderneathNewParent{0%{transform:rotate(0deg)}100%{transform:rotate(-180deg)}}",
			),
		}).toStrictEqual({rule: true, keyframes: true});
	});
});
