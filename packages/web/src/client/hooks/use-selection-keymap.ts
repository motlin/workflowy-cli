import {useEffect} from "react";
import {useQueryClient} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import {isMacPlatform} from "../editable-text-keys.js";
import {
	caretAfterArrowClear,
	deleteCaretTarget,
	emptySelection,
	expand,
	isEntry,
	leadId,
	selectIds,
	selectionKeyAction,
	sortedIds,
} from "../item-selection.js";
import type {CaretTarget, FlatRow, SelectionState, TreeView} from "../item-selection.js";
import {readChildren, readNode} from "../node-cache.js";
import {useOutlineStore} from "../stores/outline.js";
import {nextPotentiallyVisibleSibling} from "../tree-ops.js";
import {captureOutlineView, runInUndoBatch} from "../undo-batch.js";
import {useDeleteNode} from "./use-nodes.js";
import {collectVisibleNodeIds} from "./use-visible-nodes.js";

/** Stands in for Home as the selection's zoom root; it is never a row, so it is never selected. */
export const HOME_ROOT = "home";

/** Upstream confirms deleting a selection that holds more than this many items, descendants included. */
const DELETE_CONFIRM_THRESHOLD = 20;

/** The outline as the selection model sees it, read from the store and cache at call time. */
export interface SelectionView {
	tree: TreeView;
	/** The navigable rows in display order: the zoomed title (when zoomed), then every visible row. */
	rows: FlatRow[];
	/** What ⌘A selects: the zoomed node, or every top-level row at Home. */
	allIds: string[];
}

export function currentSelectionView(queryClient: QueryClient): SelectionView {
	const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = useOutlineStore.getState();
	const visible = collectVisibleNodeIds(
		queryClient,
		zoomedNodeId,
		expandedIds,
		showCompleted,
		animatingCompletionIds,
	);
	const zoomRootId = zoomedNodeId ?? HOME_ROOT;
	const realParent = (id: string): string | null => readNode(queryClient, id)?.parent_id ?? null;
	const parentOf = (id: string): string | null => {
		if (id === HOME_ROOT) {
			return null;
		}
		const node = readNode(queryClient, id);
		if (node === undefined) {
			return null;
		}
		return node.parent_id ?? (zoomedNodeId === null ? HOME_ROOT : null);
	};
	const sibling = (id: string, step: -1 | 1): string | null =>
		nextPotentiallyVisibleSibling(readChildren(queryClient, realParent(id)) ?? [], id, step, showCompleted);
	const rowIds = zoomedNodeId === null ? visible : [zoomedNodeId, ...visible];
	return {
		tree: {
			zoomRootId,
			parentOf,
			visibleOrder: [zoomRootId, ...visible],
			nextPotentiallyVisibleSiblingOf: (id) => sibling(id, 1),
			previousPotentiallyVisibleSiblingOf: (id) => sibling(id, -1),
		},
		rows: rowIds.map((id) => ({id, parentId: realParent(id)})),
		allIds: zoomedNodeId === null ? visible.filter((id) => realParent(id) === null) : [zoomedNodeId],
	};
}

/** Select `ids` as a fresh selection; Home itself is never selectable. */
export function freshSelection(view: SelectionView, ids: readonly string[]): SelectionState {
	return selectIds(
		emptySelection(),
		view.tree,
		ids.filter((id) => id !== HOME_ROOT),
	);
}

export function scrollRowIntoView(id: string | null): void {
	if (id === null) {
		return;
	}
	document
		.querySelector(`.innerContentContainer[data-node-id="${CSS.escape(id)}"]`)
		?.scrollIntoView({block: "nearest"});
}

function isTextTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	);
}

/** How many items deleting `ids` removes, descendants included; an unloaded subtree counts as too many to skip the confirm. */
function deletedItemCount(queryClient: QueryClient, ids: readonly string[]): number {
	const count = (id: string): number => {
		const children = readChildren(queryClient, id);
		if (children === undefined) {
			return readNode(queryClient, id)?.hasChildren === false ? 1 : Number.POSITIVE_INFINITY;
		}
		return children.reduce((sum, child) => sum + count(child.id), 1);
	};
	return ids.reduce((sum, id) => sum + count(id), 0);
}

function resumeAt(target: CaretTarget | null): void {
	const {clearItemSelection, resumeEditing} = useOutlineStore.getState();
	if (target === null) {
		clearItemSelection();
		return;
	}
	resumeEditing(target.id, target.offset === "end" ? Number.MAX_SAFE_INTEGER : target.offset);
}

/**
 * Delete the selected items (`ordered`, in display order) as one undo step and edit beside them, confirming first
 * when that removes more than upstream's threshold of items.
 */
export function deleteSelectedItems(
	queryClient: QueryClient,
	ordered: readonly string[],
	deleteNode: (id: string) => void,
): void {
	// Deleting the zoomed page out from under the view is left to the page's own menu.
	const {zoomedNodeId} = useOutlineStore.getState();
	if (zoomedNodeId !== null && ordered.includes(zoomedNodeId)) {
		return;
	}
	if (
		deletedItemCount(queryClient, ordered) > DELETE_CONFIRM_THRESHOLD &&
		!globalThis.confirm(`Delete ${ordered.length} selected items and everything inside them?`)
	) {
		return;
	}
	resumeAt(deleteCaretTarget(ordered, currentSelectionView(queryClient).rows));
	void runInUndoBatch(captureOutlineView, () => {
		for (const id of ordered) {
			deleteNode(id);
		}
	});
}

/**
 * Upstream's item-selection hotkeys, live only while items are selected and focus is off every editor: ⇧↑/⇧↓
 * expand, ⌘A selects the zoom root, plain arrows clear the selection and edit beside it, Backspace/Delete delete
 * every selected item, and Escape clears it and opens search.
 */
export function useSelectionKeymap(): void {
	const queryClient = useQueryClient();
	const {mutate: deleteNode} = useDeleteNode();

	useEffect(() => {
		const isMac = isMacPlatform();
		const onKeyDown = (event: KeyboardEvent): void => {
			const state = useOutlineStore.getState();
			// An editor that just turned this keydown into a selection already handled it.
			if (
				event.defaultPrevented ||
				event.isComposing ||
				state.itemSelection.entries.length === 0 ||
				isTextTarget(event.target)
			) {
				return;
			}
			const action = selectionKeyAction(event, isMac);
			if (action === null) {
				return;
			}
			event.preventDefault();
			const view = currentSelectionView(queryClient);
			const selection = state.itemSelection;
			const ordered = sortedIds(selection, view.tree);
			switch (action) {
				case "EXPAND_UP":
				case "EXPAND_DOWN": {
					const next = expand(selection, view.tree, action === "EXPAND_UP" ? "up" : "down");
					if (!isEntry(next, HOME_ROOT)) {
						state.setItemSelection(next);
						scrollRowIntoView(leadId(next));
					}
					break;
				}
				case "SELECT_ALL": {
					state.setItemSelection(freshSelection(view, view.allIds));
					break;
				}
				case "CLEAR_LEFT":
				case "CLEAR_RIGHT":
				case "CLEAR_UP":
				case "CLEAR_DOWN": {
					const dir = (
						{CLEAR_LEFT: "left", CLEAR_RIGHT: "right", CLEAR_UP: "up", CLEAR_DOWN: "down"} as const
					)[action];
					resumeAt(caretAfterArrowClear(dir, ordered, view.rows));
					break;
				}
				case "DELETE": {
					deleteSelectedItems(queryClient, ordered, deleteNode);
					break;
				}
				case "ESCAPE": {
					state.clearItemSelection();
					if (!state.searchPanelOpen) {
						state.toggleSearchPanel();
					}
					break;
				}
			}
		};
		globalThis.addEventListener("keydown", onKeyDown);
		return () => {
			globalThis.removeEventListener("keydown", onKeyDown);
		};
	}, [queryClient, deleteNode]);
}
