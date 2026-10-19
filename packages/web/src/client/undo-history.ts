import {create} from "zustand";

/** Upstream keeps at most this many undoable batches, dropping the oldest. */
export const UNDO_STACK_CAP = 100;

export interface Slot {
	/** Null for the outline root. */
	parentId: string | null;
	index: number;
}

/**
 * One reversible outline mutation. Delete is undone by restoring the ORIGINAL id, so redo of a
 * create also restores that id (`undelete`) rather than creating a fresh node.
 */
export type UndoOp =
	| {kind: "edit"; nodeId: string; field: "name" | "note"; before: string; after: string}
	| {kind: "create"; nodeId: string; parentId: string | null; index: number}
	| {kind: "delete"; nodeId: string; parentId: string | null; index: number}
	| {kind: "undelete"; nodeId: string; parentId: string | null; index: number}
	| {kind: "move"; nodeId: string; from: Slot; to: Slot}
	| {kind: "complete" | "uncomplete"; nodeId: string};

/** Where the user was looking and typing; restored on undo/redo but never itself an op. */
export interface ViewState {
	zoomedNodeId: string | null;
	editing: {nodeId: string; field: "name" | "note"; start: number; end: number} | null;
	/** The item selection's entry ids in lead order. */
	selectedIds: string[];
}

export interface UndoBatch {
	ops: UndoOp[];
	before: ViewState;
	after: ViewState;
}

export function invertOp(op: UndoOp): UndoOp {
	switch (op.kind) {
		case "edit":
			return {...op, before: op.after, after: op.before};
		case "create":
		case "undelete":
			return {kind: "delete", nodeId: op.nodeId, parentId: op.parentId, index: op.index};
		case "delete":
			return {kind: "undelete", nodeId: op.nodeId, parentId: op.parentId, index: op.index};
		case "move":
			return {...op, from: op.to, to: op.from};
		case "complete":
			return {kind: "uncomplete", nodeId: op.nodeId};
		case "uncomplete":
		default:
			return {kind: "complete", nodeId: op.nodeId};
	}
}

export function invertBatch(batch: UndoBatch): UndoBatch {
	return {ops: batch.ops.map(invertOp).toReversed(), before: batch.after, after: batch.before};
}

/**
 * Upstream-style undo/redo stacks. Both stacks hold batches already inverted relative to the
 * direction they will be applied in, so a pop returns exactly what to apply.
 */
export class UndoHistory {
	private undoStack: UndoBatch[] = [];
	private redoStack: UndoBatch[] = [];

	constructor(private readonly onChange: (history: UndoHistory) => void = () => {}) {}

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	push(batch: UndoBatch): void {
		if (batch.ops.length === 0) {
			return;
		}
		this.undoStack.push(invertBatch(batch));
		if (this.undoStack.length > UNDO_STACK_CAP) {
			this.undoStack.shift();
		}
		this.redoStack = [];
		this.onChange(this);
	}

	popUndo(): UndoBatch | undefined {
		const batch = this.undoStack.pop();
		if (batch === undefined) {
			return undefined;
		}
		this.redoStack.push(invertBatch(batch));
		this.onChange(this);
		return batch;
	}

	popRedo(): UndoBatch | undefined {
		const batch = this.redoStack.pop();
		if (batch === undefined) {
			return undefined;
		}
		this.undoStack.push(invertBatch(batch));
		this.onChange(this);
		return batch;
	}

	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
		this.onChange(this);
	}
}

interface UndoStore {
	canUndo: boolean;
	canRedo: boolean;
}

export const useUndoStore = create<UndoStore>(() => ({canUndo: false, canRedo: false}));

/** The app's single history; every change is mirrored into `useUndoStore` for rendering. */
export const undoHistory = new UndoHistory((history) => {
	useUndoStore.setState({canUndo: history.canUndo, canRedo: history.canRedo});
});
