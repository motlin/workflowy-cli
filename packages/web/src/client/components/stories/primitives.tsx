/**
 * Isolated primitive components for Storybook stories.
 * These components are extracted from the main outline components
 * to allow isolated testing without the full app context.
 */

import type {CSSProperties} from "react";

import {resolveLayoutMode} from "../layout-mode.js";

const INDENT_PER_LEVEL = 36;

interface BulletDotProps {
	isCollapsed?: boolean;
	isMirror?: boolean;
}

/**
 * The zoom bullet: upstream's `a.bullet > span.bulletHalo > svg`.
 * A collapsed parent shows the halo; a mirror renders a diamond.
 */
export function BulletDot({isCollapsed = false, isMirror = false}: BulletDotProps) {
	const classes = ["bullet", isMirror && "diamond", isCollapsed && "bullet--show-halo keep-bullet"]
		.filter(Boolean)
		.join(" ");

	return (
		<a
			href="/node/story-node"
			data-handbook="bullet.handle"
			data-item-id="story-node"
			className={classes}
			style={{left: "calc(var(--name-left-overhang) + 1px)", width: "18px", ["--bullet-size" as string]: "18px"}}
			draggable
			onClick={(event) => {
				event.preventDefault();
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

interface ExpandTriangleProps {
	isExpanded?: boolean;
	onClick?: () => void;
}

/**
 * The expand/collapse triangle indicator.
 * Points right when collapsed, rotates down when expanded.
 */
export function ExpandTriangle({isExpanded = false, onClick}: ExpandTriangleProps) {
	return (
		<button
			aria-expanded={isExpanded}
			aria-label={isExpanded ? "Collapse" : "Expand"}
			className={`expand${isExpanded ? " expanded" : ""}`}
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onClick?.();
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
	);
}

interface IndentGuideLinesProps {
	depth: number;
}

/**
 * Renders vertical guide lines for tree indentation.
 * Each line represents one level of nesting.
 */
export function IndentGuideLines({depth}: IndentGuideLinesProps) {
	if (depth === 0) {
		return null;
	}

	const lines = [];
	for (let i = 0; i < depth; i++) {
		lines.push(<div className="indent-guide-line" key={i} style={{left: `${i * INDENT_PER_LEVEL + 9}px`}} />);
	}
	return lines;
}

interface CompleteBulletProps {
	isExpanded?: boolean;
	isCompleted?: boolean;
	depth?: number;
	onToggleExpand?: () => void;
}

/**
 * Complete bullet assembly: triangle + dot + indent lines.
 */
export function CompleteBullet({
	isExpanded = false,
	isCompleted = false,
	depth = 0,
	onToggleExpand,
}: CompleteBulletProps) {
	const indentStyle: CSSProperties = {
		paddingLeft: `${depth * INDENT_PER_LEVEL}px`,
		position: "relative",
		display: "flex",
		alignItems: "center",
		gap: "4px",
	};

	return (
		<div className={["project", isCompleted && "done"].filter(Boolean).join(" ")} style={indentStyle}>
			<IndentGuideLines depth={depth} />
			<ExpandTriangle isExpanded={isExpanded} onClick={onToggleExpand} />
			<BulletDot isCollapsed={!isExpanded} />
		</div>
	);
}

interface DropLineProps {
	isVisible?: boolean;
}

/**
 * The drag indicator line shown during drag-and-drop operations.
 */
export function DropLine({isVisible = true}: DropLineProps) {
	return (
		<div className="drop-line" style={{opacity: isVisible ? 1 : 0}}>
			<div className="line" />
		</div>
	);
}

interface MenuButtonProps {
	isVisible?: boolean;
	onClick?: () => void;
}

/**
 * The three-dot menu button that triggers the context menu.
 */
export function MenuButton({isVisible = true, onClick}: MenuButtonProps) {
	return (
		<div className="nameButtons">
			<button
				aria-label="More actions"
				className={`node-context-menu-button ${isVisible ? "visible" : ""}`}
				onClick={onClick}
				title="More actions"
				type="button"
			>
				<svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24">
					<circle cx="6" cy="12" r="2" />
					<circle cx="12" cy="12" r="2" />
					<circle cx="18" cy="12" r="2" />
				</svg>
			</button>
		</div>
	);
}

interface MenuItemProps {
	label: string;
	onClick?: () => void;
	disabled?: boolean;
	danger?: boolean;
}

/**
 * Individual menu item for the context menu.
 */
export function MenuItem({label, onClick, disabled = false, danger = false}: MenuItemProps) {
	const classes = ["node-context-menu-item", disabled && "disabled", danger && "danger"].filter(Boolean).join(" ");

	return (
		<button className={classes} disabled={disabled} onClick={onClick} type="button">
			{label}
		</button>
	);
}

interface NoteDisplayProps {
	content: string;
	isExpanded?: boolean;
	onToggle?: () => void;
}

/**
 * Note display component (non-editing state).
 */
export function NoteDisplay({content, isExpanded = false, onToggle}: NoteDisplayProps) {
	if (!content.trim()) {
		return null;
	}

	return (
		<div
			className={`outline-node-note ${isExpanded ? "expanded" : "collapsed"}`}
			dangerouslySetInnerHTML={{__html: content}}
			onClick={onToggle}
			role="presentation"
		/>
	);
}

interface StaticNodeProps {
	name: string;
	note?: string;
	isCompleted?: boolean;
	isExpanded?: boolean;
	isEditing?: boolean;
	depth?: number;
	layoutMode?: string | null;
	onToggleExpand?: () => void;
}

/**
 * Static node component for stories (no state management).
 */
export function StaticNode({
	name,
	note = "",
	isCompleted = false,
	isExpanded = false,
	isEditing = false,
	depth = 0,
	layoutMode = null,
	onToggleExpand,
}: StaticNodeProps) {
	const nameClasses = ["name", isCompleted && "completed"].filter(Boolean).join(" ");
	const layout = resolveLayoutMode(layoutMode);
	const projectClasses = ["project", layout.projectClass].filter(Boolean).join(" ");

	const indentStyle: CSSProperties = {
		paddingLeft: `${depth * INDENT_PER_LEVEL}px`,
	};

	return (
		<div className={projectClasses} style={indentStyle}>
			<IndentGuideLines depth={depth} />
			<div className={nameClasses}>
				<MenuButton isVisible={isEditing} />
				<ExpandTriangle isExpanded={isExpanded} onClick={onToggleExpand} />
				<BulletDot />
				{layout.isTodo ? (
					<button
						aria-label="Complete"
						aria-pressed={isCompleted}
						className={`todo-checkbox${isCompleted ? " checked" : ""}`}
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
				) : null}
				<div className="content">
					<div className="content-editable" dangerouslySetInnerHTML={{__html: name}} />
					{note && <NoteDisplay content={note} isExpanded={false} />}
				</div>
			</div>
			<DropLine isVisible={false} />
		</div>
	);
}
