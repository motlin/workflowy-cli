import {useCallback} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {nodeRoute} from "../navigation.js";
import {nodeKeys} from "../node-cache.js";
import type {NodeResponse} from "../../node-types.js";
import {useHotkeys} from "react-hotkeys-hook";
import type {Options} from "react-hotkeys-hook";
import {useNavigate} from "react-router-dom";
import {useOutlineStore} from "../stores/outline.js";
import {sortByPriority} from "../tree-position.js";
import {caretTextOffset, editorElement} from "../caret-dom.js";
import {editingAfterRemoval} from "../caret-navigation.js";
import {planDuplicate, planIndent, planMoveDown, planMoveUp, planOutdent} from "../tree-ops.js";
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
import {useVisibleNodes} from "./use-visible-nodes.js";
import {readJson} from "../read-json.js";
import {navigationShortcut, punctuationHotkeys} from "../hotkey-bindings.js";

/**
 * Keyboard shortcuts for the outline view.
 * Matches Workflowy keyboard shortcuts from https://blog.workflowy.com/keyboard-shortcuts/
 *
 * Like workflowy.com there is no "selected but not editing" state: the node being
 * edited is the only focus, and every node shortcut acts on it while its text is
 * focused. With nothing being edited, node shortcuts do nothing. Moving between
 * nodes is caret movement (Up/Down at a node's edge, handled by EditableText).
 *
 * Navigation & Zoom:
 * - Cmd+Period (Cmd+.): Zoom in to the edited node
 * - Cmd+Comma (Cmd+,): Zoom out to parent node
 * - Cmd+Quote (Cmd+'): Navigate home to root view
 * - Cmd+LeftBracket (Cmd+[): Browser history back
 * - Cmd+RightBracket (Cmd+]): Browser history forward
 * - Cmd+Down / Cmd+Up: Expand / collapse the edited node
 *
 * Navigation shortcuts fire while editing and commit the edited text before leaving.
 *
 * Editing (Enter, Backspace, Escape and Up/Down are handled by EditableText):
 * - Shift+Enter: Edit the note of the edited node
 * - Tab: Indent the edited node (make it a child of its previous sibling)
 * - Shift+Tab: Outdent the edited node (make it a sibling of its parent)
 * - Cmd+Enter: Toggle complete/uncomplete on the edited node
 *
 * Structural shortcuts keep the caret and unsaved text in place: they hold editing
 * across the re-render so the edited row keeps (or regains) focus.
 *
 * Movement:
 * - Shift+Cmd+Up: Move the edited node up among siblings
 * - Shift+Cmd+Down: Move the edited node down among siblings
 *
 * Duplication:
 * - Shift+Cmd+D: Duplicate the edited node (shallow copy, placed below) and edit the copy
 *
 * Deletion:
 * - Shift+Cmd+Backspace: Delete the edited node and all descendants
 *
 * Sibling Navigation:
 * - Shift+Cmd+9: Edit the previous sibling (skips over children)
 * - Shift+Cmd+0: Edit the next sibling (skips over children)
 *
 * Focus Sibling (Zoomed Navigation):
 * - Option+Cmd+Up (⌥⌘↑): Zoom to previous sibling of current zoomed node
 * - Option+Cmd+Down (⌥⌘↓): Zoom to next sibling of current zoomed node
 *
 * Layout Modes (of the edited node):
 * - Option+Cmd+8 (⌥⌘8): bullets (default mode)
 * - Option+Cmd+9 (⌥⌘9): todo (shows checkboxes)
 * - Option+Cmd+1 (⌥⌘1): heading 1 (largest heading)
 * - Option+Cmd+2 (⌥⌘2): heading 2 (medium heading)
 * - Option+Cmd+3 (⌥⌘3): heading 3 (smallest heading)
 * - Option+Cmd+4 (⌥⌘4): paragraph (no bullets, prose text)
 *
 * Jump Menu:
 * - Cmd+K (⌘K): Open jump menu (command palette style navigation)
 *
 * UI Toggles:
 * - Ctrl+L (^L): Toggle left sidebar open/closed
 * - Cmd+? (⌘?): Toggle right sidebar (keyboard shortcuts help)
 * - Cmd+O (⌘O): Toggle show/hide completed nodes
 *
 * Starring:
 * - Shift+Cmd+8 (⇧⌘8): Star/unstar current zoomed page (adds to sidebar)
 *
 * Export:
 * - Shift+Cmd+E (⇧⌘E): Export the edited node to plain text, markdown, or OPML
 */
export function useKeyboardShortcuts() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const zoomedNodeId = useOutlineStore((state) => state.zoomedNodeId);
	const editingId = useOutlineStore((state) => state.editingId);
	const editingNoteId = useOutlineStore((state) => state.editingNoteId);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const resumeEditing = useOutlineStore((state) => state.resumeEditing);
	const stopEditing = useOutlineStore((state) => state.stopEditing);
	const holdEditing = useOutlineStore((state) => state.holdEditing);
	const releaseEditing = useOutlineStore((state) => state.releaseEditing);
	const startEditingNote = useOutlineStore((state) => state.startEditingNote);
	const toggleLeftSidebar = useOutlineStore((state) => state.toggleLeftSidebar);
	const toggleRightSidebar = useOutlineStore((state) => state.toggleRightSidebar);
	const toggleCompleted = useOutlineStore((state) => state.toggleCompleted);
	const toggleStarPage = useOutlineStore((state) => state.toggleStarPage);
	const searchPanelOpen = useOutlineStore((state) => state.searchPanelOpen);
	const toggleJumpMenu = useOutlineStore((state) => state.toggleJumpMenu);
	const expand = useOutlineStore((state) => state.expand);
	const collapse = useOutlineStore((state) => state.collapse);
	const openLinkInsert = useOutlineStore((state) => state.openLinkInsert);
	const openExportDialog = useOutlineStore((state) => state.openExportDialog);
	const visibleNodes = useVisibleNodes();
	const createNodeMutation = useCreateNode();
	const moveNodeMutation = useMoveNode();
	const deleteNodeMutation = useDeleteNode();
	const toggleCompleteMutation = useToggleComplete();
	const updateNodeMutation = useUpdateNode();

	// Fetch the current zoomed node to get its parent_id
	const {data: zoomedNode} = useNode(zoomedNodeId);

	// The edited node is the target of every node shortcut
	const {data: editedNode} = useNode(editingId);

	// Fetch siblings of the zoomed node for focus sibling navigation
	const {data: zoomedNodeSiblings} = useChildren(zoomedNode?.parent_id ?? null);

	/** Node shortcuts fire from inside the edited text and only while a node is being edited. */
	const editingShortcut: Options = {
		preventDefault: true,
		enableOnFormTags: false,
		enableOnContentEditable: true,
		enabled: editingId !== null,
	};

	/** Commit the edited text and stop editing, exactly as clicking away would. */
	const commitEdit = useCallback(() => {
		if (editingId !== null) {
			editorElement(editingId)?.blur();
		}
	}, [editingId]);

	/** Move the edited node, keeping its caret and unsaved text through the re-render. */
	const moveEditedNode = useCallback(
		(payload: MoveNodePayload | null) => {
			if (payload === null) {
				return;
			}
			const editor = editorElement(payload.nodeId);
			holdEditing(editor ? caretTextOffset(editor) : Number.MAX_SAFE_INTEGER);
			moveNodeMutation.mutate(payload, {onSettled: releaseEditing});
		},
		[holdEditing, releaseEditing, moveNodeMutation],
	);

	/** Continue editing beside the edited node, which is about to leave the view. */
	const editBesideRemovedNode = useCallback(
		(nodeId: string) => {
			const next = editingAfterRemoval(visibleNodes, nodeId);
			if (next === null) {
				stopEditing();
			} else {
				resumeEditing(next.nodeId, next.caretOffset);
			}
		},
		[visibleNodes, stopEditing, resumeEditing],
	);

	/** Commit the edited text, then edit `nodeId` with the caret at its end. */
	const editInstead = useCallback(
		(nodeId: string) => {
			commitEdit();
			resumeEditing(nodeId, Number.MAX_SAFE_INTEGER);
		},
		[commitEdit, resumeEditing],
	);

	const setLayoutMode = useCallback(
		(layoutMode: "bullets" | "todo" | "h1" | "h2" | "h3" | "paragraph") => {
			if (editingId !== null) {
				updateNodeMutation.mutate({nodeId: editingId, layoutMode});
			}
		},
		[editingId, updateNodeMutation],
	);

	// Cmd+. (Cmd+Period): Zoom in to the edited node
	useHotkeys(
		punctuationHotkeys.zoomIn,
		() => {
			if (editingId === null) {
				return;
			}
			const nodeId = editingId;
			commitEdit();
			void navigate(nodeRoute(nodeId));
		},
		editingShortcut,
		[editingId, commitEdit, navigate],
	);

	// Cmd+, (Cmd+Comma): Zoom out to parent node
	useHotkeys(
		punctuationHotkeys.zoomOut,
		() => {
			if (!zoomedNodeId) {
				// Already at root level, nothing to do
				return;
			}

			commitEdit();
			const parentId = zoomedNode?.parent_id;
			if (parentId) {
				void navigate(nodeRoute(parentId));
			} else {
				// No parent means we're at a root node, go to root view
				void navigate("/");
			}
		},
		navigationShortcut,
		[zoomedNodeId, zoomedNode, commitEdit, navigate],
	);

	// Cmd+[ (Cmd+LeftBracket): Browser history back
	useHotkeys(
		punctuationHotkeys.historyBack,
		() => {
			commitEdit();
			globalThis.history.back();
		},
		navigationShortcut,
		[commitEdit],
	);

	// Cmd+] (Cmd+RightBracket): Browser history forward
	useHotkeys(
		punctuationHotkeys.historyForward,
		() => {
			commitEdit();
			globalThis.history.forward();
		},
		navigationShortcut,
		[commitEdit],
	);

	// Cmd+' (Cmd+Quote): Navigate home to root view
	useHotkeys(
		punctuationHotkeys.home,
		() => {
			commitEdit();
			void navigate("/");
		},
		navigationShortcut,
		[commitEdit, navigate],
	);

	// Cmd+Down (⌘↓): Expand the edited node
	useHotkeys(
		"meta+down",
		() => {
			if (editingId !== null) {
				expand(editingId);
			}
		},
		editingShortcut,
		[editingId, expand],
	);

	// Cmd+Up (⌘↑): Collapse the edited node
	useHotkeys(
		"meta+up",
		() => {
			if (editingId !== null) {
				collapse(editingId);
			}
		},
		editingShortcut,
		[editingId, collapse],
	);

	// Shift+Enter: Edit the note of the edited node
	useHotkeys(
		"shift+enter",
		() => {
			if (editingId !== null && editingNoteId === null) {
				startEditingNote(editingId);
			}
		},
		editingShortcut,
		[editingId, editingNoteId, startEditingNote],
	);

	// Tab: Indent the edited node (make it a child of its previous sibling)
	useHotkeys(
		"tab",
		() => {
			if (editedNode !== undefined) {
				moveEditedNode(planIndent(queryClient, editedNode));
			}
		},
		editingShortcut,
		[editedNode, queryClient, moveEditedNode],
	);

	// Shift+Tab: Outdent the edited node (make it a sibling of its parent)
	useHotkeys(
		"shift+tab",
		() => {
			if (editedNode !== undefined) {
				moveEditedNode(planOutdent(queryClient, editedNode));
			}
		},
		editingShortcut,
		[editedNode, queryClient, moveEditedNode],
	);

	// Cmd+Enter: Toggle complete/uncomplete on the edited node
	useHotkeys(
		"meta+enter",
		() => {
			if (editedNode === undefined) {
				return;
			}

			const isCurrentlyCompleted = editedNode.completedAt !== null;
			if (!isCurrentlyCompleted && !showCompleted) {
				// The node is about to be hidden; keep the text and continue editing beside it
				commitEdit();
				editBesideRemovedNode(editedNode.id);
			}
			toggleCompleteMutation.mutate({nodeId: editedNode.id, isCurrentlyCompleted});
		},
		editingShortcut,
		[editedNode, showCompleted, commitEdit, editBesideRemovedNode, toggleCompleteMutation],
	);

	// Shift+Cmd+Up: Move the edited node up among siblings
	useHotkeys(
		"shift+meta+up",
		() => {
			if (editedNode !== undefined) {
				moveEditedNode(planMoveUp(queryClient, editedNode));
			}
		},
		editingShortcut,
		[editedNode, queryClient, moveEditedNode],
	);

	// Shift+Cmd+Down: Move the edited node down among siblings
	useHotkeys(
		"shift+meta+down",
		() => {
			if (editedNode !== undefined) {
				moveEditedNode(planMoveDown(queryClient, editedNode));
			}
		},
		editingShortcut,
		[editedNode, queryClient, moveEditedNode],
	);

	// Shift+Cmd+D: Duplicate the edited node (shallow copy, including unsaved text) and edit the copy
	useHotkeys(
		"shift+meta+d",
		() => {
			if (editedNode === undefined) {
				return;
			}

			const name = editorElement(editedNode.id)?.innerHTML ?? editedNode.name;
			commitEdit();
			createNodeMutation.mutate(planDuplicate(queryClient, {...editedNode, name}), {
				onSuccess(createdNode) {
					resumeEditing(createdNode.id, Number.MAX_SAFE_INTEGER);
				},
			});
		},
		editingShortcut,
		[editedNode, queryClient, commitEdit, createNodeMutation, resumeEditing],
	);

	/** The edited node's sibling `step` places away in priority order, or null past either end. */
	const siblingOfEdited = useCallback(
		(step: -1 | 1): string | null => {
			if (editedNode === undefined) {
				return null;
			}
			const siblings = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(editedNode.parent_id));
			if (!siblings) {
				return null;
			}
			const sorted = sortByPriority(siblings);
			const index = sorted.findIndex((sibling) => sibling.id === editedNode.id);
			return index === -1 ? null : (sorted[index + step]?.id ?? null);
		},
		[editedNode, queryClient],
	);

	// Shift+Cmd+9: Edit the previous sibling
	useHotkeys(
		"shift+meta+9",
		() => {
			const siblingId = siblingOfEdited(-1);
			if (siblingId !== null) {
				editInstead(siblingId);
			}
		},
		editingShortcut,
		[siblingOfEdited, editInstead],
	);

	// Shift+Cmd+0: Edit the next sibling
	useHotkeys(
		"shift+meta+0",
		() => {
			const siblingId = siblingOfEdited(1);
			if (siblingId !== null) {
				editInstead(siblingId);
			}
		},
		editingShortcut,
		[siblingOfEdited, editInstead],
	);

	// Option+Cmd+Up: Focus previous sibling (zoom to previous sibling of current zoomed node)
	useHotkeys(
		"alt+meta+up",
		() => {
			// Only works when zoomed into a node
			if (zoomedNodeId === null || zoomedNode === undefined) {
				return;
			}

			// Need siblings to navigate
			if (!zoomedNodeSiblings || zoomedNodeSiblings.length < 2) {
				return;
			}

			// Sort siblings by priority to find the previous one
			const sortedSiblings = sortByPriority(zoomedNodeSiblings);
			const currentIndex = sortedSiblings.findIndex((sibling) => sibling.id === zoomedNodeId);

			// Can't focus previous if already at the first sibling
			const previousSibling = sortedSiblings[currentIndex - 1];
			if (currentIndex <= 0 || previousSibling === undefined) {
				return;
			}

			void navigate(nodeRoute(previousSibling.id));
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[zoomedNodeId, zoomedNode, zoomedNodeSiblings, navigate],
	);

	// Option+Cmd+Down: Focus next sibling (zoom to next sibling of current zoomed node)
	useHotkeys(
		"alt+meta+down",
		() => {
			// Only works when zoomed into a node
			if (zoomedNodeId === null || zoomedNode === undefined) {
				return;
			}

			// Need siblings to navigate
			if (!zoomedNodeSiblings || zoomedNodeSiblings.length < 2) {
				return;
			}

			// Sort siblings by priority to find the next one
			const sortedSiblings = sortByPriority(zoomedNodeSiblings);
			const currentIndex = sortedSiblings.findIndex((sibling) => sibling.id === zoomedNodeId);

			// Can't focus next if already at the last sibling
			const nextSibling = sortedSiblings[currentIndex + 1];
			if (currentIndex === -1 || nextSibling === undefined) {
				return;
			}

			void navigate(nodeRoute(nextSibling.id));
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[zoomedNodeId, zoomedNode, zoomedNodeSiblings, navigate],
	);

	// Shift+Cmd+Backspace: Delete the edited node and all descendants
	useHotkeys(
		"shift+meta+backspace",
		() => {
			if (editingId === null) {
				return;
			}
			const nodeId = editingId;
			editBesideRemovedNode(nodeId);
			deleteNodeMutation.mutate(nodeId);
		},
		editingShortcut,
		[editingId, editBesideRemovedNode, deleteNodeMutation],
	);

	// Option+Cmd+8/9/1/2/3/4: Set the edited node's layout mode
	useHotkeys(
		"alt+meta+8",
		() => {
			setLayoutMode("bullets");
		},
		editingShortcut,
		[setLayoutMode],
	);
	useHotkeys(
		"alt+meta+9",
		() => {
			setLayoutMode("todo");
		},
		editingShortcut,
		[setLayoutMode],
	);
	useHotkeys(
		"alt+meta+1",
		() => {
			setLayoutMode("h1");
		},
		editingShortcut,
		[setLayoutMode],
	);
	useHotkeys(
		"alt+meta+2",
		() => {
			setLayoutMode("h2");
		},
		editingShortcut,
		[setLayoutMode],
	);
	useHotkeys(
		"alt+meta+3",
		() => {
			setLayoutMode("h3");
		},
		editingShortcut,
		[setLayoutMode],
	);
	useHotkeys(
		"alt+meta+4",
		() => {
			setLayoutMode("paragraph");
		},
		editingShortcut,
		[setLayoutMode],
	);

	// Ctrl+L: Toggle left sidebar
	useHotkeys(
		"ctrl+l",
		() => {
			toggleLeftSidebar();
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
		},
		[toggleLeftSidebar],
	);

	// Cmd+? (Cmd+Shift+/): Toggle right sidebar (keyboard shortcuts help)
	useHotkeys(
		punctuationHotkeys.toggleHelp,
		() => {
			toggleRightSidebar();
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[toggleRightSidebar],
	);

	// Cmd+O: Toggle show/hide completed nodes
	useHotkeys(
		"meta+o",
		() => {
			toggleCompleted();
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
		},
		[toggleCompleted],
	);

	// Shift+Cmd+8: Star/unstar current zoomed page
	useHotkeys(
		"shift+meta+8",
		() => {
			// Only works when zoomed into a node
			if (zoomedNodeId === null) {
				return;
			}

			toggleStarPage(zoomedNodeId);
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
		},
		[zoomedNodeId, toggleStarPage],
	);

	// Cmd+K: Open jump menu OR link insert modal
	// - If text is selected in an editable field: open link insert modal
	// - Otherwise: open jump menu (command palette style navigation)
	// Note: When jump menu is open, it handles its own Escape key to close
	useHotkeys(
		"meta+k",
		() => {
			// Don't open if search panel is open
			if (searchPanelOpen) {
				return;
			}

			// Check if we have text selected in an editable field
			const selection = globalThis.getSelection();
			if (selection && !selection.isCollapsed && editingId) {
				const selectedText = selection.toString().trim();
				if (selectedText) {
					// Get the range to use for inserting the link later
					const range = selection.getRangeAt(0).cloneRange();

					openLinkInsert({
						selectedText,
						nodeId: editingId,
						range,
					});
					return;
				}
			}

			toggleJumpMenu();
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
		},
		[searchPanelOpen, editingId, toggleJumpMenu, openLinkInsert],
	);

	// Ctrl+T (^T): Zoom to Today
	// Searches for a node containing today's date and navigates to it
	const zoomToToday = async () => {
		// Don't zoom if editing
		if (editingId !== null || editingNoteId !== null) {
			return;
		}

		// Format today's date in common formats to search
		const today = new Date();
		const monthNames = [
			"January",
			"February",
			"March",
			"April",
			"May",
			"June",
			"July",
			"August",
			"September",
			"October",
			"November",
			"December",
		];
		const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
		const day = today.getDate();
		const month = monthNames[today.getMonth()];
		const year = today.getFullYear();
		const dayOfWeek = dayNames[today.getDay()];

		// Try common date formats
		const dateFormats = [
			`${month} ${day}, ${year}`,
			`${dayOfWeek}, ${month} ${day}`,
			`${month} ${day}`,
			`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
		];

		// Search for nodes containing today's date
		for (const dateFormat of dateFormats) {
			const response = await fetch("/api/search", {
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({query: dateFormat, limit: 1}),
			});

			if (response.ok) {
				const data = await readJson<{results: {id: string; name: string | null}[]}>(response);
				const [first] = data.results;
				if (first !== undefined) {
					void navigate(nodeRoute(first.id));
					return;
				}
			}
		}

		// If no node found, could show a notification (for now just do nothing)
	};
	useHotkeys(
		"ctrl+t",
		() => {
			void zoomToToday();
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[editingId, editingNoteId, navigate],
	);

	// Shift+Cmd+E (⇧⌘E): Export the edited node
	// Opens export dialog with options for plain text, markdown, or OPML
	useHotkeys(
		"shift+meta+e",
		() => {
			if (editingId === null) {
				return;
			}
			const nodeId = editingId;
			commitEdit();
			openExportDialog({nodeIds: [nodeId]});
		},
		editingShortcut,
		[editingId, commitEdit, openExportDialog],
	);
}
