import type {QueryClient} from "@tanstack/react-query";
import type {NodeResponse} from "../node-types.js";
import {nodeKeys, patchCachedNode, readNode, spliceChildren} from "./node-cache.js";
import type {UndoOp} from "./undo-history.js";

/** Rows an undo or redo removed, so restoring the same id puts the same row back at once. */
const removedRows = new Map<string, NodeResponse>();

/** Drops `nodeId`'s row from every cached children list except `keepParentId`'s. */
function removeRow(queryClient: QueryClient, nodeId: string, keepParentId?: string | null): void {
	for (const [key, children] of queryClient.getQueriesData<NodeResponse[]>({
		queryKey: [...nodeKeys.all, "children"],
	})) {
		if (key[2] !== keepParentId && children?.some((child) => child.id === nodeId)) {
			queryClient.setQueryData(
				key,
				children.filter((child) => child.id !== nodeId),
			);
		}
	}
}

/** Splices `row` into `parentId`'s cached list at the endpoint's slot and repoints its detail entry. */
function insertRow(queryClient: QueryClient, row: NodeResponse, parentId: string | null, index: number): void {
	const moved = {...row, parent_id: parentId};
	queryClient.setQueryData<NodeResponse[]>(nodeKeys.children(parentId), (children) =>
		children === undefined ? children : spliceChildren(children, moved, index),
	);
	queryClient.setQueryData<NodeResponse>(nodeKeys.detail(row.id), (detail) =>
		detail === undefined ? detail : {...detail, parent_id: parentId},
	);
}

/**
 * Removes a deleted row from the cache at once, keeping it so restoring the same id (the delete's
 * undo) puts the same row back without waiting on a refetch.
 */
export function removeDeletedRow(queryClient: QueryClient, nodeId: string): void {
	const row = readNode(queryClient, nodeId);
	if (row !== undefined) {
		removedRows.set(nodeId, row);
		removeRow(queryClient, nodeId);
	}
}

function previewOp(queryClient: QueryClient, op: UndoOp): void {
	switch (op.kind) {
		case "edit":
			patchCachedNode(queryClient, op.nodeId, (node) => ({...node, [op.field]: op.after}));
			return;
		case "complete":
		case "uncomplete": {
			const completedAt = op.kind === "complete" ? Math.floor(Date.now() / 1000) : null;
			patchCachedNode(queryClient, op.nodeId, (node) => ({...node, completedAt}));
			return;
		}
		case "move": {
			const row = readNode(queryClient, op.nodeId);
			if (row !== undefined) {
				removeRow(queryClient, op.nodeId, op.to.parentId);
				insertRow(queryClient, row, op.to.parentId, op.to.index);
			}
			return;
		}
		case "delete":
			removeDeletedRow(queryClient, op.nodeId);
			return;
		case "create":
		case "undelete":
		default: {
			const row = removedRows.get(op.nodeId);
			if (row !== undefined) {
				removedRows.delete(op.nodeId);
				insertRow(queryClient, row, op.parentId, op.index);
			}
		}
	}
}

/**
 * Applies a popped (already inverted) undo step to the query cache in replay order, before the
 * server replay, so the outline shows the undo at once as upstream does. Ops whose rows are not
 * cached are left to the refetch that follows the replay.
 */
export function previewUndoOps(queryClient: QueryClient, ops: readonly UndoOp[]): void {
	for (const op of ops) {
		previewOp(queryClient, op);
	}
}
