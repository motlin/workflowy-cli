// fallow-ignore-file circular-dependency
// Mutual recursion between OutlineNode and RecursiveOutlineTree is intentional.
import {useQueryClient} from '@tanstack/react-query';
import {nodeKeys} from '../node-cache.js';
import type {NodeAttachment, NodeResponse} from '../../node-types.js';
import {useState} from 'react';
import {useNodeNavigation, uuidToShortId} from '../navigation.js';
import {useNodeDragDrop} from '../hooks/use-node-drag-drop.js';
import {useDeleteNode, useToggleComplete} from '../hooks/use-nodes.js';
import {useOutlineStore} from '../stores/outline.js';
import {EditableNote} from './editable-note.js';
import {EditableText} from './editable-text.js';
import {resolveLayoutMode} from './layout-mode.js';
import {NodeContextMenuButton} from './node-context-menu.js';
import {RecursiveOutlineTree} from './outline-tree.js';

/**
 * Renders a file-attachment indicator beneath a node's text. Live attachments
 * show a paperclip and the file name; deleted attachments (Workflowy removed
 * the underlying file) are dimmed and struck through with a trash marker.
 */
function NodeAttachmentIndicator({attachment}: {attachment: NodeAttachment}) {
	const className = ['node-attachment', attachment.isDeleted && 'deleted'].filter(Boolean).join(' ');
	return (
		<div
			className={className}
			title={attachment.isDeleted ? `Deleted attachment: ${attachment.fileName}` : attachment.fileName}
		>
			<span className="node-attachment-icon">{attachment.isDeleted ? '🗑️' : '📎'}</span>
			<span className="node-attachment-name">{attachment.fileName}</span>
		</div>
	);
}

interface OutlineNodeProps {
	node: NodeResponse;
	depth: number;
	isExpanded: boolean;
}

interface VirtualizedOutlineNodeProps {
	node: NodeResponse;
	depth: number;
	isExpanded: boolean;
	hasChildren: boolean;
}

/**
 * Recursively collects all descendant IDs from cached children data.
 * Used for expand all / collapse all operations on a subtree.
 */
function collectDescendantIds(nodeId: string, queryClient: ReturnType<typeof useQueryClient>): string[] {
	const result: string[] = [nodeId];
	const children = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(nodeId));
	if (children) {
		for (const child of children) {
			result.push(...collectDescendantIds(child.id, queryClient));
		}
	}
	return result;
}

const INDENT_PER_LEVEL = 36;

/**
 * Renders vertical guide lines for tree indentation.
 * Each line represents one level of nesting.
 */
function IndentGuideLines({depth}: {depth: number}) {
	if (depth === 0) return null;

	const lines = [];
	for (let i = 0; i < depth; i++) {
		lines.push(
			<div
				className="indent-guide-line"
				key={i}
				style={{left: `${i * INDENT_PER_LEVEL + 9}px`}}
			/>,
		);
	}
	return <>{lines}</>;
}

/**
 * Renders a single node in the virtualized outline tree.
 * - Displays bullet point, node text, and expand/collapse toggle
 * - Click bullet to zoom into node
 * - Shows completed state with strikethrough
 * - Indentation calculated from depth prop
 * - Drag bullet to move node
 * - Triggers children fetch when expanded
 */
export function VirtualizedOutlineNode({node, depth, isExpanded, hasChildren}: VirtualizedOutlineNodeProps) {
	const {
		toggleExpand,
		expandAll,
		collapseDescendants,
		select,
		selectedId,
		editingId,
		editingClickPosition,
		editingNoteId,
	} = useOutlineStore();
	const queryClient = useQueryClient();
	const {navigateToNode} = useNodeNavigation();
	const deleteNode = useDeleteNode();
	const toggleComplete = useToggleComplete();
	const isSelected = selectedId === node.id;
	const isEditing = editingId === node.id;
	const isEditingNote = editingNoteId === node.id;
	const isCompleted = node.completedAt !== null;
	const layout = resolveLayoutMode(node.data.layoutMode);

	const {
		isDragging,
		isDragOver,
		dragOverPosition,
		handleDragStart,
		handleDragEnd,
		handleDragOver,
		handleDragLeave,
		handleDrop,
	} = useNodeDragDrop({nodeId: node.id, parentId: node.parent_id, priority: node.priority});
	const [isHovered, setIsHovered] = useState(false);

	const handleToggleExpand = () => {
		toggleExpand(node.id);
	};

	const handleSelect = () => {
		select(node.id);
	};

	const handleBulletClick = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		navigateToNode(node.id);
	};

	const handleComplete = () => {
		toggleComplete.mutate({nodeId: node.id, isCurrentlyCompleted: isCompleted});
	};

	const handleDelete = () => {
		deleteNode.mutate(node.id);
	};

	const handleExpandAll = () => {
		const descendantIds = collectDescendantIds(node.id, queryClient);
		expandAll(descendantIds);
	};

	const handleCollapseAll = () => {
		const descendantIds = collectDescendantIds(node.id, queryClient);
		collapseDescendants(descendantIds);
	};

	const nameClasses = [
		'name',
		isSelected && 'selected',
		isCompleted && 'completed',
		isDragging && 'dragging',
		isDragOver && 'drag-over',
		isDragOver && dragOverPosition && `drag-over-${dragOverPosition}`,
	]
		.filter(Boolean)
		.join(' ');

	const isMirror = node.isMirror === true;
	const isCollapsedWithChildren = hasChildren && !isExpanded;
	const bulletClasses = [
		'bullet',
		isDragging && 'dragging',
		isCollapsedWithChildren && 'collapsed',
		isMirror && 'mirror',
	]
		.filter(Boolean)
		.join(' ');

	// Calculate indentation based on depth
	const indentStyle = {
		paddingLeft: `${depth * INDENT_PER_LEVEL}px`,
	};

	const projectClasses = ['project', !hasChildren && 'leaf', layout.projectClass].filter(Boolean).join(' ');

	return (
		<div
			className={projectClasses}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			style={indentStyle}
		>
			<IndentGuideLines depth={depth} />
			<div
				className={nameClasses}
				onClick={handleSelect}
				onDragLeave={handleDragLeave}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
			>
				<NodeContextMenuButton
					isVisible={isHovered || isSelected}
					node={node}
					onCollapseAll={handleCollapseAll}
					onComplete={handleComplete}
					onDelete={handleDelete}
					onExpandAll={handleExpandAll}
				/>
				<a
					className={`expand${isExpanded ? ' expanded' : ''}`}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						handleToggleExpand();
					}}
				>
					<svg
						className="expand-svg"
						height="20"
						viewBox="0 0 20 20"
						width="20"
					>
						<path
							d="M13.75 9.56879C14.0833 9.76124 14.0833 10.2424 13.75 10.4348L8.5 13.4659C8.16667 13.6584 7.75 13.4178 7.75 13.0329L7.75 6.97072C7.75 6.58582 8.16667 6.34525 8.5 6.5377L13.75 9.56879Z"
							fill="currentColor"
							stroke="none"
						/>
					</svg>
				</a>
				<a
					aria-label={
						isMirror ? 'Mirror, click to zoom' : isCompleted ? 'Completed, click to zoom' : 'Click to zoom'
					}
					className={bulletClasses}
					data-handbook="bullet.handle"
					draggable
					href={`/node/${uuidToShortId(node.id)}`}
					onClick={handleBulletClick}
					onDragEnd={handleDragEnd}
					onDragStart={handleDragStart}
					onKeyDown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							navigateToNode(node.id);
						}
					}}
					title={isMirror ? 'Mirror node' : 'Drag to move'}
				>
					{isMirror ? (
						<svg
							className="bullet-svg mirror-diamond"
							fill="currentColor"
							height="100%"
							viewBox="0 0 16 16"
							width="100%"
						>
							<path d="M8 4 L4 8 L8 12 L12 8 Z" />
						</svg>
					) : (
						<svg
							className="bullet-svg"
							fill="currentColor"
							height="100%"
							viewBox="0 0 18 18"
							width="100%"
						>
							<circle
								cx="9"
								cy="9"
								r="3.5"
							/>
						</svg>
					)}
				</a>
				{layout.isTodo ? (
					<button
						aria-checked={isCompleted}
						aria-label={
							isCompleted ? 'Completed, click to un-complete' : 'Not completed, click to complete'
						}
						className={`todo-checkbox${isCompleted ? ' checked' : ''}`}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							handleComplete();
						}}
						role="checkbox"
						type="button"
					>
						<svg
							fill="none"
							height="16"
							viewBox="0 0 16 16"
							width="16"
						>
							<rect
								fill="none"
								height="13"
								rx="3"
								stroke="currentColor"
								strokeWidth="1.5"
								width="13"
								x="1.5"
								y="1.5"
							/>
							{isCompleted ? (
								<path
									d="M4 8.5 L7 11 L12 5"
									fill="none"
									stroke="currentColor"
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="2"
								/>
							) : null}
						</svg>
					</button>
				) : null}
				<div className="content">
					<EditableText
						clickPosition={isEditing ? (editingClickPosition ?? undefined) : undefined}
						initialValue={node.name ?? ''}
						isEditing={isEditing}
						nodeId={node.id}
						parentId={node.parent_id}
						priority={node.priority}
					/>
					<EditableNote
						initialValue={node.note ?? ''}
						isEditing={isEditingNote}
						nodeId={node.id}
					/>
					{node.attachment ? <NodeAttachmentIndicator attachment={node.attachment} /> : null}
				</div>
			</div>
			<div className="drop-line">
				<div className="line" />
			</div>
		</div>
	);
}

/**
 * Legacy OutlineNode that renders recursively with nested OutlineTrees.
 * Kept for compatibility and used by RecursiveOutlineTree.
 */
export function OutlineNode({node, depth, isExpanded}: OutlineNodeProps) {
	const {
		toggleExpand,
		expandAll,
		collapseDescendants,
		select,
		selectedId,
		editingId,
		editingClickPosition,
		editingNoteId,
	} = useOutlineStore();
	const queryClient = useQueryClient();
	const {navigateToNode} = useNodeNavigation();
	const deleteNode = useDeleteNode();
	const toggleComplete = useToggleComplete();
	const isSelected = selectedId === node.id;
	const isEditing = editingId === node.id;
	const isEditingNote = editingNoteId === node.id;
	const isCompleted = node.completedAt !== null;
	const layout = resolveLayoutMode(node.data.layoutMode);

	const {
		isDragging,
		isDragOver,
		dragOverPosition,
		handleDragStart,
		handleDragEnd,
		handleDragOver,
		handleDragLeave,
		handleDrop,
	} = useNodeDragDrop({nodeId: node.id, parentId: node.parent_id, priority: node.priority});
	const [isHovered, setIsHovered] = useState(false);

	const handleToggleExpand = () => {
		toggleExpand(node.id);
	};

	const handleSelect = () => {
		select(node.id);
	};

	const handleBulletClick = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		navigateToNode(node.id);
	};

	const handleComplete = () => {
		toggleComplete.mutate({nodeId: node.id, isCurrentlyCompleted: isCompleted});
	};

	const handleDelete = () => {
		deleteNode.mutate(node.id);
	};

	const handleExpandAll = () => {
		const descendantIds = collectDescendantIds(node.id, queryClient);
		expandAll(descendantIds);
	};

	const handleCollapseAll = () => {
		const descendantIds = collectDescendantIds(node.id, queryClient);
		collapseDescendants(descendantIds);
	};

	const nameClasses = [
		'name',
		isSelected && 'selected',
		isCompleted && 'completed',
		isDragging && 'dragging',
		isDragOver && 'drag-over',
		isDragOver && dragOverPosition && `drag-over-${dragOverPosition}`,
	]
		.filter(Boolean)
		.join(' ');

	const isMirrorLegacy = node.isMirror === true;
	const nodeHasChildren = node.hasChildren !== false;
	const bulletClasses = ['bullet', isDragging && 'dragging', isMirrorLegacy && 'mirror'].filter(Boolean).join(' ');

	const liClasses = ['outline-node', !nodeHasChildren && 'leaf', layout.projectClass].filter(Boolean).join(' ');

	return (
		<li
			className={liClasses}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			<div
				className={nameClasses}
				onClick={handleSelect}
				onDragLeave={handleDragLeave}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
			>
				<NodeContextMenuButton
					isVisible={isHovered || isSelected}
					node={node}
					onCollapseAll={handleCollapseAll}
					onComplete={handleComplete}
					onDelete={handleDelete}
					onExpandAll={handleExpandAll}
				/>
				<a
					className={`expand${isExpanded ? ' expanded' : ''}`}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						handleToggleExpand();
					}}
				>
					<svg
						className="expand-svg"
						height="20"
						viewBox="0 0 20 20"
						width="20"
					>
						<path
							d="M13.75 9.56879C14.0833 9.76124 14.0833 10.2424 13.75 10.4348L8.5 13.4659C8.16667 13.6584 7.75 13.4178 7.75 13.0329L7.75 6.97072C7.75 6.58582 8.16667 6.34525 8.5 6.5377L13.75 9.56879Z"
							fill="currentColor"
							stroke="none"
						/>
					</svg>
				</a>
				<a
					aria-label={
						isMirrorLegacy
							? 'Mirror, click to zoom'
							: isCompleted
								? 'Completed, click to zoom'
								: 'Click to zoom'
					}
					className={bulletClasses}
					data-handbook="bullet.handle"
					draggable
					href={`/node/${uuidToShortId(node.id)}`}
					onClick={handleBulletClick}
					onDragEnd={handleDragEnd}
					onDragStart={handleDragStart}
					onKeyDown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							navigateToNode(node.id);
						}
					}}
					title={isMirrorLegacy ? 'Mirror node' : 'Drag to move'}
				>
					<svg
						className="bullet-svg"
						fill="currentColor"
						height="100%"
						viewBox="0 0 18 18"
						width="100%"
					>
						{isMirrorLegacy ? (
							<rect
								height="5"
								rx="0.5"
								transform="rotate(45 9 9)"
								width="5"
								x="6.5"
								y="6.5"
							/>
						) : (
							<circle
								cx="9"
								cy="9"
								r="3.5"
							/>
						)}
					</svg>
				</a>
				{layout.isTodo ? (
					<button
						aria-checked={isCompleted}
						aria-label={
							isCompleted ? 'Completed, click to un-complete' : 'Not completed, click to complete'
						}
						className={`todo-checkbox${isCompleted ? ' checked' : ''}`}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							handleComplete();
						}}
						role="checkbox"
						type="button"
					>
						<svg
							fill="none"
							height="16"
							viewBox="0 0 16 16"
							width="16"
						>
							<rect
								fill="none"
								height="13"
								rx="3"
								stroke="currentColor"
								strokeWidth="1.5"
								width="13"
								x="1.5"
								y="1.5"
							/>
							{isCompleted ? (
								<path
									d="M4 8.5 L7 11 L12 5"
									fill="none"
									stroke="currentColor"
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="2"
								/>
							) : null}
						</svg>
					</button>
				) : null}
				<div className="content">
					<EditableText
						clickPosition={isEditing ? (editingClickPosition ?? undefined) : undefined}
						initialValue={node.name ?? ''}
						isEditing={isEditing}
						nodeId={node.id}
						parentId={node.parent_id}
						priority={node.priority}
					/>
					<EditableNote
						initialValue={node.note ?? ''}
						isEditing={isEditingNote}
						nodeId={node.id}
					/>
					{node.attachment ? <NodeAttachmentIndicator attachment={node.attachment} /> : null}
				</div>
			</div>
			<div className="drop-line">
				<div className="line" />
			</div>
			{isExpanded && (
				<RecursiveOutlineTree
					depth={depth + 1}
					parentId={node.id}
				/>
			)}
		</li>
	);
}
