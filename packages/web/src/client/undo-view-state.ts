import {locationUrl} from "./location.js";
import type {UndoBatch, UndoOp, ViewState} from "./undo-history.js";

type Editing = NonNullable<ViewState["editing"]>;

export interface RestorePlan {
	/** The route to push when the saved zoom differs from the current one, else null. */
	navigateTo: string | null;
	/** The row and caret to focus, clamped to the restored text; null when nothing was being edited. */
	focus: Editing | null;
	/** The selection to restore; absent while an editor or input has focus, as upstream. */
	selectedIds?: string[];
}

/** Where to go, what to focus and what to select to put the user back in `target`, the view saved with an undo step. */
export function planRestore(
	current: ViewState,
	target: ViewState,
	textLength: number,
	editorFocused = false,
): RestorePlan {
	const navigateTo =
		current.zoomedNodeId === target.zoomedNodeId
			? null
			: target.zoomedNodeId === null
				? "/"
				: locationUrl({id: target.zoomedNodeId});
	const clamp = (offset: number): number => Math.max(0, Math.min(offset, textLength));
	const focus =
		target.editing === null
			? null
			: {...target.editing, start: clamp(target.editing.start), end: clamp(target.editing.end)};
	return editorFocused ? {navigateTo, focus} : {navigateTo, focus, selectedIds: target.selectedIds};
}

export type UndoDirection = "undo" | "redo";

/** The app services an undo or redo touches; injected so tests can record the order. */
export interface UndoRunner {
	/** Saves the edited row's pending text, which becomes its own undo step. */
	flush(): void;
	/** Resolves once every issued mutation has pushed its undo step. */
	settled(): Promise<void>;
	pop(direction: UndoDirection): UndoBatch | undefined;
	/** Leaves the editor so the replay does not write under the caret. */
	blur(): void;
	/** Writes the ops into the cache at once, so the outline shows the undo before the server answers. */
	preview(ops: readonly UndoOp[]): void;
	/** Replays the ops on the server and reconciles the cache with its answer. */
	apply(ops: readonly UndoOp[]): Promise<void>;
	current(): ViewState;
	/** Whether a contentEditable or input has focus, which keeps the selection as it is. */
	editorFocused(): boolean;
	select(ids: readonly string[]): void;
	/** The restored text's plain length, for clamping the caret. */
	textLength(nodeId: string, field: Editing["field"]): number;
	/** Pushes the saved zoom (null for home). */
	zoomTo(nodeId: string | null): void;
	focus(target: Editing): void;
}

/**
 * Upstream undo/redo: flush the pending text, pop, blur, apply the ops to the cache, restore the view
 * saved with the step (the pre-command view for undo, the post-command view for redo), not the current
 * one, and only then wait for the server replay, so the outline updates without a round trip.
 */
export async function runUndo(direction: UndoDirection, runner: UndoRunner): Promise<void> {
	runner.flush();
	await runner.settled();
	const batch = runner.pop(direction);
	if (batch === undefined) {
		return;
	}
	runner.blur();
	runner.preview(batch.ops);
	const target = batch.after;
	const length = target.editing === null ? 0 : runner.textLength(target.editing.nodeId, target.editing.field);
	const plan = planRestore(runner.current(), target, length, runner.editorFocused());
	if (plan.navigateTo !== null) {
		runner.zoomTo(target.zoomedNodeId);
	}
	if (plan.selectedIds !== undefined) {
		runner.select(plan.selectedIds);
	}
	if (plan.focus !== null) {
		runner.focus(plan.focus);
	}
	await runner.apply(batch.ops);
}

let chain: Promise<void> = Promise.resolve();

/** Runs undos and redos one at a time, so rapid ⌘Z presses each pop after the previous replay. */
export async function queueUndo(direction: UndoDirection, runner: UndoRunner): Promise<void> {
	const next = chain.then(async () => runUndo(direction, runner));
	chain = next.catch(() => {});
	return next;
}
