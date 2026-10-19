import type {AppMessageAction} from "./stores/outline.js";
import {defaultIndexIn} from "./tree-ops.js";

/** One exact-index `POST /api/v1/nodes/:id/move` (the `useMoveNode` payload). */
export interface MoveToRequest {
	nodeId: string;
	parent_id: string | null;
	index: number;
}

export interface MoveToTarget {
	id: string;
	name: string;
	defaultToBottom?: boolean;
}

export interface MoveToToast {
	text: string;
	timeout: number;
	actions: AppMessageAction[];
}

const MOVE_TOAST_TIMEOUT = 5000;

/** Upstream `canMoveUnder`: false when `targetId` is the item itself or anywhere beneath it. */
export function canMoveUnder(parentOf: (id: string) => string | null, itemId: string, targetId: string): boolean {
	for (let id: string | null = targetId; id !== null; id = parentOf(id)) {
		if (id === itemId) {
			return false;
		}
	}
	return true;
}

/** The move into `target` at upstream's `WF.Priority.defaultIn` slot (top unless `defaultToBottom`). */
export function planMoveTo({
	item,
	target,
	childCount,
}: {
	item: string;
	target: Pick<MoveToTarget, "id" | "defaultToBottom">;
	childCount: number;
}): MoveToRequest {
	return {nodeId: item, parent_id: target.id, index: defaultIndexIn(target, childCount)};
}

export function moveToastText(kind: "moved" | "cant", name: string): string {
	return kind === "moved" ? `Moved to '${name}'` : `Can't move to '${name}'`;
}

/**
 * Upstream Move To (`WF.SendTo`): move the item into the chosen location without expanding it,
 * then toast `Moved to '<name>'` with View (zoom to the target) and Undo (move it back to `from`).
 * A target at or under the item stays listed upstream; choosing it only toasts `Can't move to`.
 * Returns whether the item moved.
 */
export function runMoveTo({
	itemId,
	from,
	target,
	childCount,
	parentOf,
	moveNode,
	showToast,
	view,
}: {
	itemId: string;
	/** The item's current slot, for Undo. */
	from: {parentId: string | null; index: number};
	target: MoveToTarget;
	/** The target's current child count. */
	childCount: number;
	parentOf: (id: string) => string | null;
	moveNode: (request: MoveToRequest) => void;
	showToast: (toast: MoveToToast) => void;
	view: (targetId: string) => void;
}): boolean {
	if (!canMoveUnder(parentOf, itemId, target.id)) {
		showToast({text: moveToastText("cant", target.name), timeout: MOVE_TOAST_TIMEOUT, actions: []});
		return false;
	}
	moveNode(planMoveTo({item: itemId, target, childCount}));
	showToast({
		text: moveToastText("moved", target.name),
		timeout: MOVE_TOAST_TIMEOUT,
		actions: [
			{
				label: "View",
				shortcut: "shift+return",
				run: () => {
					view(target.id);
				},
			},
			{
				label: "Undo",
				run: () => {
					moveNode({nodeId: itemId, parent_id: from.parentId, index: from.index});
				},
			},
		],
	});
	return true;
}
