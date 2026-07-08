import {useQueryClient} from '@tanstack/react-query';
import {useHotkeys} from 'react-hotkeys-hook';
import {useNavigate} from 'react-router-dom';
import {useOutlineStore} from '../stores/outline.js';
import {
	useChildren,
	useCreateNode,
	useDeleteNode,
	useMoveNode,
	useNode,
	useToggleComplete,
	useUpdateNode,
} from './use-nodes.js';
import {useVisibleNodes} from './use-visible-nodes.js';

interface NodeResponse {
	id: string;
	parent_id: string | null;
	name: string | null;
	note: string | null;
	priority: number;
	data: {layoutMode: string | null};
	createdAt: number | null;
	modifiedAt: number | null;
	completedAt: number | null;
}

/**
 * Keyboard shortcuts for the outline view.
 * Matches Workflowy keyboard shortcuts from https://blog.workflowy.com/keyboard-shortcuts/
 *
 * Navigation & Zoom:
 * - Cmd+Period (Cmd+.): Zoom in to selected node
 * - Cmd+Comma (Cmd+,): Zoom out to parent node
 * - Cmd+Quote (Cmd+'): Navigate home to root view
 * - Cmd+LeftBracket (Cmd+[): Browser history back
 * - Cmd+RightBracket (Cmd+]): Browser history forward
 *
 * Arrow Key Navigation:
 * - ArrowUp: Select previous visible node
 * - ArrowDown: Select next visible node
 *
 * Editing:
 * - Enter: Create new sibling node below (when not editing)
 * - Shift+Enter: Focus/create note field for selected node
 * - Tab: Indent node (make it a child of previous sibling)
 * - Shift+Tab: Outdent node (make it a sibling of its parent)
 * - Backspace: Delete empty node (when not editing, node is empty and has no children)
 * - Cmd+Enter: Toggle complete/uncomplete on selected node
 *
 * Movement:
 * - Shift+Cmd+Up: Move node up among siblings (swap with previous sibling)
 * - Shift+Cmd+Down: Move node down among siblings (swap with next sibling)
 *
 * Duplication:
 * - Shift+Cmd+D: Duplicate selected node (shallow copy, placed below current)
 *
 * Deletion:
 * - Shift+Cmd+Backspace: Force delete node and all descendants (works on any node)
 *
 * Sibling Navigation:
 * - Shift+Cmd+9: Jump to previous sibling (skips over children)
 * - Shift+Cmd+0: Jump to next sibling (skips over children)
 *
 * Focus Sibling (Zoomed Navigation):
 * - Option+Cmd+Up (⌥⌘↑): Zoom to previous sibling of current zoomed node
 * - Option+Cmd+Down (⌥⌘↓): Zoom to next sibling of current zoomed node
 *
 * Layout Modes:
 * - Option+Cmd+8 (⌥⌘8): Set layout mode to bullets (default mode)
 * - Option+Cmd+9 (⌥⌘9): Set layout mode to todo (shows checkboxes)
 * - Option+Cmd+1 (⌥⌘1): Set layout mode to heading 1 (largest heading)
 * - Option+Cmd+2 (⌥⌘2): Set layout mode to heading 2 (medium heading)
 * - Option+Cmd+3 (⌥⌘3): Set layout mode to heading 3 (smallest heading)
 * - Option+Cmd+4 (⌥⌘4): Set layout mode to paragraph (no bullets, prose text)
 *
 * Search:
 * - Escape (Esc): Open search panel (when not editing)
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
 * - Shift+Cmd+E (⇧⌘E): Export selected node(s) to plain text, markdown, or OPML
 */
export function useKeyboardShortcuts() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const selectedId = useOutlineStore((state) => state.selectedId);
	const zoomedNodeId = useOutlineStore((state) => state.zoomedNodeId);
	const editingId = useOutlineStore((state) => state.editingId);
	const editingNoteId = useOutlineStore((state) => state.editingNoteId);
	const select = useOutlineStore((state) => state.select);
	const startEditing = useOutlineStore((state) => state.startEditing);
	const startEditingNote = useOutlineStore((state) => state.startEditingNote);
	const toggleLeftSidebar = useOutlineStore((state) => state.toggleLeftSidebar);
	const toggleRightSidebar = useOutlineStore((state) => state.toggleRightSidebar);
	const toggleCompleted = useOutlineStore((state) => state.toggleCompleted);
	const toggleStarPage = useOutlineStore((state) => state.toggleStarPage);
	const searchPanelOpen = useOutlineStore((state) => state.searchPanelOpen);
	const toggleSearchPanel = useOutlineStore((state) => state.toggleSearchPanel);
	const jumpMenuOpen = useOutlineStore((state) => state.jumpMenuOpen);
	const toggleJumpMenu = useOutlineStore((state) => state.toggleJumpMenu);
	const visibleNodes = useVisibleNodes();
	const createNodeMutation = useCreateNode();
	const moveNodeMutation = useMoveNode();
	const deleteNodeMutation = useDeleteNode();
	const toggleCompleteMutation = useToggleComplete();
	const updateNodeMutation = useUpdateNode();

	// Fetch the current zoomed node to get its parent_id
	const {data: zoomedNode} = useNode(zoomedNodeId);

	// Fetch the selected node to get its parent_id for creating siblings
	const {data: selectedNode} = useNode(selectedId);

	// Fetch children of the selected node to check if it can be deleted
	const {data: selectedNodeChildren} = useChildren(selectedId);

	// Fetch siblings of the zoomed node for focus sibling navigation
	const {data: zoomedNodeSiblings} = useChildren(zoomedNode?.parent_id ?? null);

	// Cmd+. (Cmd+Period): Zoom in to selected node
	useHotkeys(
		'meta+.',
		() => {
			if (selectedId) {
				void navigate(`/node/${selectedId}`);
			}
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId],
	);

	// Cmd+, (Cmd+Comma): Zoom out to parent node
	useHotkeys(
		'meta+,',
		() => {
			if (!zoomedNodeId) {
				// Already at root level, nothing to do
				return;
			}

			const parentId = zoomedNode?.parent_id;
			if (parentId) {
				void navigate(`/node/${parentId}`);
			} else {
				// No parent means we're at a root node, go to root view
				void navigate('/');
			}
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[zoomedNodeId, zoomedNode],
	);

	// Cmd+[ (Cmd+LeftBracket): Browser history back
	useHotkeys(
		'meta+[',
		() => {
			globalThis.history.back();
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
	);

	// Cmd+] (Cmd+RightBracket): Browser history forward
	useHotkeys(
		'meta+]',
		() => {
			globalThis.history.forward();
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
	);

	// Cmd+' (Cmd+Quote): Navigate home to root view
	useHotkeys(
		"meta+'",
		() => {
			void navigate('/');
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
	);

	// Get expand/collapse actions from store
	const expand = useOutlineStore((state) => state.expand);
	const collapse = useOutlineStore((state) => state.collapse);

	// Cmd+Down (⌘↓): Expand selected node
	useHotkeys(
		'meta+down',
		() => {
			// Don't expand if editing (let text editing handle the event)
			if (editingId !== null || editingNoteId !== null) {
				return;
			}

			// Need a selected node to expand
			if (selectedId === null) {
				return;
			}

			// If already expanded, expand all descendants (recursive)
			// For now, just expand the selected node
			expand(selectedId);
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, editingId, editingNoteId, expand],
	);

	// Cmd+Up (⌘↑): Collapse selected node
	useHotkeys(
		'meta+up',
		() => {
			// Don't collapse if editing (let text editing handle the event)
			if (editingId !== null || editingNoteId !== null) {
				return;
			}

			// Need a selected node to collapse
			if (selectedId === null) {
				return;
			}

			// If already collapsed, collapse all descendants (recursive)
			// For now, just collapse the selected node
			collapse(selectedId);
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, editingId, editingNoteId, collapse],
	);

	// ArrowUp: Select previous visible node
	useHotkeys(
		'up',
		() => {
			if (visibleNodes.length === 0) {
				return;
			}

			if (selectedId === null) {
				// No selection, select the last visible node
				select(visibleNodes.at(-1) ?? null);
				return;
			}

			const currentIndex = visibleNodes.indexOf(selectedId);
			if (currentIndex === -1) {
				// Current selection is not visible, select last visible node
				select(visibleNodes.at(-1) ?? null);
				return;
			}

			if (currentIndex > 0) {
				select(visibleNodes[currentIndex - 1]);
			}
			// At first node, do nothing (don't wrap)
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, visibleNodes, select],
	);

	// ArrowDown: Select next visible node
	useHotkeys(
		'down',
		() => {
			if (visibleNodes.length === 0) {
				return;
			}

			if (selectedId === null) {
				// No selection, select the first visible node
				select(visibleNodes[0]);
				return;
			}

			const currentIndex = visibleNodes.indexOf(selectedId);
			if (currentIndex === -1) {
				// Current selection is not visible, select first visible node
				select(visibleNodes[0]);
				return;
			}

			if (currentIndex < visibleNodes.length - 1) {
				select(visibleNodes[currentIndex + 1]);
			}
			// At last node, do nothing (don't wrap)
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, visibleNodes, select],
	);

	// Enter: Create new sibling node below (when not editing)
	useHotkeys(
		'enter',
		() => {
			// Don't create sibling if already editing (Enter should submit the edit)
			if (editingId !== null) {
				return;
			}

			// Need a selected node to create a sibling
			if (selectedId === null || selectedNode === undefined) {
				return;
			}

			// Get the parent_id (same as selected node's parent)
			const parentId = selectedNode.parent_id;

			// Get siblings to calculate position after the selected node
			const queryKey = ['nodes', 'children', parentId];
			const siblings = queryClient.getQueryData<NodeResponse[]>(queryKey);
			const selectedNodePriority = selectedNode.priority;

			// Position after the selected node
			// Find the next sibling's priority to position between them
			let position: number;
			if (siblings) {
				const sortedSiblings = [...siblings].sort((a, b) => a.priority - b.priority);
				const selectedIndex = sortedSiblings.findIndex((sibling) => sibling.id === selectedId);
				if (selectedIndex === -1 || selectedIndex === sortedSiblings.length - 1) {
					// Selected is last or not found, position after
					position = selectedNodePriority + 100;
				} else {
					// Position between selected and next sibling
					const nextPriority = sortedSiblings[selectedIndex + 1].priority;
					position = Math.floor((selectedNodePriority + nextPriority) / 2);
				}
			} else {
				position = selectedNodePriority + 100;
			}

			// Create the new node
			createNodeMutation.mutate(
				{
					parent_id: parentId ?? undefined,
					name: '',
					position,
				},
				{
					onSuccess(createdNode) {
						// Select and start editing the new node
						select(createdNode.id);
						startEditing(createdNode.id);
					},
				},
			);
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, selectedNode, editingId, queryClient, createNodeMutation, select, startEditing],
	);

	// Shift+Enter: Focus/create note field for selected node
	useHotkeys(
		'shift+enter',
		() => {
			// Don't trigger if already editing a note
			if (editingNoteId !== null) {
				return;
			}

			// Need a selected node to add a note
			if (selectedId === null) {
				return;
			}

			startEditingNote(selectedId);
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, editingNoteId, startEditingNote],
	);

	// Tab: Indent node (make it a child of its previous sibling)
	useHotkeys(
		'tab',
		() => {
			// Don't indent if editing (Tab should work normally in text fields)
			if (editingId !== null) {
				return;
			}

			// Need a selected node to indent
			if (selectedId === null || selectedNode === undefined) {
				return;
			}

			// Get siblings of the selected node
			const parentId = selectedNode.parent_id;
			const queryKey = ['nodes', 'children', parentId];
			const siblings = queryClient.getQueryData<NodeResponse[]>(queryKey);

			if (!siblings) {
				return;
			}

			// Sort siblings by priority to find the previous one
			const sortedSiblings = [...siblings].sort((a, b) => a.priority - b.priority);
			const selectedIndex = sortedSiblings.findIndex((sibling) => sibling.id === selectedId);

			// Can't indent if there's no previous sibling
			if (selectedIndex <= 0) {
				return;
			}

			const previousSibling = sortedSiblings[selectedIndex - 1];

			// Move the selected node to be a child of the previous sibling
			moveNodeMutation.mutate({
				nodeId: selectedId,
				parent_id: previousSibling.id,
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, selectedNode, editingId, queryClient, moveNodeMutation],
	);

	// Shift+Tab: Outdent node (make it a sibling of its parent)
	useHotkeys(
		'shift+tab',
		() => {
			// Don't outdent if editing (Shift+Tab should work normally in text fields)
			if (editingId !== null) {
				return;
			}

			// Need a selected node to outdent
			if (selectedId === null || selectedNode === undefined) {
				return;
			}

			// Can't outdent if node is at root level (no parent)
			const parentId = selectedNode.parent_id;
			if (parentId === null) {
				return;
			}

			// Get the parent node to find the grandparent
			const parentQueryKey = ['nodes', 'detail', parentId];
			const parentNode = queryClient.getQueryData<NodeResponse>(parentQueryKey);

			// Need parent node data to get grandparent_id
			if (parentNode === undefined) {
				return;
			}

			// Move the selected node to be a sibling of its parent (child of grandparent)
			// grandparentId can be null if parent is at root level
			const grandparentId = parentNode.parent_id;

			// Get parent's siblings to calculate position after the parent
			const grandparentChildrenKey = ['nodes', 'children', grandparentId];
			const parentSiblings = queryClient.getQueryData<NodeResponse[]>(grandparentChildrenKey);
			const parentPriority = parentNode.priority;

			// Position after the parent node
			let position: number;
			if (parentSiblings) {
				const sortedSiblings = [...parentSiblings].sort((a, b) => a.priority - b.priority);
				const parentIndex = sortedSiblings.findIndex((sibling) => sibling.id === parentId);
				if (parentIndex === -1 || parentIndex === sortedSiblings.length - 1) {
					// Parent is last or not found, position after
					position = parentPriority + 100;
				} else {
					// Position between parent and next sibling
					const nextPriority = sortedSiblings[parentIndex + 1].priority;
					position = Math.floor((parentPriority + nextPriority) / 2);
				}
			} else {
				position = parentPriority + 100;
			}

			moveNodeMutation.mutate({
				nodeId: selectedId,
				parent_id: grandparentId,
				position,
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, selectedNode, editingId, queryClient, moveNodeMutation],
	);

	// Backspace: Delete empty node (when not editing, node is empty and has no children)
	useHotkeys(
		'backspace',
		() => {
			// Don't delete if editing (Backspace should work normally in text fields)
			if (editingId !== null) {
				return;
			}

			// Need a selected node to delete
			if (selectedId === null || selectedNode === undefined) {
				return;
			}

			// Only delete if node is empty (no name or whitespace-only name)
			const nodeName = selectedNode.name ?? '';
			if (nodeName.trim() !== '') {
				return;
			}

			// Only delete if node has no children
			if (selectedNodeChildren && selectedNodeChildren.length > 0) {
				return;
			}

			// Find the node to select after deletion (previous sibling or parent)
			const currentIndex = visibleNodes.indexOf(selectedId);
			let nextSelectedId: string | null = null;

			if (currentIndex > 0) {
				// Select previous visible node
				nextSelectedId = visibleNodes[currentIndex - 1];
			} else if (selectedNode.parent_id !== null) {
				// No previous sibling, select parent
				nextSelectedId = selectedNode.parent_id;
			}

			// Delete the node
			deleteNodeMutation.mutate(selectedId, {
				onSuccess() {
					// Select the next node after deletion
					select(nextSelectedId);
				},
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, selectedNode, selectedNodeChildren, editingId, visibleNodes, deleteNodeMutation, select],
	);

	// Cmd+Enter: Toggle complete/uncomplete on selected node
	useHotkeys(
		'meta+enter',
		() => {
			// Need a selected node to toggle completion
			if (selectedId === null || selectedNode === undefined) {
				return;
			}

			const isCurrentlyCompleted = selectedNode.completedAt !== null;

			toggleCompleteMutation.mutate({
				nodeId: selectedId,
				isCurrentlyCompleted,
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
		},
		[selectedId, selectedNode, toggleCompleteMutation],
	);

	// Shift+Cmd+Up: Move node up among siblings
	useHotkeys(
		'shift+meta+up',
		() => {
			// Don't move if editing (let text editing handle the event)
			if (editingId !== null) {
				return;
			}

			// Need a selected node to move
			if (selectedId === null || selectedNode === undefined) {
				return;
			}

			// Get siblings of the selected node
			const parentId = selectedNode.parent_id;
			const queryKey = ['nodes', 'children', parentId];
			const siblings = queryClient.getQueryData<NodeResponse[]>(queryKey);

			if (!siblings || siblings.length < 2) {
				return;
			}

			// Sort siblings by priority to find the previous one
			const sortedSiblings = [...siblings].sort((a, b) => a.priority - b.priority);
			const selectedIndex = sortedSiblings.findIndex((sibling) => sibling.id === selectedId);

			// Can't move up if already at the top
			if (selectedIndex <= 0) {
				return;
			}

			const previousSibling = sortedSiblings[selectedIndex - 1];

			// Calculate new position: just before the previous sibling
			// If there's a sibling before the previous one, position between them
			// Otherwise, position before the previous sibling
			let newPosition: number;
			if (selectedIndex >= 2) {
				const beforePrevious = sortedSiblings[selectedIndex - 2];
				newPosition = Math.floor((beforePrevious.priority + previousSibling.priority) / 2);
			} else {
				// Moving to first position
				newPosition = previousSibling.priority - 100;
			}

			moveNodeMutation.mutate({
				nodeId: selectedId,
				parent_id: parentId,
				position: newPosition,
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, selectedNode, editingId, queryClient, moveNodeMutation],
	);

	// Shift+Cmd+Down: Move node down among siblings
	useHotkeys(
		'shift+meta+down',
		() => {
			// Don't move if editing (let text editing handle the event)
			if (editingId !== null) {
				return;
			}

			// Need a selected node to move
			if (selectedId === null || selectedNode === undefined) {
				return;
			}

			// Get siblings of the selected node
			const parentId = selectedNode.parent_id;
			const queryKey = ['nodes', 'children', parentId];
			const siblings = queryClient.getQueryData<NodeResponse[]>(queryKey);

			if (!siblings || siblings.length < 2) {
				return;
			}

			// Sort siblings by priority to find the next one
			const sortedSiblings = [...siblings].sort((a, b) => a.priority - b.priority);
			const selectedIndex = sortedSiblings.findIndex((sibling) => sibling.id === selectedId);

			// Can't move down if already at the bottom
			if (selectedIndex === -1 || selectedIndex >= sortedSiblings.length - 1) {
				return;
			}

			const nextSibling = sortedSiblings[selectedIndex + 1];

			// Calculate new position: just after the next sibling
			// If there's a sibling after the next one, position between them
			// Otherwise, position after the next sibling
			let newPosition: number;
			if (selectedIndex + 2 < sortedSiblings.length) {
				const afterNext = sortedSiblings[selectedIndex + 2];
				newPosition = Math.floor((nextSibling.priority + afterNext.priority) / 2);
			} else {
				// Moving to last position
				newPosition = nextSibling.priority + 100;
			}

			moveNodeMutation.mutate({
				nodeId: selectedId,
				parent_id: parentId,
				position: newPosition,
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, selectedNode, editingId, queryClient, moveNodeMutation],
	);

	// Shift+Cmd+D: Duplicate selected node (shallow copy)
	useHotkeys(
		'shift+meta+d',
		() => {
			// Don't duplicate if editing (let text editing handle the event)
			if (editingId !== null) {
				return;
			}

			// Need a selected node to duplicate
			if (selectedId === null || selectedNode === undefined) {
				return;
			}

			// Get the parent_id (same as selected node's parent)
			const parentId = selectedNode.parent_id;

			// Get siblings to calculate position after the selected node
			const queryKey = ['nodes', 'children', parentId];
			const siblings = queryClient.getQueryData<NodeResponse[]>(queryKey);
			const selectedNodePriority = selectedNode.priority;

			// Position after the selected node
			let position: number;
			if (siblings) {
				const sortedSiblings = [...siblings].sort((a, b) => a.priority - b.priority);
				const selectedIndex = sortedSiblings.findIndex((sibling) => sibling.id === selectedId);
				if (selectedIndex === -1 || selectedIndex === sortedSiblings.length - 1) {
					// Selected is last or not found, position after
					position = selectedNodePriority + 100;
				} else {
					// Position between selected and next sibling
					const nextPriority = sortedSiblings[selectedIndex + 1].priority;
					position = Math.floor((selectedNodePriority + nextPriority) / 2);
				}
			} else {
				position = selectedNodePriority + 100;
			}

			// Create the duplicate node with the same name and note
			createNodeMutation.mutate(
				{
					parent_id: parentId ?? undefined,
					name: selectedNode.name ?? '',
					note: selectedNode.note ?? undefined,
					position,
				},
				{
					onSuccess(createdNode) {
						// Select the new duplicate node
						select(createdNode.id);
					},
				},
			);
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, selectedNode, editingId, queryClient, createNodeMutation, select],
	);

	// Shift+Cmd+9: Jump to previous sibling
	useHotkeys(
		'shift+meta+9',
		() => {
			// Don't jump if editing (let text editing handle the event)
			if (editingId !== null) {
				return;
			}

			// Need a selected node to find siblings
			if (selectedId === null || selectedNode === undefined) {
				return;
			}

			// Get siblings of the selected node
			const parentId = selectedNode.parent_id;
			const queryKey = ['nodes', 'children', parentId];
			const siblings = queryClient.getQueryData<NodeResponse[]>(queryKey);

			if (!siblings || siblings.length < 2) {
				return;
			}

			// Sort siblings by priority to find the previous one
			const sortedSiblings = [...siblings].sort((a, b) => a.priority - b.priority);
			const selectedIndex = sortedSiblings.findIndex((sibling) => sibling.id === selectedId);

			// Can't jump to previous if already at the first sibling
			if (selectedIndex <= 0) {
				return;
			}

			const previousSibling = sortedSiblings[selectedIndex - 1];
			select(previousSibling.id);
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, selectedNode, editingId, queryClient, select],
	);

	// Shift+Cmd+0: Jump to next sibling
	useHotkeys(
		'shift+meta+0',
		() => {
			// Don't jump if editing (let text editing handle the event)
			if (editingId !== null) {
				return;
			}

			// Need a selected node to find siblings
			if (selectedId === null || selectedNode === undefined) {
				return;
			}

			// Get siblings of the selected node
			const parentId = selectedNode.parent_id;
			const queryKey = ['nodes', 'children', parentId];
			const siblings = queryClient.getQueryData<NodeResponse[]>(queryKey);

			if (!siblings || siblings.length < 2) {
				return;
			}

			// Sort siblings by priority to find the next one
			const sortedSiblings = [...siblings].sort((a, b) => a.priority - b.priority);
			const selectedIndex = sortedSiblings.findIndex((sibling) => sibling.id === selectedId);

			// Can't jump to next if already at the last sibling
			if (selectedIndex === -1 || selectedIndex >= sortedSiblings.length - 1) {
				return;
			}

			const nextSibling = sortedSiblings[selectedIndex + 1];
			select(nextSibling.id);
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, selectedNode, editingId, queryClient, select],
	);

	// Option+Cmd+Up: Focus previous sibling (zoom to previous sibling of current zoomed node)
	useHotkeys(
		'alt+meta+up',
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
			const sortedSiblings = [...zoomedNodeSiblings].sort((a, b) => a.priority - b.priority);
			const currentIndex = sortedSiblings.findIndex((sibling) => sibling.id === zoomedNodeId);

			// Can't focus previous if already at the first sibling
			if (currentIndex <= 0) {
				return;
			}

			const previousSibling = sortedSiblings[currentIndex - 1];
			void navigate(`/node/${previousSibling.id}`);
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[zoomedNodeId, zoomedNode, zoomedNodeSiblings, navigate],
	);

	// Option+Cmd+Down: Focus next sibling (zoom to next sibling of current zoomed node)
	useHotkeys(
		'alt+meta+down',
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
			const sortedSiblings = [...zoomedNodeSiblings].sort((a, b) => a.priority - b.priority);
			const currentIndex = sortedSiblings.findIndex((sibling) => sibling.id === zoomedNodeId);

			// Can't focus next if already at the last sibling
			if (currentIndex === -1 || currentIndex >= sortedSiblings.length - 1) {
				return;
			}

			const nextSibling = sortedSiblings[currentIndex + 1];
			void navigate(`/node/${nextSibling.id}`);
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[zoomedNodeId, zoomedNode, zoomedNodeSiblings, navigate],
	);

	// Shift+Cmd+Backspace: Force delete node and all descendants
	useHotkeys(
		'shift+meta+backspace',
		() => {
			// Don't delete if editing (let text editing handle the event)
			if (editingId !== null) {
				return;
			}

			// Need a selected node to delete
			if (selectedId === null || selectedNode === undefined) {
				return;
			}

			// Find the node to select after deletion (previous sibling or parent)
			const currentIndex = visibleNodes.indexOf(selectedId);
			let nextSelectedId: string | null = null;

			if (currentIndex > 0) {
				// Select previous visible node
				nextSelectedId = visibleNodes[currentIndex - 1];
			} else if (selectedNode.parent_id !== null) {
				// No previous sibling, select parent
				nextSelectedId = selectedNode.parent_id;
			}

			// Delete the node (force delete - no checks for empty/children)
			deleteNodeMutation.mutate(selectedId, {
				onSuccess() {
					// Select the next node after deletion
					select(nextSelectedId);
				},
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, selectedNode, editingId, visibleNodes, deleteNodeMutation, select],
	);

	// Option+Cmd+8: Set layout mode to bullets (default mode)
	useHotkeys(
		'alt+meta+8',
		() => {
			// Need a selected node to change layout mode
			if (selectedId === null) {
				return;
			}

			updateNodeMutation.mutate({
				nodeId: selectedId,
				layoutMode: 'bullets',
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
		},
		[selectedId, updateNodeMutation],
	);

	// Option+Cmd+9: Set layout mode to todo (shows checkboxes)
	useHotkeys(
		'alt+meta+9',
		() => {
			// Need a selected node to change layout mode
			if (selectedId === null) {
				return;
			}

			updateNodeMutation.mutate({
				nodeId: selectedId,
				layoutMode: 'todo',
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
		},
		[selectedId, updateNodeMutation],
	);

	// Option+Cmd+1: Set layout mode to heading 1 (largest heading)
	useHotkeys(
		'alt+meta+1',
		() => {
			// Need a selected node to change layout mode
			if (selectedId === null) {
				return;
			}

			updateNodeMutation.mutate({
				nodeId: selectedId,
				layoutMode: 'h1',
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
		},
		[selectedId, updateNodeMutation],
	);

	// Option+Cmd+2: Set layout mode to heading 2 (medium heading)
	useHotkeys(
		'alt+meta+2',
		() => {
			// Need a selected node to change layout mode
			if (selectedId === null) {
				return;
			}

			updateNodeMutation.mutate({
				nodeId: selectedId,
				layoutMode: 'h2',
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
		},
		[selectedId, updateNodeMutation],
	);

	// Option+Cmd+3: Set layout mode to heading 3 (smallest heading)
	useHotkeys(
		'alt+meta+3',
		() => {
			// Need a selected node to change layout mode
			if (selectedId === null) {
				return;
			}

			updateNodeMutation.mutate({
				nodeId: selectedId,
				layoutMode: 'h3',
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
		},
		[selectedId, updateNodeMutation],
	);

	// Option+Cmd+4: Set layout mode to paragraph (no bullets, prose text)
	useHotkeys(
		'alt+meta+4',
		() => {
			// Need a selected node to change layout mode
			if (selectedId === null) {
				return;
			}

			updateNodeMutation.mutate({
				nodeId: selectedId,
				layoutMode: 'paragraph',
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
		},
		[selectedId, updateNodeMutation],
	);

	// Ctrl+L: Toggle left sidebar
	useHotkeys(
		'ctrl+l',
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
		'meta+shift+/',
		() => {
			toggleRightSidebar();
		},
		{
			preventDefault: true,
			enableOnFormTags: true,
		},
		[toggleRightSidebar],
	);

	// Cmd+O: Toggle show/hide completed nodes
	useHotkeys(
		'meta+o',
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
		'shift+meta+8',
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

	// Escape: Open search panel (when not editing and search is closed)
	// Note: When search panel is open, it handles its own Escape key to close
	useHotkeys(
		'escape',
		() => {
			// Don't open search if editing (Escape should cancel editing)
			if (editingId !== null || editingNoteId !== null) {
				return;
			}

			// Don't open search if already open (the SearchPanel handles closing)
			if (searchPanelOpen) {
				return;
			}

			// Don't open search if jump menu is open
			if (jumpMenuOpen) {
				return;
			}

			toggleSearchPanel();
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[editingId, editingNoteId, searchPanelOpen, jumpMenuOpen, toggleSearchPanel],
	);

	// Cmd+K: Open jump menu OR link insert modal
	// - If text is selected in an editable field: open link insert modal
	// - Otherwise: open jump menu (command palette style navigation)
	// Note: When jump menu is open, it handles its own Escape key to close
	const openLinkInsert = useOutlineStore((state) => state.openLinkInsert);
	const openExportDialog = useOutlineStore((state) => state.openExportDialog);

	useHotkeys(
		'meta+k',
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
	useHotkeys(
		'ctrl+t',
		async () => {
			// Don't zoom if editing
			if (editingId !== null || editingNoteId !== null) {
				return;
			}

			// Format today's date in common formats to search
			const today = new Date();
			const monthNames = [
				'January',
				'February',
				'March',
				'April',
				'May',
				'June',
				'July',
				'August',
				'September',
				'October',
				'November',
				'December',
			];
			const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
			const day = today.getDate();
			const month = monthNames[today.getMonth()];
			const year = today.getFullYear();
			const dayOfWeek = dayNames[today.getDay()];

			// Try common date formats
			const dateFormats = [
				`${month} ${day}, ${year}`,
				`${dayOfWeek}, ${month} ${day}`,
				`${month} ${day}`,
				`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
			];

			// Search for nodes containing today's date
			for (const dateFormat of dateFormats) {
				const response = await fetch('/api/search', {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({query: dateFormat, limit: 1}),
				});

				if (response.ok) {
					const data = (await response.json()) as {results: Array<{id: string; name: string | null}>};
					if (data.results.length > 0) {
						void navigate(`/node/${data.results[0].id}`);
						return;
					}
				}
			}

			// If no node found, could show a notification (for now just do nothing)
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[editingId, editingNoteId, navigate],
	);

	// Shift+Cmd+E (⇧⌘E): Export selected node(s)
	// Opens export dialog with options for plain text, markdown, or OPML
	useHotkeys(
		'shift+meta+e',
		() => {
			// Need at least one selected node to export
			if (selectedId === null) {
				return;
			}

			openExportDialog({
				nodeIds: [selectedId],
			});
		},
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedId, openExportDialog],
	);
}
