import {useQueryClient} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import {useCallback} from "react";
import {useStableNavigate} from "./use-stable-navigate.js";
import type {NavigateFunction} from "react-router-dom";
import {caretTextOffset, editorElement} from "../caret-dom.js";
import {goToNode, planZoomFocus} from "../navigation.js";
import type {ZoomFocus} from "../navigation.js";
import {nodeKeys, readNode, seedResolvedId} from "../node-cache.js";
import {SIDE_PANE_ID} from "../pane-ids.js";
import {activeZoomedId, useOutlineStore} from "../stores/outline.js";
import {sortByPriority} from "../tree-position.js";
import {isPotentiallyVisible} from "../tree-ops.js";
import {ZOOMING_CLASS, runZoomAnimation, waitForZoomRow, zoomAnimationEnabled} from "../zoom-animation.js";
import {fetchChildren, prefetchZoomView} from "./use-nodes.js";
import {afterNextPaint} from "../after-paint.js";
import {showZoom} from "../show-zoom.js";
import {scrollSidePaneToTop} from "../components/pane-context.js";

/**
 * Upstream `zoomTo(target, focus)`: commit the edited text, navigate, then edit the row `planZoomFocus` picks and,
 * for `first_child`, scroll the outline to the top. `targetId` is the node to zoom into (null for home); it is
 * ignored by `last_selected`, which zooms out of the zoomed node. Zooming never changes expansion.
 *
 * While the side pane is active it zooms that pane instead of navigating, scrolling the pane's own scroller, without
 * the zoom animation (which finds rows document-wide).
 */
export function useZoomTo(): (targetId: string | null, focus: ZoomFocus) => Promise<void> {
	const navigate = useStableNavigate();
	const queryClient = useQueryClient();
	return useCallback(
		async (targetId: string | null, focus: ZoomFocus) => zoomTo(queryClient, navigate, targetId, focus),
		[queryClient, navigate],
	);
}

async function zoomTo(
	queryClient: QueryClient,
	navigate: NavigateFunction,
	targetId: string | null,
	focus: ZoomFocus,
): Promise<void> {
	const state = useOutlineStore.getState();
	const {editingId, showCompleted, animatingCompletionIds, resumeEditing, stopEditing, zoomSidePane} = state;
	const zoomedNodeId = activeZoomedId(state);
	const inSidePane = state.activePaneId === SIDE_PANE_ID && state.sidePane !== null;
	const editor = editingId === null ? null : editorElement(editingId);
	const previousOffset = editor ? caretTextOffset(editor) : 0;
	const parentOfZoomed = zoomedNodeId === null ? null : (readNode(queryClient, zoomedNodeId)?.parent_id ?? null);
	const zoomingInto = focus === "first_child" && targetId !== zoomedNodeId;
	// Load the new view's title, breadcrumbs and Backlinks alongside its children and during the zoom animation, so
	// the swap renders all of it in one commit.
	const viewTarget = focus === "first_child" ? targetId : parentOfZoomed;
	const viewLoaded =
		viewTarget === null || viewTarget === zoomedNodeId ? undefined : prefetchZoomView(queryClient, viewTarget);
	const children = zoomingInto
		? await queryClient.query({
				queryKey: nodeKeys.children(targetId),
				queryFn: async () => fetchChildren(targetId),
				staleTime: "static",
			})
		: undefined;
	const firstChild = sortByPriority(children ?? []).find((node) =>
		isPotentiallyVisible(node, showCompleted, animatingCompletionIds),
	);
	const plan = planZoomFocus(focus, {
		zoomedId: zoomedNodeId,
		targetId,
		firstChildId: firstChild?.id ?? null,
		parentOfZoomed,
		previousEditingId: editingId,
		previousOffset,
	});
	if (plan === null) {
		return;
	}
	editor?.blur();
	const destination = focus === "first_child" ? targetId : parentOfZoomed;
	// Upstream `isOut`: the zoomed node is a descendant of the destination. Bullet zooms only reach rows below the
	// zoomed node, so zooming out is `last_selected` or zooming home from a node.
	const isOut = focus === "last_selected" || (destination === null && zoomedNodeId !== null);
	const movingId = isOut ? zoomedNodeId : targetId;
	const isBoard = (id: string | null) => id !== null && readNode(queryClient, id)?.data.layoutMode === "board";
	const animate =
		!inSidePane && movingId !== null && zoomAnimationEnabled(isBoard(zoomedNodeId) || isBoard(destination));
	if (animate) {
		document.body.classList.add(ZOOMING_CLASS);
	}
	try {
		// Zooming in animates first, then navigates; zooming out navigates, then animates.
		if (animate && !isOut) {
			await runZoomAnimation(false, movingId);
		}
		await viewLoaded;
		// The new view paints first; focusing its edited row inside that frame would force a style and layout pass of
		// the whole outline before the paint. After it, style and layout are clean and the focus costs next to nothing.
		stopEditing();
		showZoom(destination, plan.scrollTop, {
			inSidePane,
			zoomSidePane,
			goToNode: (id) => {
				if (id !== null) {
					seedResolvedId(queryClient, id);
				}
				goToNode(navigate, id);
			},
			scrollToTop: (pane) => {
				if (pane === "side") {
					scrollSidePaneToTop();
				} else {
					globalThis.scrollTo(0, 0);
				}
			},
		});
		if (plan.editId !== null) {
			await afterNextPaint();
			const after = useOutlineStore.getState();
			if (after.editingId === null && activeZoomedId(after) === destination) {
				resumeEditing(plan.editId, plan.offset);
			}
		}
		if (animate && isOut) {
			await waitForZoomRow(movingId);
			await runZoomAnimation(true, movingId);
		}
	} finally {
		if (animate) {
			document.body.classList.remove(ZOOMING_CLASS);
		}
	}
}
