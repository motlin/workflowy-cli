import {useQueryClient} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import {useCallback} from "react";
import {
	IDLE_BULLET_DRAG,
	buildDropRows,
	bulletDragReducer,
	dropBulletDrag,
	dropIndicatorFor,
} from "../bullet-drag-state.js";
import type {BulletDragAction, BulletDragState} from "../bullet-drag-state.js";
import {readChildren, readNode} from "../node-cache.js";
import {resolveDropTarget} from "../outline-drop-target.js";
import type {DropRows} from "../outline-drop-target.js";
import {useOutlineStore} from "../stores/outline.js";
import {rowHasChildren} from "../tree-ops.js";
import {sortByPriority} from "../tree-position.js";
import {leaveEditor} from "./use-drag-select.js";
import {useMoveNodes} from "./use-nodes.js";
import {HOME_ROOT, currentSelectionView} from "./use-selection-keymap.js";

const GHOST_CLONE_LIMIT = 5;
/** Half the 18px bullet: the ghost's bullet starts centered on the pointer. */
const GHOST_OFFSET_PX = 9;
/** The hit point stays this far inside the outline's horizontal edges. */
const HIT_INSET_PX = 6;
const ROW_BULLET = "a.bullet[data-item-id]:not(.bullet--backlink-root)";

function childIdsOf(queryClient: QueryClient, id: string): string[] {
	return sortByPriority(readChildren(queryClient, id === HOME_ROOT ? null : id) ?? []).map((child) => child.id);
}

function outlineRows(queryClient: QueryClient, container: Element): {rows: DropRows; zoomRootId: string} {
	const {tree} = currentSelectionView(queryClient);
	const {expandedIds, showCompleted} = useOutlineStore.getState();
	const projectOf = (id: string): Element | null =>
		id === tree.zoomRootId
			? container.querySelector(".project.root")
			: (container.querySelector(`${ROW_BULLET}[data-item-id="${CSS.escape(id)}"]`)?.closest(".project") ?? null);
	const rows = buildDropRows({
		order: tree.visibleOrder,
		parentOf: (id) => tree.parentOf(id),
		childIdsOf: (id) => childIdsOf(queryClient, id),
		isCollapsed: (id) => {
			const node = readNode(queryClient, id);
			return (
				id !== tree.zoomRootId &&
				!expandedIds.has(id) &&
				node !== undefined &&
				rowHasChildren(node, showCompleted)
			);
		},
		left: (id) => projectOf(id)?.getBoundingClientRect().left ?? 0,
	});
	return {rows, zoomRootId: tree.zoomRootId};
}

/**
 * The row whose content lies under the point: upstream takes the first element inside a `.name` or `.notes`,
 * or inside a `.project` but not inside its `.children`.
 */
function hitRowId(x: number, y: number, container: Element, zoomRootId: string): string | null {
	for (const element of document.elementsFromPoint(x, y)) {
		const project = element.closest(".project");
		if (project === null || !container.contains(project)) {
			continue;
		}
		const children = element.closest(".children");
		const inContent = element.closest(".name, .notes") !== null;
		if (inContent || children === null || !project.contains(children)) {
			return project.classList.contains("root")
				? zoomRootId
				: (project.querySelector(`:scope > .name > ${ROW_BULLET}`)?.getAttribute("data-item-id") ?? null);
		}
	}
	return null;
}

function makeGhost(bullet: HTMLElement, x: number, y: number, count: number): HTMLElement {
	const ghost = document.createElement("div");
	ghost.className = "dragging";
	Object.assign(ghost.style, {
		position: "fixed",
		zIndex: "200",
		top: `${y - GHOST_OFFSET_PX}px`,
		left: `${x - GHOST_OFFSET_PX}px`,
		pointerEvents: "none",
		transform: "translate3d(0px, 0px, 0px)",
	});
	for (let index = 0; index < Math.min(count, GHOST_CLONE_LIMIT); index++) {
		const clone = bullet.cloneNode(true);
		if (!(clone instanceof HTMLElement)) {
			continue;
		}
		delete clone.dataset.preDragClick;
		Object.assign(clone.style, {
			left: "0",
			top: `${index * 10}px`,
			opacity: String(1 - index / GHOST_CLONE_LIMIT),
			zIndex: String(GHOST_CLONE_LIMIT - index),
			visibility: "visible",
		});
		ghost.append(clone);
	}
	return ghost;
}

/**
 * Upstream's mouse-driven bullet drag: a press on the bullet arms it, a 3px move starts it (ghost, hidden
 * source bullet, `.moving` rows), each move re-resolves the drop target, release moves the row through the API,
 * and Escape cancels. A press released before the threshold is a click, which zooms.
 */
export function useBulletDrag(nodeId: string): (event: React.MouseEvent<HTMLAnchorElement>) => void {
	const queryClient = useQueryClient();
	const moveNodes = useMoveNodes();

	return useCallback(
		(event: React.MouseEvent<HTMLAnchorElement>) => {
			// ⌘/Ctrl-click keeps the link's href.
			if (event.button !== 0 || event.ctrlKey || event.metaKey) {
				return;
			}
			event.preventDefault();
			const bullet = event.currentTarget;
			bullet.dataset.preDragClick = "true";
			// Alt (duplicate) and Shift (mirror) drags are not built yet; the press still clicks to zoom.
			if (event.altKey || event.shiftKey) {
				return;
			}
			const container = bullet.closest(".outline-tree-container") ?? document.body;
			const sourceRow = bullet.closest(".project");
			const node = readNode(queryClient, nodeId);
			if (node === undefined || sourceRow === null) {
				return;
			}
			const parentId = node.parent_id ?? HOME_ROOT;
			const {clientX: startX, clientY: startY} = event;
			let state: BulletDragState = bulletDragReducer(IDLE_BULLET_DRAG, {
				type: "start",
				id: nodeId,
				x: startX,
				y: startY,
				parentId,
				index: childIdsOf(queryClient, parentId).indexOf(nodeId),
			});
			let ghost: HTMLElement | null = null;
			let rowTop = 0;
			const {setBulletDrag} = useOutlineStore.getState();

			const dispatch = (action: BulletDragAction) => {
				state = bulletDragReducer(state, action);
				setBulletDrag(state.draggingIds, state.indicator);
			};

			const begin = () => {
				leaveEditor();
				delete bullet.dataset.preDragClick;
				rowTop = sourceRow.getBoundingClientRect().top;
				document.body.classList.add("moving");
				ghost = makeGhost(bullet, startX, startY, state.draggingIds.length);
				document.body.append(ghost);
				bullet.style.visibility = "hidden";
				setBulletDrag(state.draggingIds, null);
			};

			const hover = (x: number, y: number) => {
				const bounds = container.getBoundingClientRect();
				const hitX = Math.min(Math.max(x, bounds.left + HIT_INSET_PX), bounds.right - HIT_INSET_PX);
				const hitY = rowTop + (y - startY) - 1;
				const {rows, zoomRootId} = outlineRows(queryClient, container);
				const predecessorId = hitRowId(hitX, hitY, container, zoomRootId);
				if (predecessorId === null) {
					return;
				}
				const target = resolveDropTarget({
					x: hitX,
					rows,
					predecessorId,
					movingIds: new Set(state.draggingIds),
					zoomRootId,
				});
				const indicator = dropIndicatorFor(
					target,
					target === null ? [] : childIdsOf(queryClient, target.parentId),
				);
				dispatch({type: "hover", target, indicator});
			};

			const onMove = (moveEvent: MouseEvent) => {
				const wasDragging = state.phase === "dragging";
				state = bulletDragReducer(state, {type: "move", x: moveEvent.clientX, y: moveEvent.clientY});
				if (state.phase !== "dragging") {
					return;
				}
				if (!wasDragging) {
					begin();
				}
				if (ghost !== null) {
					ghost.style.transform = state.ghostTransform ?? "";
				}
				hover(moveEvent.clientX, moveEvent.clientY);
			};

			const onLeaveWindow = (outEvent: MouseEvent) => {
				if (outEvent.relatedTarget === null) {
					dispatch({type: "leave"});
				}
			};

			const finish = () => {
				globalThis.removeEventListener("mousemove", onMove, true);
				globalThis.removeEventListener("mouseup", onUp, true);
				globalThis.removeEventListener("keydown", onKeyDown, true);
				document.removeEventListener("mouseout", onLeaveWindow, true);
				if (ghost !== null) {
					ghost.remove();
					bullet.style.visibility = "";
					document.body.classList.remove("moving");
				}
				setBulletDrag([], null);
			};

			const onUp = () => {
				const {effect} = dropBulletDrag(state);
				state = IDLE_BULLET_DRAG;
				finish();
				if (effect !== null) {
					moveNodes.mutate({
						ids: [...effect.ids],
						parent_id: effect.parentId === HOME_ROOT ? null : effect.parentId,
						index: effect.index,
					});
				}
			};

			const onKeyDown = (keyEvent: KeyboardEvent) => {
				if (keyEvent.key !== "Escape" || state.phase !== "dragging") {
					return;
				}
				keyEvent.preventDefault();
				keyEvent.stopPropagation();
				delete bullet.dataset.preDragClick;
				state = bulletDragReducer(state, {type: "cancel"});
				finish();
			};

			globalThis.addEventListener("mousemove", onMove, true);
			globalThis.addEventListener("mouseup", onUp, true);
			globalThis.addEventListener("keydown", onKeyDown, true);
			document.addEventListener("mouseout", onLeaveWindow, true);
		},
		[nodeId, queryClient, moveNodes],
	);
}
