import {useCallback} from "react";
import {flushSync} from "react-dom";
import {notifyManager, useQueryClient} from "@tanstack/react-query";
import {closeMainPane, goToNode, movePane, nodeUrl, stepNav} from "../navigation.js";
import {cachedResolvedId, nodeKeys, readChildren, readItemNode, readNode} from "../node-cache.js";
import type {NodeResponse} from "../../node-types.js";
import {useStableNavigate} from "./use-stable-navigate.js";
import {activePaneView, activeZoomedId, flushEditing, useOutlineStore} from "../stores/outline.js";
import {sortByPriority} from "../tree-position.js";
import {caretTextOffset, editorElement, placeCaretAtTextOffset} from "../caret-dom.js";
import {editingAfterRemoval, firstLastNavigable, planCompleteFocus} from "../caret-navigation.js";
import {
	cacheMoveTree,
	isPotentiallyVisible,
	rowHasChildren,
	nextPotentiallyVisibleSibling,
	planBlockMove,
	planDuplicate,
	planFocusSibling,
	planIndent,
	planOutdent,
	planToggleComplete,
	planVerticalMove,
} from "../tree-ops.js";
import type {BlockMoveDirection, MoveNodePayload} from "../tree-ops.js";
import {
	fetchChildren,
	sendBlockMoves,
	useChildren,
	useCreateNode,
	useDeleteNode,
	useMoveNode,
	useMoveNodes,
	useNode,
	useToggleComplete,
	undoAdapter,
	useExpandAll,
	useUpdateNode,
} from "./use-nodes.js";
import {collectVisibleNodeIds, currentExpansionRows, currentNavigableIds} from "./use-visible-nodes.js";
import {createDoublePressDetector, planExpandKey} from "../expansion.js";
import type {ExpandKey} from "../expansion.js";
import {useNavigateToToday} from "./use-navigate-to-today.js";
import {useZoomTo} from "./use-zoom-to.js";
import {useMoveTo} from "./use-move-to.js";
import {scheduleCompletionHide} from "../completion-animation.js";
import type {Command, CommandContext, CommandRegistry} from "../keys/dispatch.js";
import {saveAndSyncCommand} from "../save-and-sync.js";
import {renderEditorHtml, serializeEditorHtml} from "../editor-html.js";
import {planLayoutHotkey} from "../layout-hotkeys.js";
import type {LayoutToggleCommand} from "../layout-types.js";
import {toggleBoardOrTable} from "../item-type-select.js";
import type {ItemTypeSelectDeps} from "../item-type-select.js";
import {useCopyLink, useSortChildren} from "./use-item-actions.js";
import {useDateSettings} from "./use-preferences.js";
import {plainLength} from "../rich-text.js";
import {applyOps, captureOutlineView, runInUndoBatch, settleUndoNow} from "../undo-batch.js";
import {undoHistory} from "../undo-history.js";
import {queueUndo} from "../undo-view-state.js";
import {holdUndoReplay, previewUndoOps} from "../undo-cache.js";
import {deleteSelectedItems} from "./use-selection-keymap.js";
import {useStarActions} from "./use-starred.js";
import {useShowCompletedToggle} from "./use-show-completed-toggle.js";
import {showCompletedCommand} from "../show-completed-toggle.js";
import {switcherStepCommand} from "../switcher-keys.js";
import {paneCommands, paneNavCommands, paneNumberCommands} from "../pane-commands.js";
import {captureActivePaneCaret, scrollPaneToTop} from "../components/pane-context.js";
import {restorableCaret} from "../pane-caret.js";
import {MAIN_PANE_ID} from "../pane-ids.js";
import type {UndoDirection, UndoRunner} from "../undo-view-state.js";

/** Pairs two ⌃Space presses on the same row (upstream's 250ms window). */
const toggleDetector = createDoublePressDetector();

/** The ids of `nodes` the outline can show, in priority order. */
function potentiallyVisibleIds(nodes: NodeResponse[] | undefined): string[] {
	const {showCompleted, animatingCompletionIds} = useOutlineStore.getState();
	return sortByPriority(nodes ?? [])
		.filter((node) => isPotentiallyVisible(node, showCompleted, animatingCompletionIds))
		.map((node) => node.id);
}

/** Whether items are selected, so `ctx.items` is the selection rather than the edited row. */
function hasItemSelection(): boolean {
	return useOutlineStore.getState().itemSelection.entries.length > 0;
}

/** A command on the single item, as upstream's palette-only item commands. */
function singleItemCommand(run: (nodeId: string) => void): Command {
	return {
		available: (ctx) => ctx.items.length === 1,
		execute(ctx) {
			const [nodeId] = ctx.items;
			if (nodeId !== undefined) {
				run(nodeId);
			}
		},
	};
}

function isJumpMenuOpen(): boolean {
	return useOutlineStore.getState().jumpMenuOpen;
}

/**
 * The outline's commands, keyed by upstream command id, for the global keymap to dispatch.
 *
 * Every item command acts on `ctx.items`: the item selection in display order, else the edited node, else nothing.
 * Complete, delete and export act on every selected item and clear the selection; duplicate keeps it; indent,
 * outdent and moves move the selection as blocks and keep it. Moving between nodes is caret movement
 * (Up/Down at a node's edge, handled by editableText, which also owns Enter, Backspace and Escape).
 *
 * Navigation commands commit the edited text before leaving. Structural commands keep the caret and unsaved text
 * in place: they hold editing across the re-render so the edited row keeps (or regains) focus.
 *
 * As upstream, `navigate_to_prev_item` / `navigate_to_next_item` (⇧⌘9 / ⇧⌘0) zoom to the zoomed page's sibling,
 * and `focus_prev_sibling` / `focus_next_sibling` (⌥⌘↑ / ⌥⌘↓) move the caret to the edited row's sibling; the
 * layout commands set the layout rather than toggling it.
 */
export function useCommandRegistry(): CommandRegistry {
	const navigate = useStableNavigate();
	const queryClient = useQueryClient();
	const zoomedNodeId = useOutlineStore(activeZoomedId);
	const editingId = useOutlineStore((state) => state.editingId);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const resumeEditing = useOutlineStore((state) => state.resumeEditing);
	const stopEditing = useOutlineStore((state) => state.stopEditing);
	const holdEditing = useOutlineStore((state) => state.holdEditing);
	const releaseEditing = useOutlineStore((state) => state.releaseEditing);
	const flashMoving = useOutlineStore((state) => state.flashMoving);
	const toggleLeftBar = useOutlineStore((state) => state.toggleLeftBar);
	const toggleRightBar = useOutlineStore((state) => state.toggleRightBar);
	const toggleShowCompleted = useShowCompletedToggle();
	const {toggleStar} = useStarActions();
	const openJumpMenu = useOutlineStore((state) => state.openJumpMenu);
	const closeJumpMenu = useOutlineStore((state) => state.closeJumpMenu);
	const expand = useOutlineStore((state) => state.expand);
	const collapse = useOutlineStore((state) => state.collapse);
	const toggleExpand = useOutlineStore((state) => state.toggleExpand);
	const replaceExpanded = useOutlineStore((state) => state.replaceExpanded);
	const expandAll = useExpandAll();
	const openLinkInsert = useOutlineStore((state) => state.openLinkInsert);
	const openExportDialog = useOutlineStore((state) => state.openExportDialog);
	const zoomTo = useZoomTo();
	const moveTo = useMoveTo();
	const zoomPane = useOutlineStore((state) => state.zoomPane);
	const navigateToToday = useNavigateToToday();
	// ⌃T in an open pane zooms that pane: the active pane is read when today's page resolves.
	const navigateActivePaneToToday = useNavigateToToday((id) => {
		const {activePaneId} = useOutlineStore.getState();
		zoomPane(activePaneId, id);
	});
	const createNodeMutation = useCreateNode();
	const moveNodeMutation = useMoveNode();
	const moveNodesMutation = useMoveNodes();
	const deleteNodeMutation = useDeleteNode();
	const toggleCompleteMutation = useToggleComplete();
	const updateNodeMutation = useUpdateNode();
	const dateSettings = useDateSettings();
	const copyLink = useCopyLink();
	const sortChildren = useSortChildren();

	// The zoomed node's parent and siblings, for zooming out and to its siblings
	const {data: zoomedNode} = useNode(zoomedNodeId);
	const {data: zoomedNodeSiblings} = useChildren(zoomedNode?.parent_id ?? null);

	// The edited node is the only item commands act on
	const {data: editedNode} = useNode(editingId);

	/** The loaded node of the command's item, or undefined with no item. */
	const itemNode = (ctx: CommandContext): NodeResponse | undefined =>
		readItemNode(queryClient, ctx.items[0], editedNode);

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

	/**
	 * Move the item selection as blocks (`planBlockMove`) in one undo step, keeping it selected and expanding each
	 * new parent.
	 */
	const moveSelection = (ctx: CommandContext, direction: BlockMoveDirection): void => {
		const state = useOutlineStore.getState();
		const moves = planBlockMove(ctx.items, direction, cacheMoveTree(queryClient, state), zoomedNodeId);
		for (const {parentId} of moves) {
			if (parentId !== null && parentId !== zoomedNodeId && !activePaneView().expandedIds.has(parentId)) {
				expand(parentId);
			}
		}
		if (moves.length > 0) {
			void runInUndoBatch(captureOutlineView, async () => sendBlockMoves(moves, moveNodesMutation.mutate));
		}
	};

	/** Swap with a sibling or cross into the parent's sibling, expanding it. */
	const moveEditedNodeVertically = (ctx: CommandContext, direction: "up" | "down"): void => {
		if (hasItemSelection()) {
			moveSelection(ctx, direction);
			return;
		}
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
		flashMoving([plan.nodeId]);
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

	/**
	 * Upstream's layout toggles (`planLayoutToggle`) over the command targets, in one undo step. While editing, the
	 * unsaved text is committed first and the editor stays open with the caret in place, showing any rewritten name.
	 */
	const toggleLayout = (ctx: CommandContext, command: LayoutToggleCommand): void => {
		const nodes = ctx.items.flatMap((id) => readNode(queryClient, id) ?? []);
		if (nodes.length === 0) {
			return;
		}
		const editor = editingId !== null && !hasItemSelection() ? editorElement(editingId) : null;
		const edited =
			editor !== null && editingId !== null
				? {nodeId: editingId, name: serializeEditorHtml(editor.innerHTML)}
				: undefined;
		const plan = planLayoutHotkey(command, nodes, edited);
		if (editor !== null && edited !== undefined) {
			flushEditing();
			let caret = caretTextOffset(editor);
			const renamed = plan.updates.find((update) => update.nodeId === edited.nodeId)?.name;
			if (renamed !== undefined) {
				caret = Math.max(0, caret - (plainLength(edited.name) - plainLength(renamed)));
				editor.innerHTML = renderEditorHtml(renamed, dateSettings);
				placeCaretAtTextOffset(editor, caret);
			}
			holdEditing(caret);
		}
		void runInUndoBatch(captureOutlineView, () => {
			for (const update of plan.updates) {
				updateNodeMutation.mutate(update, {onSettled: releaseEditing});
			}
			for (const nodeId of plan.deletes) {
				deleteNodeMutation.mutate(nodeId);
			}
		});
		if (plan.clearSelection) {
			useOutlineStore.getState().clearItemSelection();
		}
	};

	const layoutCommand = (command: LayoutToggleCommand): Command => ({
		execute(ctx) {
			toggleLayout(ctx, command);
		},
	});

	const itemTypeDeps: ItemTypeSelectDeps = {
		update: (nodeId, layoutMode) => {
			updateNodeMutation.mutate({nodeId, layoutMode});
		},
		expandAll: (ids) => {
			replaceExpanded(new Set([...activePaneView().expandedIds, ...ids]));
		},
		childIds: (nodeId) => (readChildren(queryClient, nodeId) ?? []).map((child) => child.id),
		layoutMode: (nodeId) => readNode(queryClient, nodeId)?.data.layoutMode ?? null,
	};

	/** Upstream `toggle_board` / `toggle_table` on the single item, in one undo step. */
	const boardOrTableCommand = (command: "toggle_board" | "toggle_table"): Command =>
		singleItemCommand((nodeId) => {
			void runInUndoBatch(captureOutlineView, () => {
				toggleBoardOrTable(command, nodeId, itemTypeDeps);
			});
		});

	/**
	 * Upstream `navigate_to_next_item` / `prev_item`: zoom to the zoomed page's potentially visible sibling `step`
	 * places away, scroll to the top, then edit its first visible child (or its title) at offset 0. In an open pane
	 * (`paneId`) it zooms the pane and scrolls the pane's scroller.
	 */
	const jumpToSibling = async (step: -1 | 1, paneId: string | null): Promise<void> => {
		if (zoomedNodeId === null || zoomedNode === undefined) {
			return;
		}
		const siblings = readChildren(queryClient, zoomedNode.parent_id) ?? zoomedNodeSiblings ?? [];
		const targetId = nextPotentiallyVisibleSibling(siblings, zoomedNodeId, step, showCompleted);
		if (targetId === null) {
			return;
		}
		commitEdit();
		if (paneId === null) {
			void navigate(nodeUrl(targetId));
			scrollPaneToTop(MAIN_PANE_ID);
		} else {
			zoomPane(paneId, targetId);
			scrollPaneToTop(paneId);
		}
		const children = await queryClient.query({
			queryKey: nodeKeys.children(targetId),
			queryFn: async () => fetchChildren(targetId),
			staleTime: "static",
		});
		resumeEditing(potentiallyVisibleIds(children)[0] ?? targetId, 0);
	};

	/** Upstream `focus_next_sibling` / `prev`: edit the edited row's potentially visible sibling at offset 0. */
	const focusSibling = (ctx: CommandContext, step: -1 | 1): void => {
		const currentId = ctx.items[0] ?? null;
		const currentNode =
			currentId === null || currentId === zoomedNodeId ? undefined : readNode(queryClient, currentId);
		const targetId = planFocusSibling(
			{
				zoomedId: zoomedNodeId,
				currentId,
				firstChildId: potentiallyVisibleIds(readChildren(queryClient, zoomedNodeId))[0] ?? null,
				siblings:
					currentNode === undefined
						? []
						: potentiallyVisibleIds(readChildren(queryClient, currentNode.parent_id)),
			},
			step,
		);
		if (targetId !== null) {
			commitEdit();
			resumeEditing(targetId, 0);
		}
	};

	/**
	 * Upstream `focus_first` / `focus_last`: caret at the start of the first navigable node or the end of the last.
	 * `skipTitle` skips the zoomed title, for upstream's `WF.Focus.firstChildOfSelected`.
	 */
	const focusEdge = (edge: "first" | "last", skipTitle = false): void => {
		const state = activePaneView();
		const visibleIds = collectVisibleNodeIds(
			queryClient,
			state.zoomedNodeId,
			state.expandedIds,
			state.showCompleted,
			state.animatingCompletionIds,
		);
		const targets = firstLastNavigable(
			visibleIds,
			state.zoomedNodeId === null || skipTitle
				? {titleEditable: false}
				: {titleEditable: true, zoomedId: state.zoomedNodeId},
		);
		if (targets === null) {
			return;
		}
		const targetId = targets[edge];
		const offset = edge === "first" ? 0 : Number.MAX_SAFE_INTEGER;
		const editor = targetId === state.editingId ? editorElement(targetId) : null;
		if (editor === null) {
			commitEdit();
			resumeEditing(targetId, offset);
		} else {
			placeCaretAtTextOffset(editor, offset);
		}
	};

	/**
	 * Upstream ⌘↓ / ⌘↑ / ⌃Space: act on the edited row, or on the zoom root when its title is edited or nothing is.
	 * The caret stays where it is.
	 */
	const expandKey = (ctx: CommandContext, key: ExpandKey): void => {
		const [itemId] = ctx.items;
		const isRoot = itemId === undefined || itemId === ctx.zoomedId;
		const node = itemNode(ctx);
		const {expandedIds, showCompleted: completedShown} = activePaneView();
		const rowId = itemId ?? "";
		const plan = planExpandKey({
			key,
			target: isRoot ? "root" : "row",
			id: rowId,
			isOpen: expandedIds.has(rowId),
			hasVisibleChildren: node === undefined || rowHasChildren(node, completedShown),
			now: performance.now(),
			detector: toggleDetector,
			rows: isRoot ? currentExpansionRows(queryClient) : [],
			expanded: expandedIds,
		});
		switch (plan.type) {
			case "none":
				return;
			case "expand":
				expand(plan.id);
				return;
			case "collapse":
				collapse(plan.id);
				return;
			case "toggle":
				toggleExpand(plan.id);
				return;
			case "all":
				expandAll(isRoot ? ctx.zoomedId : plan.id, plan.open);
				return;
			case "level": {
				const next = new Set(expandedIds);
				for (const id of plan.ids) {
					if (plan.open) {
						next.add(id);
					} else {
						next.delete(id);
					}
				}
				replaceExpanded(next);
			}
		}
	};

	/** Toggle complete on every selected item as one undo step, then clear the selection. */
	const completeSelection = (ids: readonly string[]): void => {
		const store = useOutlineStore.getState();
		store.clearItemSelection();
		const plan = planToggleComplete(
			ids.map((id) => readNode(queryClient, id)).filter((node) => node !== undefined),
		);
		if (plan.action === "none") {
			return;
		}
		const completing = plan.action === "complete";
		if (completing && !store.showCompleted) {
			scheduleCompletionHide(
				plan.ids,
				store,
				(id) => !useOutlineStore.getState().showCompleted && readNode(queryClient, id)?.completedAt !== null,
			);
		}
		void runInUndoBatch(captureOutlineView, () => {
			for (const nodeId of plan.ids) {
				toggleCompleteMutation.mutate({nodeId, isCurrentlyCompleted: !completing});
			}
		});
	};

	/** Toggle complete on the edited node and move the caret as upstream does, or on the whole selection. */
	const complete = (ctx: CommandContext): void => {
		if (hasItemSelection()) {
			completeSelection(ctx.items);
			return;
		}
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
		const [itemId] = ctx.items;
		const selection = globalThis.getSelection();
		if (selection && !selection.isCollapsed && itemId !== undefined) {
			const selectedText = selection.toString().trim();
			if (selectedText) {
				openLinkInsert({selectedText, nodeId: itemId, range: selection.getRangeAt(0).cloneRange()});
				return;
			}
		}
		if (isJumpMenuOpen()) {
			closeJumpMenu("cancel");
		} else {
			openJumpMenu();
		}
	};

	const undoRunner: UndoRunner = {
		flush: flushEditing,
		settled: settleUndoNow,
		pop: (direction) => (direction === "undo" ? undoHistory.popUndo() : undoHistory.popRedo()),
		blur() {
			// Committed at once, so the editor unmounts: a row edited both before and after the undo would otherwise keep
			// its held text, since stopping and resuming in one render never leaves editing.
			flushSync(() => {
				const editedId = useOutlineStore.getState().editingId;
				if (editedId !== null) {
					editorElement(editedId)?.blur();
				}
				stopEditing();
			});
		},
		hold(ops) {
			return holdUndoReplay(queryClient, ops);
		},
		preview(ops) {
			// A refetch still in flight from the forward action would land over the previewed rows.
			void queryClient.cancelQueries({queryKey: nodeKeys.all});
			previewUndoOps(queryClient, ops);
		},
		async apply(ops) {
			await applyOps(ops, undoAdapter);
		},
		async reconcile() {
			await queryClient.invalidateQueries();
		},
		current: captureOutlineView,
		editorFocused() {
			const active = document.activeElement;
			return (
				active instanceof HTMLElement &&
				(active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA")
			);
		},
		select(ids) {
			useOutlineStore.getState().restoreItemSelection(ids);
		},
		textLength(nodeId, field) {
			const node = readNode(queryClient, nodeId);
			return plainLength((field === "name" ? node?.name : node?.note) ?? "");
		},
		zoomTo(nodeId) {
			goToNode(navigate, nodeId);
		},
		focus({nodeId, field, start}) {
			// Queued behind the preview's cache notifications, so the editor mounts on the restored text.
			notifyManager.schedule(() => {
				if (field === "name") {
					resumeEditing(nodeId, start);
				} else {
					useOutlineStore.getState().focusNote(nodeId, start === 0 ? 0 : "end");
				}
			});
		},
	};

	/** Upstream ⌘Z / ⇧⌘Z: claimed even with an empty stack, so the browser's native undo never runs. */
	const undoCommand = (direction: UndoDirection) => ({
		execute() {
			queueUndo(direction, undoRunner).catch((error: unknown) => {
				useOutlineStore
					.getState()
					.addErrorNotification(
						`Couldn't ${direction}: ${error instanceof Error ? error.message : String(error)}`,
					);
			});
		},
	});

	return {
		undo: undoCommand("undo"),
		redo: undoCommand("redo"),
		save_and_sync: saveAndSyncCommand(() => {
			void queryClient.invalidateQueries();
		}),
		zoom_in: {
			execute(ctx) {
				const [nodeId] = ctx.items;
				if (nodeId !== undefined) {
					void zoomTo(nodeId, "first_child");
				}
			},
		},
		zoom_out: {
			execute() {
				void zoomTo(null, "last_selected");
			},
		},
		focus_prev_sibling: {
			execute(ctx) {
				focusSibling(ctx, -1);
			},
		},
		focus_next_sibling: {
			execute(ctx) {
				focusSibling(ctx, 1);
			},
		},
		focus_first: {
			execute() {
				focusEdge("first");
			},
		},
		focus_last: {
			execute() {
				focusEdge("last");
			},
		},
		expand: {
			execute(ctx) {
				expandKey(ctx, "expand");
			},
		},
		collapse: {
			execute(ctx) {
				expandKey(ctx, "collapse");
			},
		},
		expand_or_collapse: {
			execute(ctx) {
				expandKey(ctx, "toggle");
			},
		},
		indent: {
			execute(ctx) {
				if (hasItemSelection()) {
					moveSelection(ctx, "indent");
					return;
				}
				const node = itemNode(ctx);
				if (node !== undefined) {
					moveEditedNode(planIndent(queryClient, node, activePaneView().expandedIds));
				}
			},
		},
		outdent: {
			execute(ctx) {
				if (hasItemSelection()) {
					moveSelection(ctx, "outdent");
					return;
				}
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
		move_to: {
			available: (ctx) => ctx.items.length > 0 && ctx.items.every((id) => id !== ctx.zoomedId),
			execute(ctx) {
				void moveTo(ctx.items);
			},
		},
		complete: {execute: complete},
		duplicate: {
			execute(ctx) {
				if (hasItemSelection()) {
					void runInUndoBatch(captureOutlineView, () => {
						for (const id of ctx.items) {
							const selected = readNode(queryClient, id);
							if (selected !== undefined) {
								createNodeMutation.mutate(planDuplicate(queryClient, selected));
							}
						}
					});
					return;
				}
				const node = itemNode(ctx);
				if (node === undefined) {
					return;
				}
				// Copy the unsaved text too
				const editor = editorElement(node.id);
				const name = editor === null ? node.name : serializeEditorHtml(editor.innerHTML);
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
				if (hasItemSelection()) {
					deleteSelectedItems(queryClient, ctx.items, deleteNodeMutation.mutate, navigate);
					return;
				}
				const [nodeId] = ctx.items;
				if (nodeId !== undefined) {
					editBesideRemovedNode(nodeId);
					deleteNodeMutation.mutate(nodeId);
				}
			},
		},
		toggle_h1: layoutCommand("toggle_h1"),
		toggle_h2: layoutCommand("toggle_h2"),
		toggle_h3: layoutCommand("toggle_h3"),
		toggle_paragraph: layoutCommand("toggle_paragraph"),
		toggle_code_block: layoutCommand("toggle_code_block"),
		toggle_quote_block: layoutCommand("toggle_quote_block"),
		toggle_bullet: layoutCommand("toggle_bullet"),
		toggle_todo: layoutCommand("toggle_todo"),
		toggle_numbered: layoutCommand("toggle_numbered"),
		toggle_divider: layoutCommand("toggle_divider"),
		toggle_board: boardOrTableCommand("toggle_board"),
		toggle_table: boardOrTableCommand("toggle_table"),
		// Upstream: "Add note" from inside the note moves the caret to the end of the name.
		add_note: singleItemCommand((nodeId) => {
			const {editingNoteId, focusName, focusNote} = useOutlineStore.getState();
			if (editingNoteId === nodeId) {
				focusName(nodeId, "end");
			} else {
				focusNote(nodeId);
			}
		}),
		expand_all: singleItemCommand((nodeId) => {
			expandAll(nodeId, true);
		}),
		collapse_all: singleItemCommand((nodeId) => {
			expandAll(nodeId, false);
		}),
		sort_children_asc: singleItemCommand((nodeId) => {
			void sortChildren(nodeId, "asc");
		}),
		sort_children_desc: singleItemCommand((nodeId) => {
			void sortChildren(nodeId, "desc");
		}),
		copy_link: singleItemCommand((nodeId) => {
			void copyLink(nodeId);
		}),
		toggle_leftbar: {execute: toggleLeftBar},
		toggle_rightbar: {execute: toggleRightBar},
		...paneCommands({
			getState: useOutlineStore.getState,
			closeMainPane: () => {
				closeMainPane(navigate);
			},
			movePane: (paneId, index) => {
				movePane(navigate, paneId, index);
			},
		}),
		...paneNumberCommands({
			getState: useOutlineStore.getState,
			focusPane: (paneId, caret) => {
				captureActivePaneCaret();
				useOutlineStore.getState().setActivePane(paneId);
				if (caret === "first_child") {
					focusEdge("first", true);
					return;
				}
				const view = activePaneView();
				const saved = restorableCaret(view.paneCarets[paneId], {
					zoomedId: view.zoomedNodeId,
					visibleIds: collectVisibleNodeIds(
						queryClient,
						view.zoomedNodeId,
						view.expandedIds,
						view.showCompleted,
						view.animatingCompletionIds,
					),
				});
				if (saved === null) {
					focusEdge("first");
				} else {
					commitEdit();
					if (saved.field === "note") {
						view.focusNote(saved.nodeId, saved.offset);
					} else {
						view.resumeEditing(saved.nodeId, saved.offset);
					}
				}
			},
			zoomPaneTo: (paneId, nodeId) => {
				useOutlineStore.getState().setActivePane(paneId);
				void zoomTo(nodeId, "first_child");
			},
		}),
		...paneNavCommands({
			getState: useOutlineStore.getState,
			commitEdit,
			goHome: () => {
				void navigate("/");
			},
			stepMain: (direction) => {
				stepNav(navigate, direction, (id) => cachedResolvedId(queryClient, id));
			},
			navigateToToday: async (paneId) => (paneId === null ? navigateToToday() : navigateActivePaneToToday()),
			jumpToSibling,
		}),
		// The open search panel stands in for upstream's search-in-progress until search-filtering SF3
		show_or_hide_completed: showCompletedCommand(
			toggleShowCompleted,
			() => useOutlineStore.getState().searchQuery !== "",
		),
		star_current_item: {
			execute(ctx) {
				if (ctx.zoomedId !== null) {
					void toggleStar({nodeId: ctx.zoomedId, query: null});
				}
			},
		},
		show_switcher: {execute: showSwitcher},
		_select_next_in_switcher: switcherStepCommand("next", isJumpMenuOpen, openJumpMenu),
		_select_prev_in_switcher: switcherStepCommand("prev", isJumpMenuOpen, openJumpMenu),
		show_export: {
			execute(ctx) {
				if (ctx.items.length > 0) {
					commitEdit();
					openExportDialog({nodeIds: [...ctx.items]});
					useOutlineStore.getState().clearItemSelection();
				}
			},
		},
	};
}
