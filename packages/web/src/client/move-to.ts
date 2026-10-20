import type {AppMessageAction} from "./stores/outline.js";
import {defaultIndexIn} from "./tree-ops.js";
import type {BlockMove} from "./tree-ops.js";

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

/** One block move of `items` (document order) into `target` at upstream's `WF.Priority.defaultIn` slot (top unless `defaultToBottom`). */
export function planMoveTo({
	items,
	target,
	childCount,
}: {
	items: readonly string[];
	target: Pick<MoveToTarget, "id" | "defaultToBottom">;
	childCount: number;
}): BlockMove {
	return {ids: [...items], parentId: target.id, index: defaultIndexIn(target, childCount)};
}

export function moveToastText(kind: "moved" | "cant", name: string): string {
	return kind === "moved" ? `Moved to '${name}'` : `Can't move to '${name}'`;
}

/**
 * Upstream Move To (`WF.SendTo`): move the items (the selection in document order, or the one row) into the chosen
 * location as one block without expanding it, then toast `Moved to '<name>'` with View (zoom to the target) and Undo
 * (upstream `WF.Undo.undo`: the undo stack, which waits for the move to land). A target at or under any item stays
 * listed upstream; choosing it only toasts `Can't move to`. Returns whether the items moved.
 */
export function runMoveTo({
	items,
	target,
	childCount,
	parentOf,
	moveNodes,
	showToast,
	view,
	undo,
	leaveItem,
}: {
	/** The item ids in document order. */
	items: readonly string[];
	target: MoveToTarget;
	/** The target's current child count. */
	childCount: number;
	parentOf: (id: string) => string | null;
	moveNodes: (moves: BlockMove[]) => void;
	showToast: (toast: MoveToToast) => void;
	view: (targetId: string) => void;
	/** Pops the undo stack (the toast's Undo). */
	undo: () => void;
	/** Runs just before the move, while the item's row is still in place (caret to the previous visible row). */
	leaveItem?: () => void;
}): boolean {
	if (!items.every((item) => canMoveUnder(parentOf, item, target.id))) {
		showToast({text: moveToastText("cant", target.name), timeout: MOVE_TOAST_TIMEOUT, actions: []});
		return false;
	}
	leaveItem?.();
	moveNodes([planMoveTo({items, target, childCount})]);
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
				run: undo,
			},
		],
	});
	return true;
}

/** A loaded Move To location: its name and priority default, child count and ancestry. */
export interface LoadedMoveTarget {
	target: MoveToTarget;
	childCount: number;
	parentOf: (id: string) => string | null;
}

/**
 * The Move To caller (`⌃⌘M`, bullet menu): open the location picker, load what it chose (an existing location,
 * or the one its create-and-move just made), then `runMoveTo`. Returns whether the item moved.
 */
export async function executeMoveTo({
	pick,
	loadTarget,
	...move
}: Omit<Parameters<typeof runMoveTo>[0], "target" | "childCount" | "parentOf"> & {
	pick: () => Promise<{id: string} | {createdId: string} | undefined>;
	loadTarget: (id: string) => Promise<LoadedMoveTarget>;
}): Promise<boolean> {
	const picked = await pick();
	if (picked === undefined) {
		return false;
	}
	const loaded = await loadTarget("id" in picked ? picked.id : picked.createdId);
	return runMoveTo({...move, ...loaded});
}
