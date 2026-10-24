import {useCallback} from "react";
import {useQueryClient} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import {isMacPlatform} from "../editable-text-keys.js";
import {contentMouseDownAction, isCovered, pivotTo, rangeFromDrag, toggleClick} from "../item-selection.js";
import {flushEditing, useOutlineStore} from "../stores/outline.js";
import {currentSelectionView, freshSelection} from "./use-selection-keymap.js";
import type {SelectionView} from "./use-selection-keymap.js";

/** How far (px) past the start row's `.name` the pointer must travel before a press becomes a drag-select. */
const DRAG_THRESHOLD_PX = 5;

const DRAGGING_CLASS = "item-selection--dragging";

/** Each outline row's bullet, in display order; the zoomed title and the Backlinks header are not rows. */
const ROW_BULLET_SELECTOR = ".project:not(.root) > .name > a.bullet[data-item-id]:not(.bullet--backlink-root)";

/** Commit the edited text, stop editing, and drop the caret, so an item selection or bullet drag owns the keyboard. */
export function leaveEditor(): void {
	flushEditing();
	const active = document.activeElement;
	useOutlineStore.getState().stopEditing();
	globalThis.getSelection()?.removeAllRanges();
	if (active instanceof HTMLElement && active.isContentEditable) {
		active.blur();
	}
}

/** Swallow the click that a selecting press ends with, so the row's click-to-edit does not clear the selection. */
function suppressNextClick(): void {
	const swallow = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		cancel();
	};
	const cancel = () => {
		globalThis.removeEventListener("click", swallow, true);
		globalThis.removeEventListener("mousedown", cancel, true);
	};
	globalThis.addEventListener("click", swallow, true);
	globalThis.addEventListener("mousedown", cancel, true);
}

/** Where a drag may select: the start row's board column, else the whole outline. */
function dragScope(name: Element): Element {
	const outline = name.closest(".page, .outline-tree-container") ?? document.body;
	const board = name.parentElement?.parentElement?.closest(".project.board");
	if (board === null || board === undefined) {
		return outline;
	}
	const columns = board.querySelector(":scope > .children")?.children ?? [];
	return [...columns].find((column) => column.contains(name)) ?? board;
}

interface DragRow {
	id: string;
	top: number;
}

function rowsIn(scope: Element): DragRow[] {
	return [...scope.querySelectorAll(ROW_BULLET_SELECTOR)].flatMap((bullet) => {
		const id = bullet.getAttribute("data-item-id");
		const name = bullet.parentElement;
		return id === null || name === null ? [] : [{id, top: name.getBoundingClientRect().top}];
	});
}

/** The row whose `.name` starts at or above `clientY` (the first row when above them all). */
function rowAtY(rows: readonly DragRow[], clientY: number): string | null {
	let hit = rows[0]?.id ?? null;
	for (const row of rows) {
		if (row.top <= clientY) {
			hit = row.id;
		}
	}
	return hit;
}

/** Arm drag-select from `nodeId`'s `.name`: once the pointer leaves it, select every row between start and pointer. */
function armDragSelect(nodeId: string, name: Element, queryClient: QueryClient): void {
	const startRect = name.getBoundingClientRect();
	let dragging = false;
	let style: HTMLStyleElement | null = null;
	let rows: DragRow[] = [];
	let view: SelectionView | null = null;

	const onMove = (event: MouseEvent) => {
		if ((event.buttons & 1) === 0) {
			finish();
			return;
		}
		if (!dragging) {
			if (
				event.clientY >= startRect.top - DRAG_THRESHOLD_PX &&
				event.clientY <= startRect.bottom + DRAG_THRESHOLD_PX
			) {
				return;
			}
			dragging = true;
			document.body.classList.add(DRAGGING_CLASS);
			style = document.createElement("style");
			style.textContent = "::selection{background:transparent}";
			document.head.append(style);
			rows = rowsIn(dragScope(name));
			view = currentSelectionView(queryClient);
		}
		const pointerId = rowAtY(rows, event.clientY);
		if (pointerId !== null && view !== null) {
			const {tree} = view;
			const ids = rangeFromDrag(
				rows.map((row) => row.id),
				(id) => tree.parentOf(id),
				nodeId,
				pointerId,
			);
			useOutlineStore.getState().setItemSelection(freshSelection(view, ids));
		}
	};

	const finish = () => {
		globalThis.removeEventListener("mousemove", onMove, true);
		globalThis.removeEventListener("mouseup", finish, true);
		if (!dragging) {
			return;
		}
		document.body.classList.remove(DRAGGING_CLASS);
		style?.remove();
		suppressNextClick();
		if (useOutlineStore.getState().itemSelection.entries.length > 0) {
			leaveEditor();
		}
	};

	globalThis.addEventListener("mousemove", onMove, true);
	globalThis.addEventListener("mouseup", finish, true);
}

/**
 * Upstream's mousedown on a row's `.content`: ⌘/⌥ toggles the row in the item selection, ⇧ selects from the pivot,
 * and a plain left press arms drag-select. Tags and links keep their own modifier clicks.
 */
export function useContentMouseDown(nodeId: string): (event: React.MouseEvent<HTMLElement>) => void {
	const queryClient = useQueryClient();
	return useCallback(
		(event: React.MouseEvent<HTMLElement>) => {
			const target = event.target instanceof Element ? event.target : null;
			const state = useOutlineStore.getState();
			const action = contentMouseDownAction(
				{
					button: event.button,
					metaKey: event.metaKey,
					ctrlKey: event.ctrlKey,
					altKey: event.altKey,
					shiftKey: event.shiftKey,
					onBullet: target?.closest(".bullet") != null,
					isEditingRow: state.editingId === nodeId,
				},
				isMacPlatform(),
			);
			if (action === null) {
				return;
			}
			if (action === "DRAG") {
				const name = event.currentTarget.closest(".name");
				if (name !== null) {
					armDragSelect(nodeId, name, queryClient);
				}
				return;
			}
			if (target?.closest("a, .contentTag") != null) {
				return;
			}
			event.preventDefault();
			const view = currentSelectionView(queryClient);
			const fallback = state.editingId ?? state.lastEditedId;
			leaveEditor();
			const selection = useOutlineStore.getState().itemSelection;
			useOutlineStore
				.getState()
				.setItemSelection(
					action === "TOGGLE"
						? toggleClick(selection, view.tree, nodeId)
						: pivotTo(selection, view.tree, nodeId, fallback),
				);
			suppressNextClick();
		},
		[nodeId, queryClient],
	);
}

/** A bullet click on a selected row clears the selection instead of zooming; returns whether it did. */
export function clearSelectionFromBullet(queryClient: QueryClient, id: string): boolean {
	const {itemSelection, clearItemSelection} = useOutlineStore.getState();
	if (itemSelection.entries.length === 0 || !isCovered(itemSelection, currentSelectionView(queryClient).tree, id)) {
		return false;
	}
	clearItemSelection();
	return true;
}
