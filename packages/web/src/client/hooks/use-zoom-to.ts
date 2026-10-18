import {useQueryClient} from "@tanstack/react-query";
import {useNavigate} from "react-router-dom";
import {caretTextOffset, editorElement} from "../caret-dom.js";
import {goToNode, planZoomFocus} from "../navigation.js";
import type {ZoomFocus} from "../navigation.js";
import {nodeKeys, readNode} from "../node-cache.js";
import {useOutlineStore} from "../stores/outline.js";
import {sortByPriority} from "../tree-position.js";
import {isPotentiallyVisible} from "../tree-ops.js";
import {fetchChildren} from "./use-nodes.js";

/**
 * Upstream `zoomTo(target, focus)`: commit the edited text, navigate, then edit the row `planZoomFocus` picks and,
 * for `first_child`, scroll the outline to the top. `targetId` is the node to zoom into (null for home); it is
 * ignored by `last_selected`, which zooms out of the zoomed node. Zooming never changes expansion.
 */
export function useZoomTo(): (targetId: string | null, focus: ZoomFocus) => Promise<void> {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	return async (targetId, focus) => {
		const {zoomedNodeId, editingId, showCompleted, animatingCompletionIds, resumeEditing, stopEditing} =
			useOutlineStore.getState();
		const editor = editingId === null ? null : editorElement(editingId);
		const previousOffset = editor ? caretTextOffset(editor) : 0;
		const parentOfZoomed = zoomedNodeId === null ? null : (readNode(queryClient, zoomedNodeId)?.parent_id ?? null);
		const zoomingInto = focus === "first_child" && targetId !== zoomedNodeId;
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
		goToNode(navigate, focus === "first_child" ? targetId : parentOfZoomed);
		if (plan.scrollTop) {
			document.querySelector(".outline-container")?.scrollTo(0, 0);
		}
		if (plan.editId === null) {
			stopEditing();
		} else {
			resumeEditing(plan.editId, plan.offset);
		}
	};
}
