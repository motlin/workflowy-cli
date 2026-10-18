// fallow-ignore-file circular-dependency
// Mutual recursion between OutlineNode and RecursiveOutlineTree is intentional.
import {useQueryClient} from "@tanstack/react-query";
import {nodeKeys} from "../node-cache.js";
import type {NodeAttachment, NodeResponse} from "../../node-types.js";
import {useState} from "react";
import {nodeRoute, useNodeNavigation} from "../navigation.js";
import {useNodeDragDrop} from "../hooks/use-node-drag-drop.js";
import {useDeleteNode, useToggleComplete} from "../hooks/use-nodes.js";
import {useOutlineStore} from "../stores/outline.js";
import {EditableNote} from "./editable-note.js";
import {EditableText} from "./editable-text.js";
import {resolveLayoutMode} from "./layout-mode.js";
import {NodeContextMenuButton} from "./node-context-menu.js";
import {RecursiveOutlineTree} from "./outline-tree.js";
import {nameClassName, projectClassName} from "./row-classes.js";

/**
 * Renders a file-attachment indicator beneath a node's text. Live attachments
 * show a paperclip and the file name; deleted attachments (Workflowy removed
 * the underlying file) are dimmed and struck through with a trash marker.
 */
function NodeAttachmentIndicator({attachment}: {attachment: NodeAttachment}) {
	const className = ["node-attachment", attachment.isDeleted && "deleted"].filter(Boolean).join(" ");
	return (
		<div
			className={className}
			title={attachment.isDeleted ? `Deleted attachment: ${attachment.fileName}` : attachment.fileName}
		>
			<span className="node-attachment-icon">{attachment.isDeleted ? "🗑️" : "📎"}</span>
			<span className="node-attachment-name">{attachment.fileName}</span>
		</div>
	);
}

interface NodeBulletProps {
	nodeId: string;
	isMirror: boolean;
	showHalo: boolean;
	onDragStart: (event: React.DragEvent) => void;
	onDragEnd: (event: React.DragEvent) => void;
}

/**
 * The zoom bullet: upstream's `a.bullet > span.bulletHalo > svg`. A collapsed
 * parent shows the halo; a mirror renders a diamond. Click or Enter zooms in.
 */
function NodeBullet({nodeId, isMirror, showHalo, onDragStart, onDragEnd}: NodeBulletProps) {
	const {navigateToNode} = useNodeNavigation();
	const className = ["bullet", isMirror && "diamond", showHalo && "bullet--show-halo keep-bullet"]
		.filter(Boolean)
		.join(" ");
	return (
		<a
			href={nodeRoute(nodeId)}
			data-handbook="bullet.handle"
			data-item-id={nodeId}
			className={className}
			style={{left: "calc(var(--name-left-overhang) + 1px)", width: "18px", ["--bullet-size" as string]: "18px"}}
			draggable
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				navigateToNode(nodeId);
			}}
			onDragEnd={onDragEnd}
			onDragStart={onDragStart}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					navigateToNode(nodeId);
				}
			}}
		>
			<span className="bulletHalo">
				{isMirror ? (
					<svg
						width="100%"
						height="100%"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="mirrorDiamondIcon"
					>
						<path d="M8 4 L4 8 L8 12 L12 8 Z" />
					</svg>
				) : (
					<svg width="100%" height="100%" viewBox="0 0 18 18" fill="currentColor" className="zoomBulletIcon">
						<circle cx="9" cy="9" r="3.5" />
					</svg>
				)}
			</span>
		</a>
	);
}

function TodoCheckbox({isCompleted, onComplete}: {isCompleted: boolean; onComplete: () => void}) {
	return (
		<button
			aria-label="Complete"
			aria-pressed={isCompleted}
			className={`todo-checkbox${isCompleted ? " checked" : ""}`}
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onComplete();
			}}
			type="button"
		>
			<svg fill="none" height="16" viewBox="0 0 16 16" width="16">
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
	);
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

interface NodeNameProps {
	node: NodeResponse;
	isExpanded: boolean;
	hasChildren: boolean;
	isHovered: boolean;
}

/**
 * Upstream's `.name` row: bullet, todo checkbox, `.content` holding the text,
 * an always-empty `.nameButtons`, the expand control, then the bullet-menu trigger.
 */
function NodeName({node, isExpanded, hasChildren, isHovered}: NodeNameProps) {
	const {
		toggleExpand,
		expandAll,
		collapseDescendants,
		resumeEditing,
		editingId,
		editingClickPosition,
		editingNoteId,
	} = useOutlineStore();
	const queryClient = useQueryClient();
	const deleteNode = useDeleteNode();
	const toggleComplete = useToggleComplete();
	const isEditing = editingId === node.id;
	const isEditingNote = editingNoteId === node.id;
	const isCompleted = node.completedAt !== null;
	const layout = resolveLayoutMode(node.data.layoutMode);
	const name = node.name ?? "";

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

	// Clicking the row outside its text edits the node with the caret at the end;
	// clicks inside an editor (the text or note being edited) belong to that editor.
	const handleRowClick = (event: React.MouseEvent) => {
		if (event.target instanceof Element && event.target.closest("[contenteditable]")) {
			return;
		}
		resumeEditing(node.id, Number.MAX_SAFE_INTEGER);
	};

	const handleComplete = () => {
		toggleComplete.mutate({nodeId: node.id, isCurrentlyCompleted: isCompleted});
	};

	const nameClasses = [
		nameClassName({empty: name === ""}),
		isDragging && "dragging",
		isDragOver && "drag-over",
		isDragOver && dragOverPosition && `drag-over-${dragOverPosition}`,
	]
		.filter(Boolean)
		.join(" ");

	return (
		// Mouse shortcut for editing; keyboard users reach nodes by moving the caret with the arrow keys.
		<div
			tabIndex={-1}
			className={nameClasses}
			onClick={handleRowClick}
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
			role="presentation"
		>
			<NodeBullet
				isMirror={node.isMirror === true}
				nodeId={node.id}
				onDragEnd={handleDragEnd}
				onDragStart={handleDragStart}
				showHalo={hasChildren && !isExpanded}
			/>
			{layout.isTodo ? <TodoCheckbox isCompleted={isCompleted} onComplete={handleComplete} /> : null}
			<div className="notranslate content whitespace-pre-wrap">
				{name !== "" || isEditing ? (
					<EditableText
						clickPosition={isEditing ? (editingClickPosition ?? undefined) : undefined}
						initialValue={name}
						isEditing={isEditing}
						nodeId={node.id}
						parentId={node.parent_id}
						priority={node.priority}
					/>
				) : null}
				<EditableNote initialValue={node.note ?? ""} isEditing={isEditingNote} nodeId={node.id} />
				{node.attachment ? <NodeAttachmentIndicator attachment={node.attachment} /> : null}
			</div>
			<div className="wf-menu nameButtons" style={{marginLeft: 0}} />
			<button
				aria-expanded={isExpanded}
				aria-label={isExpanded ? "Collapse" : "Expand"}
				className={`expand${isExpanded ? " expanded" : ""}`}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					toggleExpand(node.id);
				}}
				type="button"
			>
				<svg className="expand-svg" height="20" viewBox="0 0 20 20" width="20">
					<path
						d="M13.75 9.56879C14.0833 9.76124 14.0833 10.2424 13.75 10.4348L8.5 13.4659C8.16667 13.6584 7.75 13.4178 7.75 13.0329L7.75 6.97072C7.75 6.58582 8.16667 6.34525 8.5 6.5377L13.75 9.56879Z"
						fill="currentColor"
						stroke="none"
					/>
				</svg>
			</button>
			<NodeContextMenuButton
				isVisible={isHovered || isEditing}
				node={node}
				onCollapseAll={() => {
					collapseDescendants(collectDescendantIds(node.id, queryClient));
				}}
				onComplete={handleComplete}
				onDelete={() => {
					deleteNode.mutate(node.id);
				}}
				onExpandAll={() => {
					expandAll(collectDescendantIds(node.id, queryClient));
				}}
			/>
		</div>
	);
}

function rowProjectClassName(node: NodeResponse, hasChildren: boolean, isExpanded: boolean): string {
	return projectClassName({
		hasChildren,
		expanded: isExpanded,
		completed: node.completedAt !== null,
		hasNote: Boolean(node.note),
		noteFocused: false,
		isZoomRoot: false,
		hasMirrors: false,
		highlighted: false,
		addedToSelection: false,
		layoutClass: resolveLayoutMode(node.data.layoutMode).projectClass ?? undefined,
	});
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

const INDENT_PER_LEVEL = 36;

/**
 * Renders vertical guide lines for tree indentation.
 * Each line represents one level of nesting.
 */
function IndentGuideLines({depth}: {depth: number}) {
	if (depth === 0) {
		return null;
	}

	const lines = [];
	for (let i = 0; i < depth; i++) {
		lines.push(<div className="indent-guide-line" key={i} style={{left: `${i * INDENT_PER_LEVEL + 9}px`}} />);
	}
	return lines;
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
	const [isHovered, setIsHovered] = useState(false);

	return (
		<div
			className={rowProjectClassName(node, hasChildren, isExpanded)}
			onMouseEnter={() => {
				setIsHovered(true);
			}}
			onMouseLeave={() => {
				setIsHovered(false);
			}}
			style={{paddingLeft: `${depth * INDENT_PER_LEVEL}px`}}
		>
			<IndentGuideLines depth={depth} />
			<NodeName hasChildren={hasChildren} isExpanded={isExpanded} isHovered={isHovered} node={node} />
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
	const hasChildren = node.hasChildren !== false;

	return (
		<li className={`outline-node ${rowProjectClassName(node, hasChildren, isExpanded)}`}>
			<NodeName hasChildren={hasChildren} isExpanded={isExpanded} isHovered={false} node={node} />
			<div className="drop-line">
				<div className="line" />
			</div>
			{isExpanded && <RecursiveOutlineTree depth={depth + 1} parentId={node.id} />}
		</li>
	);
}
