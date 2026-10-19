// Upstream's mouse-driven bullet drag (`LP4` mousedown, `jL4`/`_t2` dragging), as a pure state machine.
// The hook in `hooks/use-bullet-drag.ts` feeds it window mouse events and renders what it decides.

import type {DropRows, DropTarget} from "./outline-drop-target.js";
import {defaultIndexIn} from "./tree-ops.js";

/** A press becomes a drag once the pointer has moved this far (Euclidean) from the mousedown point. */
const DRAG_START_THRESHOLD_PX = 3;

/** Where the drop line goes: inside a parent (first slot) or under the row before the slot. */
export type DropIndicator =
	| {readonly kind: "in"; readonly parentId: string}
	| {readonly kind: "at"; readonly rowId: string};

interface Point {
	readonly x: number;
	readonly y: number;
}

interface Slot {
	readonly parentId: string;
	readonly index: number;
}

export interface BulletDragState {
	readonly phase: "idle" | "armed" | "dragging";
	readonly sourceId: string | null;
	readonly origin: Point | null;
	/** Where the dragged row sits now; dropping back there moves nothing. */
	readonly home: Slot | null;
	readonly draggingIds: readonly string[];
	readonly indicator: DropIndicator | null;
	readonly ghostTransform: string | null;
	/** The last target found; it survives the pointer leaving the window. */
	readonly target: DropTarget | null;
}

export type BulletDragAction =
	| {
			readonly type: "start";
			readonly id: string;
			readonly x: number;
			readonly y: number;
			readonly parentId: string;
			readonly index: number;
	  }
	| {readonly type: "move"; readonly x: number; readonly y: number}
	| {readonly type: "hover"; readonly target: DropTarget | null; readonly indicator: DropIndicator | null}
	| {readonly type: "leave"}
	| {readonly type: "cancel"};

export interface MoveEffect {
	readonly ids: readonly string[];
	readonly parentId: string;
	readonly index: number;
}

export const IDLE_BULLET_DRAG: BulletDragState = {
	phase: "idle",
	sourceId: null,
	origin: null,
	home: null,
	draggingIds: [],
	indicator: null,
	ghostTransform: null,
	target: null,
};

export function bulletDragReducer(state: BulletDragState, action: BulletDragAction): BulletDragState {
	switch (action.type) {
		case "start": {
			return {
				...IDLE_BULLET_DRAG,
				phase: "armed",
				sourceId: action.id,
				origin: {x: action.x, y: action.y},
				home: {parentId: action.parentId, index: action.index},
			};
		}
		case "move": {
			if (state.origin === null || state.sourceId === null) {
				return state;
			}
			const dx = action.x - state.origin.x;
			const dy = action.y - state.origin.y;
			if (state.phase === "armed" && Math.hypot(dx, dy) < DRAG_START_THRESHOLD_PX) {
				return state;
			}
			return {
				...state,
				phase: "dragging",
				draggingIds: state.phase === "dragging" ? state.draggingIds : [state.sourceId],
				ghostTransform: `translate3d(${dx}px, ${dy}px, 0px)`,
			};
		}
		case "hover": {
			return state.phase === "dragging" ? {...state, target: action.target, indicator: action.indicator} : state;
		}
		case "leave": {
			return state.phase === "dragging" ? {...state, indicator: null} : state;
		}
		case "cancel": {
			break;
		}
	}
	return IDLE_BULLET_DRAG;
}

/** What the hook knows about the drop target's parent at release. */
export interface DropTargetFacts {
	/** Every child of the target parent, the dragged rows included. */
	readonly childCount: number;
	readonly wasLeaf: boolean;
	readonly wasCollapsed: boolean;
	/** Upstream `metadata.priority.defaultToBottom`: a drop with no exact slot lands at the bottom. */
	readonly defaultToBottom: boolean;
}

export interface DropPlanInput extends DropTargetFacts {
	readonly target: DropTarget;
	/** The dragged rows in document order. */
	readonly draggingIds: readonly string[];
	readonly home: Slot | null;
}

/** Upstream's drop (`jL4` mouseup): one block move, then expand a leaf or flash and animate into a collapsed parent. */
export interface DropPlan {
	readonly move: MoveEffect | null;
	readonly expandId: string | null;
	readonly flashParentId: string | null;
	readonly animate: boolean;
}

const NO_DROP: DropPlan = {move: null, expandId: null, flashParentId: null, animate: false};

/**
 * Plan a drop. The index counts every child, the dragged rows included, so any slot from the block's first row
 * through the one just after its last leaves it where it is. A collapsed (ambiguous) target has no exact slot,
 * so the rows land at its default end.
 */
export function planDrop({
	target,
	draggingIds,
	home,
	childCount,
	wasLeaf,
	wasCollapsed,
	defaultToBottom,
}: DropPlanInput): DropPlan {
	const index = target.ambiguous ? defaultIndexIn({defaultToBottom}, childCount) : target.index;
	const unchanged =
		home !== null &&
		target.parentId === home.parentId &&
		index >= home.index &&
		index <= home.index + draggingIds.length;
	if (unchanged || draggingIds.length === 0) {
		return NO_DROP;
	}
	return {
		move: {ids: draggingIds, parentId: target.parentId, index},
		expandId: wasLeaf ? target.parentId : null,
		flashParentId: wasCollapsed ? target.parentId : null,
		animate: wasCollapsed,
	};
}

/** Release the drag, planning the drop from the facts about the hovered target's parent. */
export function dropBulletDrag(
	state: BulletDragState,
	factsOf: (parentId: string) => DropTargetFacts,
): {state: BulletDragState; plan: DropPlan} {
	const {phase, target, home, draggingIds} = state;
	if (phase !== "dragging" || target === null) {
		return {state: IDLE_BULLET_DRAG, plan: NO_DROP};
	}
	return {
		state: IDLE_BULLET_DRAG,
		plan: planDrop({target, draggingIds, home, ...factsOf(target.parentId)}),
	};
}

/** The indicator for a target: inside the parent for slot 0, else under the child before the slot. */
export function dropIndicatorFor(target: DropTarget | null, childIds: readonly string[]): DropIndicator | null {
	if (target === null) {
		return null;
	}
	if (target.index === 0) {
		return {kind: "in", parentId: target.parentId};
	}
	const rowId = childIds[target.index - 1];
	return rowId === undefined ? null : {kind: "at", rowId};
}

/** How the drop line marks a row: `in` (inside, `.drag-hovered-in`), `at` (under, `.drag-hovered-at`), or not at all. */
export type DropHover = "in" | "at" | null;

export function dropHoverOf(indicator: DropIndicator | null, id: string): DropHover {
	if (indicator?.kind === "in" && indicator.parentId === id) {
		return "in";
	}
	return indicator?.kind === "at" && indicator.rowId === id ? "at" : null;
}

export interface DropRowsInput {
	/** Rendered rows in document order, the zoom root first. */
	readonly order: readonly string[];
	readonly parentOf: (id: string) => string | null;
	/** Every child of `id` in order, rendered or not. */
	readonly childIdsOf: (id: string) => readonly string[];
	readonly isCollapsed: (id: string) => boolean;
	readonly left: (id: string) => number;
}

/** The resolver's view of the outline, from the rendered row order and the cached tree. */
export function buildDropRows({order, parentOf, childIdsOf, isCollapsed, left}: DropRowsInput): DropRows {
	const position = new Map(order.map((id, index) => [id, index]));
	const step = (id: string, delta: number): string | null => {
		const at = position.get(id);
		return at === undefined ? null : (order[at + delta] ?? null);
	};
	return {
		left,
		parentOf,
		indexOf: (id) => {
			const parentId = parentOf(id);
			return parentId === null ? 0 : childIdsOf(parentId).indexOf(id);
		},
		isRendered: (id) => position.has(id),
		nextInDocument: (id) => step(id, 1),
		previousInDocument: (id) => step(id, -1),
		isCollapsed,
		isDescendantOf: (id, ancestorId) => {
			for (let current = parentOf(id); current !== null; current = parentOf(current)) {
				if (current === ancestorId) {
					return true;
				}
			}
			return false;
		},
	};
}
