import {useCallback} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {nodeUrl, stepNav} from "../navigation.js";
import {nodeKeys} from "../node-cache.js";
import type {NodeResponse} from "../../node-types.js";
import {useNavigate} from "react-router-dom";
import {useOutlineStore} from "../stores/outline.js";
import {sortByPriority} from "../tree-position.js";
import {caretTextOffset, editorElement} from "../caret-dom.js";
import {editingAfterRemoval, planCompleteFocus} from "../caret-navigation.js";
import {
	cacheMoveTree,
	planDuplicate,
	planIndent,
	planOutdent,
	planToggleComplete,
	planVerticalMove,
} from "../tree-ops.js";
import type {MoveNodePayload} from "../tree-ops.js";
import {
	useChildren,
	useCreateNode,
	useDeleteNode,
	useMoveNode,
	useNode,
	useToggleComplete,
	useUpdateNode,
} from "./use-nodes.js";
import {currentNavigableIds} from "./use-visible-nodes.js";
import {zoomToToday} from "../zoom-to-today.js";
import {scheduleCompletionHide} from "../completion-animation.js";
import type {CommandContext, CommandRegistry} from "../keys/dispatch.js";

type LayoutMode = "bullets" | "todo" | "h1" | "h2" | "h3" | "paragraph";

/**
 * The outline's commands, keyed by upstream command id, for the global keymap to dispatch.
 *
 * Like workflowy.com there is no "selected but not editing" state: the node being edited is the only item, and
 * every item command acts on `ctx.items` (the edited node, or nothing). Moving between nodes is caret movement
 * (Up/Down at a node's edge, handled by EditableText, which also owns Enter, Backspace and Escape).
 *
 * Navigation commands commit the edited text before leaving. Structural commands keep the caret and unsaved text
 * in place: they hold editing across the re-render so the edited row keeps (or regains) focus.
 *
 * `navigate_to_prev_item` / `navigate_to_next_item` (⇧⌘9 / ⇧⌘0) still edit the edited node's sibling, and
 * `focus_prev_sibling` / `focus_next_sibling` (⌥⌘↑ / ⌥⌘↓) still zoom to the zoomed node's sibling; the layout
 * commands set the layout rather than toggling it.
 */
export function useCommandRegistry(): CommandRegistry {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const zoomedNodeId = useOutlineStore((state) => state.zoomedNodeId);
	const editingId = useOutlineStore((state) => state.editingId);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const resumeEditing = useOutlineStore((state) => state.resumeEditing);
	const stopEditing = useOutlineStore((state) => state.stopEditing);
	const holdEditing = useOutlineStore((state) => state.holdEditing);
	const releaseEditing = useOutlineStore((state) => state.releaseEditing);
	const flashMoving = useOutlineStore((state) => state.flashMoving);
	const toggleLeftBar = useOutlineStore((state) => state.toggleLeftBar);
	const toggleRightSidebar = useOutlineStore((state) => state.toggleRightSidebar);
	const toggleCompleted = useOutlineStore((state) => state.toggleCompleted);
	const toggleStarPage = useOutlineStore((state) => state.toggleStarPage);
	const searchPanelOpen = useOutlineStore((state) => state.searchPanelOpen);
	const toggleJumpMenu = useOutlineStore((state) => state.toggleJumpMenu);
	const expand = useOutlineStore((state) => state.expand);
	const collapse = useOutlineStore((state) => state.collapse);
	const openLinkInsert = useOutlineStore((state) => state.openLinkInsert);
	const openExportDialog = useOutlineStore((state) => state.openExportDialog);
	const createNodeMutation = useCreateNode();
	const moveNodeMutation = useMoveNode();
	const deleteNodeMutation = useDeleteNode();
	const toggleCompleteMutation = useToggleComplete();
	const updateNodeMutation = useUpdateNode();

	// The zoomed node's parent and siblings, for zooming out and to its siblings
	const {data: zoomedNode} = useNode(zoomedNodeId);
	const {data: zoomedNodeSiblings} = useChildren(zoomedNode?.parent_id ?? null);

	// The edited node is the only item commands act on
	const {data: editedNode} = useNode(editingId);

	/** The loaded node of the command's item, or undefined with no item. */
	const itemNode = (ctx: CommandContext): NodeResponse | undefined => {
		const [itemId] = ctx.items;
		return itemId !== undefined && editedNode?.id === itemId ? editedNode : undefined;
	};

	/** Commit the edited text and stop editing, exactly as clicking away would. */
	const commitEdit = useCallback(() => {
		if (editingId !== null) {
			editorElement(editingId)?.blur();
		}
	}, [editingId]);

	/**
	 * Move the edited node, keeping its caret and unsaved text through the re-render,
	 * after expanding its new parent when the plan asks for it.
	 */
	const moveEditedNode = useCallback(
		(plan: (MoveNodePayload & {expandParentId?: string | null}) | null) => {
			if (plan === null) {
				return;
			}
			const {expandParentId, ...payload} = plan;
			if (expandParentId !== undefined && expandParentId !== null) {
				expand(expandParentId);
			}
			const editor = editorElement(payload.nodeId);
			holdEditing(editor ? caretTextOffset(editor) : Number.MAX_SAFE_INTEGER);
			moveNodeMutation.mutate(payload, {onSettled: releaseEditing});
		},
		[expand, holdEditing, releaseEditing, moveNodeMutation],
	);

	/** Swap with a sibling or cross into the parent's sibling, expanding it. */
	const moveEditedNodeVertically = (ctx: CommandContext, direction: "up" | "down"): void => {
		const [nodeId] = ctx.items;
		if (nodeId === undefined) {
			return;
		}
		const plan = planVerticalMove({
			nodeId,
			direction,
			zoomRootId: zoomedNodeId,
			tree: cacheMoveTree(queryClient, useOutlineStore.getState()),
		});
		if (plan === null) {
			return;
		}
		moveEditedNode({
			nodeId: plan.nodeId,
			parent_id: plan.parentId,
			index: plan.index,
			expandParentId: plan.expandParentId,
		});
		flashMoving(plan.nodeId);
	};

	/** Continue editing beside the edited node, which is about to leave the view. */
	const editBesideRemovedNode = (nodeId: string): void => {
		const next = editingAfterRemoval(currentNavigableIds(queryClient), nodeId);
		if (next === null) {
			stopEditing();
		} else {
			resumeEditing(next.nodeId, next.caretOffset);
		}
	};

	const setLayoutMode = (ctx: CommandContext, layoutMode: LayoutMode): void => {
		for (const nodeId of ctx.items) {
			updateNodeMutation.mutate({nodeId, layoutMode});
		}
	};

	/** The edited node's sibling `step` places away in priority order, or null past either end. */
	const siblingOfItem = (ctx: CommandContext, step: -1 | 1): string | null => {
		const node = itemNode(ctx);
		if (node === undefined) {
			return null;
		}
		const siblings = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(node.parent_id));
		if (!siblings) {
			return null;
		}
		const sorted = sortByPriority(siblings);
		const index = sorted.findIndex((sibling) => sibling.id === node.id);
		return index === -1 ? null : (sorted[index + step]?.id ?? null);
	};

	/** Commit the edited text, then edit the item's sibling `step` places away with the caret at its end. */
	const editSibling = (ctx: CommandContext, step: -1 | 1): void => {
		const siblingId = siblingOfItem(ctx, step);
		if (siblingId !== null) {
			commitEdit();
			resumeEditing(siblingId, Number.MAX_SAFE_INTEGER);
		}
	};

	/** Zoom to the zoomed node's sibling `step` places away, if there is one. */
	const zoomToSibling = (step: -1 | 1): void => {
		if (zoomedNodeId === null || zoomedNode === undefined || !zoomedNodeSiblings) {
			return;
		}
		const sorted = sortByPriority(zoomedNodeSiblings);
		const index = sorted.findIndex((sibling) => sibling.id === zoomedNodeId);
		const sibling = index === -1 ? undefined : sorted[index + step];
		if (sibling !== undefined) {
			commitEdit();
			void navigate(nodeUrl(sibling.id));
		}
	};

	/** Toggle complete on the edited node and move the caret as upstream does. */
	const complete = (ctx: CommandContext): void => {
		const node = itemNode(ctx);
		if (node === undefined) {
			return;
		}
		const plan = planToggleComplete([node]);
		if (plan.action === "none") {
			return;
		}
		const completing = plan.action === "complete";
		const siblings = sortByPriority(
			queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(node.parent_id)) ?? [],
		);
		const focus = planCompleteFocus({
			ids: plan.ids,
			completing,
			showCompleted,
			zoomRootId: zoomedNodeId,
			siblingsOf: () => siblings.map((sibling) => sibling.id),
			visibleRows: currentNavigableIds(queryClient),
			completedIds: new Set(
				siblings.filter((sibling) => sibling.completedAt !== null).map((sibling) => sibling.id),
			),
		});

		// Commit the edited text before the caret moves; "stay" keeps editing in place
		if (focus.kind !== "stay") {
			commitEdit();
		}
		if (focus.kind === "row") {
			resumeEditing(focus.id, focus.offset);
		} else if (focus.kind === "zoomTitle" && zoomedNodeId !== null) {
			resumeEditing(zoomedNodeId, 0);
		}

		const parentOfZoomed = zoomedNode?.parent_id ?? null;
		const zoomOutAfterSettling =
			focus.kind === "zoomOut"
				? {
						onSettled() {
							setTimeout(() => {
								void navigate(parentOfZoomed === null ? "/" : nodeUrl(parentOfZoomed));
							}, focus.delayMs);
						},
					}
				: undefined;
		// Hidden completed rows stay for upstream's deferred hide; the caret has already moved
		if (completing && !showCompleted) {
			const parentId = node.parent_id;
			scheduleCompletionHide(plan.ids, useOutlineStore.getState(), (id) => {
				const current = queryClient
					.getQueryData<NodeResponse[]>(nodeKeys.children(parentId))
					?.find((sibling) => sibling.id === id);
				return !useOutlineStore.getState().showCompleted && current?.completedAt !== null;
			});
		}
		for (const nodeId of plan.ids) {
			toggleCompleteMutation.mutate({nodeId, isCurrentlyCompleted: !completing}, zoomOutAfterSettling);
		}
	};

	/** Open the link-insert modal for a text selection in the edited node, else the jump menu. */
	const showSwitcher = (ctx: CommandContext): void => {
		if (searchPanelOpen) {
			return;
		}
		const [itemId] = ctx.items;
		const selection = globalThis.getSelection();
		if (selection && !selection.isCollapsed && itemId !== undefined) {
			const selectedText = selection.toString().trim();
			if (selectedText) {
				openLinkInsert({selectedText, nodeId: itemId, range: selection.getRangeAt(0).cloneRange()});
				return;
			}
		}
		toggleJumpMenu();
	};

	return {
		zoom_in: {
			execute(ctx) {
				const [nodeId] = ctx.items;
				if (nodeId !== undefined) {
					commitEdit();
					void navigate(nodeUrl(nodeId));
				}
			},
		},
		zoom_out: {
			execute() {
				if (zoomedNodeId === null) {
					return;
				}
				commitEdit();
				const parentId = zoomedNode?.parent_id;
				void navigate(parentId ? nodeUrl(parentId) : "/");
			},
		},
		navigate_home: {
			execute() {
				commitEdit();
				void navigate("/");
			},
		},
		navigate_backward: {
			execute() {
				commitEdit();
				stepNav(navigate, "back");
			},
		},
		navigate_forward: {
			execute() {
				commitEdit();
				stepNav(navigate, "forward");
			},
		},
		navigate_to_today: {
			execute() {
				commitEdit();
				void zoomToToday({navigate});
			},
		},
		navigate_to_prev_item: {
			execute(ctx) {
				editSibling(ctx, -1);
			},
		},
		navigate_to_next_item: {
			execute(ctx) {
				editSibling(ctx, 1);
			},
		},
		focus_prev_sibling: {
			execute() {
				zoomToSibling(-1);
			},
		},
		focus_next_sibling: {
			execute() {
				zoomToSibling(1);
			},
		},
		expand: {
			execute(ctx) {
				for (const nodeId of ctx.items) {
					expand(nodeId);
				}
			},
		},
		collapse: {
			execute(ctx) {
				for (const nodeId of ctx.items) {
					collapse(nodeId);
				}
			},
		},
		indent: {
			execute(ctx) {
				const node = itemNode(ctx);
				if (node !== undefined) {
					moveEditedNode(planIndent(queryClient, node, useOutlineStore.getState().expandedIds));
				}
			},
		},
		outdent: {
			execute(ctx) {
				const node = itemNode(ctx);
				if (node !== undefined) {
					moveEditedNode(planOutdent(queryClient, node, zoomedNodeId));
				}
			},
		},
		move_up: {
			execute(ctx) {
				moveEditedNodeVertically(ctx, "up");
			},
		},
		move_down: {
			execute(ctx) {
				moveEditedNodeVertically(ctx, "down");
			},
		},
		complete: {execute: complete},
		duplicate: {
			execute(ctx) {
				const node = itemNode(ctx);
				if (node === undefined) {
					return;
				}
				// Copy the unsaved text too
				const name = editorElement(node.id)?.innerHTML ?? node.name;
				commitEdit();
				createNodeMutation.mutate(planDuplicate(queryClient, {...node, name}), {
					onSuccess(createdNode) {
						resumeEditing(createdNode.id, Number.MAX_SAFE_INTEGER);
					},
				});
			},
		},
		delete: {
			execute(ctx) {
				const [nodeId] = ctx.items;
				if (nodeId !== undefined) {
					editBesideRemovedNode(nodeId);
					deleteNodeMutation.mutate(nodeId);
				}
			},
		},
		toggle_bullet: {
			execute(ctx) {
				setLayoutMode(ctx, "bullets");
			},
		},
		toggle_todo: {
			execute(ctx) {
				setLayoutMode(ctx, "todo");
			},
		},
		toggle_h1: {
			execute(ctx) {
				setLayoutMode(ctx, "h1");
			},
		},
		toggle_h2: {
			execute(ctx) {
				setLayoutMode(ctx, "h2");
			},
		},
		toggle_h3: {
			execute(ctx) {
				setLayoutMode(ctx, "h3");
			},
		},
		toggle_paragraph: {
			execute(ctx) {
				setLayoutMode(ctx, "paragraph");
			},
		},
		toggle_leftbar: {execute: toggleLeftBar},
		toggle_rightbar: {execute: toggleRightSidebar},
		show_or_hide_completed: {execute: toggleCompleted},
		star_current_item: {
			execute(ctx) {
				if (ctx.zoomedId !== null) {
					toggleStarPage(ctx.zoomedId);
				}
			},
		},
		show_switcher: {execute: showSwitcher},
		show_export: {
			execute(ctx) {
				if (ctx.items.length > 0) {
					commitEdit();
					openExportDialog({nodeIds: [...ctx.items]});
				}
			},
		},
	};
}
