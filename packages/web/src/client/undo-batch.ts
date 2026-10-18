import {useOutlineStore} from "./stores/outline.js";
import {undoHistory} from "./undo-history.js";
import type {UndoOp, ViewState} from "./undo-history.js";

/** A failed API request that keeps its HTTP status, so callers can branch on it. */
export class RequestStatusError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "RequestStatusError";
	}
}

const RESTORE_UNAVAILABLE =
	"Couldn't undo: undo of delete needs the Workflowy internal API (set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD)";

/** The server calls that replay an inverted batch; injected so tests can record them. */
export interface UndoAdapter {
	updateNode(nodeId: string, request: {name?: string; note?: string}): Promise<unknown>;
	deleteNode(nodeId: string): Promise<unknown>;
	restoreNode(nodeId: string, request: {parent_id: string; index: number}): Promise<unknown>;
	moveNode(nodeId: string, request: {parent_id: string; index: number}): Promise<unknown>;
	completeNode(nodeId: string): Promise<unknown>;
	uncompleteNode(nodeId: string): Promise<unknown>;
}

interface OpenBatch {
	depth: number;
	ops: UndoOp[];
	before: ViewState;
}

let open: OpenBatch | undefined;

/** Opens a batch, or joins the outer one when a command runs inside another. */
function startBatch(before: ViewState): void {
	if (open === undefined) {
		open = {depth: 1, ops: [], before};
	} else {
		open.depth++;
	}
}

/** Adds one mutation to the open batch; a mutation outside any batch is not undoable. */
export function recordOp(op: UndoOp): void {
	open?.ops.push(op);
}

/** Closes one nesting level; the outermost close pushes the whole batch as ONE undo step. */
function finishBatch(after: ViewState): void {
	if (open === undefined) {
		return;
	}
	open.depth--;
	if (open.depth > 0) {
		return;
	}
	const {ops, before} = open;
	open = undefined;
	undoHistory.push({ops, before, after});
}

/** Runs one user command as a single undo step, capturing the view before and after it. */
export async function runInUndoBatch<T>(captureView: () => ViewState, fn: () => T | Promise<T>): Promise<T> {
	startBatch(captureView());
	try {
		return await fn();
	} finally {
		finishBatch(captureView());
	}
}

async function applyOp(op: UndoOp, adapter: UndoAdapter): Promise<unknown> {
	switch (op.kind) {
		case "edit":
			return adapter.updateNode(op.nodeId, {[op.field]: op.after});
		case "delete":
			return adapter.deleteNode(op.nodeId);
		case "create":
		case "undelete":
			return adapter.restoreNode(op.nodeId, {parent_id: op.parentId, index: op.index});
		case "move":
			return adapter.moveNode(op.nodeId, {parent_id: op.to.parentId, index: op.to.index});
		case "complete":
			return adapter.completeNode(op.nodeId);
		case "uncomplete":
		default:
			return adapter.uncompleteNode(op.nodeId);
	}
}

/**
 * Replays a popped (already inverted) batch in order. A 503 means the internal API that restores
 * deleted nodes is not configured: there is no local fallback, so report it and drop the history,
 * which no longer matches the outline.
 */
export async function applyOps(ops: readonly UndoOp[], adapter: UndoAdapter): Promise<void> {
	try {
		for (const op of ops) {
			// oxlint-disable-next-line no-await-in-loop -- inverses depend on the previous op's result (slots, parents)
			await applyOp(op, adapter);
		}
	} catch (error) {
		if (error instanceof RequestStatusError && error.status === 503) {
			useOutlineStore.getState().addErrorNotification(RESTORE_UNAVAILABLE);
			undoHistory.clear();
			return;
		}
		throw error;
	}
}
