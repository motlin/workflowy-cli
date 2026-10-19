import {useQueryClient} from "@tanstack/react-query";
import {useNavigate} from "react-router-dom";
import {caretAnchor, caretTextOffset, editorElement} from "../caret-dom.js";
import type {AnchorRect} from "../caret-dom.js";
import {editingAfterRemoval} from "../caret-navigation.js";
import {executeMoveTo} from "../move-to.js";
import type {LoadedMoveTarget} from "../move-to.js";
import {goToNode} from "../navigation.js";
import {readChildren, readNode} from "../node-cache.js";
import {useOutlineStore} from "../stores/outline.js";
import type {CaretReturn} from "../stores/outline.js";
import {sortByPriority} from "../tree-position.js";
import {captureOutlineView, runInUndoBatch} from "../undo-batch.js";
import {fetchAncestors, fetchChildren, fetchNode, useMoveNode} from "./use-nodes.js";
import {currentNavigableIds} from "./use-visible-nodes.js";

const NO_RECT: AnchorRect = {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0};

/** The picker anchor in page coordinates: the caret box when editing `itemId`, else the row's `.name`. */
function moveToAnchor(itemId: string, editing: boolean): {x: number; y: number} {
	const selection = globalThis.getSelection();
	const caret =
		editing && selection !== null && selection.rangeCount > 0
			? selection.getRangeAt(0).getBoundingClientRect()
			: null;
	const row = document
		.querySelector(`.innerContentContainer[data-node-id="${CSS.escape(itemId)}"]`)
		?.closest(".name")
		?.getBoundingClientRect();
	const {x, y} = caretAnchor(caret, row ?? NO_RECT);
	return {x: x + window.scrollX, y: y + window.scrollY};
}

async function loadMoveTarget(id: string): Promise<LoadedMoveTarget> {
	const node = await fetchNode(id);
	const [children, ancestors] = await Promise.all([fetchChildren(id), fetchAncestors(id)]);
	const parents = new Map(ancestors.map((ancestor) => [ancestor.id, ancestor.parent_id]));
	return {
		target: {id, name: node.name ?? "", defaultToBottom: node.defaultToBottom === true},
		childCount: children.length,
		parentOf: (nodeId) => parents.get(nodeId) ?? null,
	};
}

/**
 * Upstream Move To (`⌃⌘M`, bullet menu `Move To...`): open the location picker at the caret (or the row), move the
 * item into the chosen location without expanding it, and move the caret to the previous visible row.
 */
export function useMoveTo(): (itemId: string) => Promise<void> {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const {mutate: moveNode} = useMoveNode();

	return async (itemId) => {
		const node = readNode(queryClient, itemId);
		if (node === undefined) {
			return;
		}
		const store = useOutlineStore.getState();
		const editor = store.editingId === itemId ? editorElement(itemId) : null;
		const returnTo: CaretReturn | undefined =
			editor === null ? undefined : {nodeId: itemId, offset: caretTextOffset(editor)};
		const siblings = sortByPriority(readChildren(queryClient, node.parent_id) ?? []);
		await executeMoveTo({
			itemId,
			from: {
				parentId: node.parent_id,
				index: Math.max(
					0,
					siblings.findIndex((sibling) => sibling.id === itemId),
				),
			},
			pick: async () =>
				store.openLocationPicker(
					{forItemId: itemId, headerText: "Move To..."},
					moveToAnchor(itemId, editor !== null),
					returnTo,
				),
			loadTarget: loadMoveTarget,
			leaveItem: () => {
				const outline = useOutlineStore.getState();
				if (outline.editingId !== itemId) {
					return;
				}
				const next = editingAfterRemoval(currentNavigableIds(queryClient), itemId);
				if (next === null) {
					outline.stopEditing();
				} else {
					outline.resumeEditing(next.nodeId, next.caretOffset);
				}
			},
			moveNode: (request) => {
				void runInUndoBatch(captureOutlineView, () => {
					moveNode(request);
				});
			},
			showToast: ({text, timeout, actions}) => {
				useOutlineStore.getState().showAppMessage(text, {timeout, actions});
			},
			view: (targetId) => {
				goToNode(navigate, targetId);
			},
		});
	};
}
