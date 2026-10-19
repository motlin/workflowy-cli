import {describe, expect, it} from "vite-plus/test";
import {
	IDLE_BULLET_DRAG,
	buildDropRows,
	bulletDragReducer,
	dropBulletDrag,
	dropIndicatorFor,
} from "../src/client/bullet-drag-state.js";
import type {BulletDragState} from "../src/client/bullet-drag-state.js";
import {resolveDropTarget} from "../src/client/outline-drop-target.js";

const armed: BulletDragState = bulletDragReducer(IDLE_BULLET_DRAG, {
	type: "start",
	id: "delta",
	x: 100,
	y: 200,
	parentId: "dnd",
	index: 3,
});

const dragging: BulletDragState = bulletDragReducer(armed, {type: "move", x: 100, y: 203});

describe("bulletDragReducer", () => {
	it("arms on mousedown without dragging anything", () => {
		expect(armed).toStrictEqual({
			phase: "armed",
			sourceId: "delta",
			origin: {x: 100, y: 200},
			home: {parentId: "dnd", index: 3},
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
			draggingIds: [],
			indicator: null,
			ghostTransform: null,
			target: null,
		});
	});
});

describe("dropBulletDrag", () => {
	const dropOn = (parentId: string, index: number) =>
		dropBulletDrag(
			bulletDragReducer(dragging, {
				type: "hover",
				target: {parentId, index, ambiguous: false},
				indicator: null,
			}),
		);

	it("moves nothing when the parent and index are unchanged", () => {
		expect(dropOn("dnd", 3)).toStrictEqual({state: IDLE_BULLET_DRAG, effect: null});
		expect(dropOn("dnd", 4)).toStrictEqual({state: IDLE_BULLET_DRAG, effect: null});
	});

	it("moves the dragged rows to a new slot", () => {
		expect(dropOn("dnd", 2)).toStrictEqual({
			state: IDLE_BULLET_DRAG,
			effect: {ids: ["delta"], parentId: "dnd", index: 2},
		});
		expect(dropOn("charlie", 0)).toStrictEqual({
			state: IDLE_BULLET_DRAG,
			effect: {ids: ["delta"], parentId: "charlie", index: 0},
		});
	});

	it("moves nothing when released before the drag started or with no target", () => {
		expect(dropBulletDrag(armed)).toStrictEqual({state: IDLE_BULLET_DRAG, effect: null});
		expect(dropBulletDrag(dragging)).toStrictEqual({state: IDLE_BULLET_DRAG, effect: null});
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
