// fallow-ignore-file circular-dependency
// Mutual recursion between OutlineRow and OutlineChildren is intentional.
import type {ReactNode} from "react";
import type {BacklinkItem} from "../../node-types.js";
import {useEffect, useRef, useState} from "react";
import {backlinksLabel, isBacklinksSectionVisible} from "../backlinks.js";
import {useBacklinks, useChildren, useCreateNode, useNode, useToggleComplete} from "../hooks/use-nodes.js";
import {nodeUrl} from "../navigation.js";
import {initialMaxToRender, nextMaxToRender} from "../render-window.js";
import {useOutlineStore} from "../stores/outline.js";
import {isPotentiallyVisible, planAddChild} from "../tree-ops.js";
import {ExpandArrow} from "./expand-arrow.js";
import {FaIcon} from "./fa-icons.js";
import {IconButton} from "./icon-button.js";
import {EditableNote} from "./editable-note.js";
import {EditableText} from "./editable-text.js";
import {NodeItemMenu, OutlineRow} from "./outline-node.js";
import {nameClassName, projectClassName} from "./row-classes.js";
import {rowClickResumesEditing} from "./row-click.js";

interface OutlineTreeProps {
	parentId: string | null;
}

/** Upstream's top-level `.children`: no margin, padding, or guide border. */
const ROOT_CHILDREN_CLASS =
	"children relative [.addedToSelection_&]:border-l-transparent [.item--zooming-in-progress_&]:border-l-transparent";

/** Upstream's nested `.children`: indented 36px past the parent bullet, the guide line is its left border. */
const NESTED_CHILDREN_CLASS =
	"children relative ml-[10px] pl-[25px] border-l-[length:var(--wf-border-width-s)] border-solid border-l-secondary [.addedToSelection_&]:border-l-transparent [.item--zooming-in-progress_&]:border-l-transparent";

/** Upstream's add-child button wrapper, rendered once after the zoomed page's root `.children`. */
const ADD_CHILD_CONTAINER_CLASS = "mt-m mobile:ml-[-6px] [.item--zooming-in-progress_&]:hidden print:hidden";

/**
 * Upstream's "+" add-child button: appends an empty last child to the zoomed item,
 * shaped like the previous visible row, and puts the caret in it. Uses no React
 * built-in hooks so tests can invoke its click handler directly.
 */
export function AddChildButton({parentId}: {parentId: string | null}) {
	const createNode = useCreateNode();
	const {data: nodes} = useChildren(parentId);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const resumeEditing = useOutlineStore((state) => state.resumeEditing);

	const handleClick = () => {
		const children = nodes ?? [];
		const visible = showCompleted ? children : children.filter((node) => node.completedAt === null);
		const plan = planAddChild({
			childCount: children.length,
			zoomedId: parentId,
			prevVisibleLayout: visible.at(-1)?.data.layoutMode,
		});
		createNode.mutate(
			{
				parent_id: plan.parent_id,
				name: plan.name,
				index: plan.index,
				...(plan.layoutMode === null ? {} : {layoutMode: plan.layoutMode}),
			},
			{
				onSuccess(createdNode) {
					resumeEditing(createdNode.id, 0);
				},
			},
		);
	};

	return (
		<div className={ADD_CHILD_CONTAINER_CLASS}>
			<IconButton
				aria-label="Add new item"
				className="addChildButton cursor-pointer desktop:hover:!bg-tertiary"
				onClick={handleClick}
				shape="circle"
				size="ms"
			>
				<FaIcon icon="fal:plus" />
			</IconButton>
		</div>
	);
}

/**
 * Upstream's zoom-root `.project.selected.root`: the zoomed node's title, edited in place
 * like any row (`editingId === nodeId`), in a `.name--main` row, its `.notes--main` note, then the root `.children`. At the main-tree root (no zoom) it is
 * `.mainTreeRoot` with a title-less `.name--root` row.
 */
function ZoomRootRow({nodeId, children}: {nodeId: string | null; children: ReactNode}) {
	const {data: node} = useNode(nodeId);
	const toggleComplete = useToggleComplete();
	const [isHovered, setIsHovered] = useState(false);
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const editingId = useOutlineStore((state) => state.editingId);
	const editingClickPosition = useOutlineStore((state) => state.editingClickPosition);
	const resumeEditing = useOutlineStore((state) => state.resumeEditing);
	const isEditingNote = useOutlineStore((state) => nodeId !== null && state.editingNoteId === nodeId);
	const isMainTreeRoot = nodeId === null;
	const isEditing = !isMainTreeRoot && editingId === nodeId;
	const nameHtml = isMainTreeRoot ? "" : (node?.name ?? "");

	// Like a row, the root's `.notes--main` mounts once noted, note-focused, or title-focused, and stays mounted.
	const [noteMounted, setNoteMounted] = useState(false);
	const shouldMountNote = !isMainTreeRoot && (Boolean(node?.note) || isEditingNote || isEditing);
	if (shouldMountNote && !noteMounted) {
		setNoteMounted(true);
	}

	// Clicking the title row outside its text edits the title with the caret at the end.
	const handleTitleClick = (event: React.MouseEvent<HTMLDivElement>) => {
		const target = event.target instanceof Element ? event.target : null;
		if (nodeId !== null && rowClickResumesEditing(target, event.currentTarget)) {
			resumeEditing(nodeId, Number.MAX_SAFE_INTEGER);
		}
	};

	return (
		<div
			className={[
				projectClassName({
					hasChildren: node?.hasChildren !== false,
					expanded: true,
					completed: node !== undefined && node.completedAt !== null,
					hasNote: Boolean(node?.note),
					noteFocused: isEditingNote,
					isZoomRoot: true,
					hasMirrors: false,
					highlighted: false,
					addedToSelection: false,
				}),
				isMainTreeRoot && "mainTreeRoot",
			]
				.filter(Boolean)
				.join(" ")}
		>
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- hover mounts the bullet-menu trigger; click is a mouse shortcut for editing the title, which keyboard users reach with the arrow keys */}
			<div
				tabIndex={-1}
				className={isMainTreeRoot ? "name name--root" : "name name--main"}
				onClick={isMainTreeRoot ? undefined : handleTitleClick}
				onMouseEnter={() => {
					setIsHovered(true);
				}}
				onMouseLeave={() => {
					setIsHovered(false);
				}}
			>
				<div className="notranslate content whitespace-pre-wrap" data-placeholder="Untitled">
					{node && (nameHtml !== "" || isEditing) ? (
						<EditableText
							clickPosition={isEditing ? (editingClickPosition ?? undefined) : undefined}
							initialValue={nameHtml}
							isEditing={isEditing}
							nodeId={node.id}
							parentId={node.parent_id}
							priority={node.priority}
						/>
					) : null}
				</div>
				<div className="wf-menu nameButtons" style={{marginLeft: 0}} />
				{node && !isMainTreeRoot && (isHovered || isMenuOpen) ? (
					<NodeItemMenu
						node={node}
						onComplete={() => {
							toggleComplete.mutate({nodeId: node.id, isCurrentlyCompleted: node.completedAt !== null});
						}}
						onOpenChange={setIsMenuOpen}
					/>
				) : null}
			</div>
			{node && (noteMounted || shouldMountNote) ? (
				<EditableNote initialValue={node.note ?? ""} isFocused={isEditingNote} isMain nodeId={node.id} />
			) : null}
			<div className="drop-line">
				<div className="line" />
			</div>
			{children}
		</div>
	);
}

/**
 * Zero-height marker after the last rendered row; scrolling it into view raises the
 * container's render limit. Local adaptation with no upstream class equivalent.
 */
function RenderSentinel({onReached}: {onReached: () => void}) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				onReached();
			}
		});
		if (ref.current) {
			observer.observe(ref.current);
		}
		return () => {
			observer.disconnect();
		};
	}, [onReached]);

	return <div className="render-sentinel" ref={ref} />;
}

/**
 * Upstream's Backlinks section (`children_extra.backlink_root`): the item's
 * references root as a collapsible `.project.references` row labelled
 * "N Backlinks", whose children are the backlink items, each a mirror row
 * preceded by its source's crumbs. The label counts every backlink with a
 * current source; completed sources hide like any completed row.
 */
function BacklinksSection({rootId, items, depth}: {rootId: string; items: BacklinkItem[]; depth: number}) {
	const isExpanded = useOutlineStore((state) => state.expandedIds.has(rootId));
	const toggleExpand = useOutlineStore((state) => state.toggleExpand);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const visibleItems = items.filter((item) => showCompleted || item.node.completedAt === null);
	return (
		<div
			className={projectClassName({
				references: true,
				hasChildren: true,
				expanded: isExpanded,
				completed: false,
				hasNote: false,
				noteFocused: false,
				isZoomRoot: false,
				hasMirrors: false,
				highlighted: false,
				addedToSelection: false,
			})}
		>
			<div tabIndex={-1} className={nameClassName({empty: true})} role="presentation">
				{/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- upstream's bullet anchor is unlabelled; the "N Backlinks" label beside it names the row */}
				<a
					href={nodeUrl(rootId)}
					data-handbook="bullet.handle"
					data-item-id={rootId}
					className="bullet bullet--backlink-root"
					style={{
						left: "calc(var(--name-left-overhang) + 1px)",
						width: "18px",
						["--bullet-size" as string]: "18px",
					}}
					onClick={(event) => {
						event.preventDefault();
						toggleExpand(rootId);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							toggleExpand(rootId);
						}
					}}
				>
					<span className="bulletHalo">
						<svg
							width="100%"
							height="100%"
							viewBox="0 0 18 18"
							fill="currentColor"
							className="zoomBulletIcon"
						>
							<circle cx="9" cy="9" r="3.5" />
						</svg>
					</span>
				</a>
				<div className="notranslate content whitespace-pre-wrap">
					<span className="innerContentContainer">{backlinksLabel(items.length)}</span>
				</div>
				<div className="wf-menu nameButtons" style={{marginLeft: 0}} />
				<ExpandArrow hasChildren isExpanded={isExpanded} nodeId={rootId} onToggle={toggleExpand} />
			</div>
			<div className="drop-line">
				<div className="line" />
			</div>
			{isExpanded && visibleItems.length > 0 ? (
				<div className={NESTED_CHILDREN_CLASS}>
					{visibleItems.map((item) => (
						<OutlineRow
							key={item.node.id}
							backlinkCrumbs={item.crumbs}
							depth={depth + 1}
							node={item.node}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

/**
 * Upstream's `div.children`: the visible children of `parentId`, each a recursive
 * `OutlineRow`, then, once every child is rendered, the item's Backlinks section.
 * Renders nothing when neither shows, so a collapsed or empty parent has no
 * `.children` in the DOM.
 */
export function OutlineChildren({
	parentId,
	isRoot = false,
	depth = 1,
}: {
	parentId: string | null;
	isRoot?: boolean;
	depth?: number;
}) {
	const {data: nodes} = useChildren(parentId);
	const {data: backlinks} = useBacklinks(parentId);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const animatingCompletionIds = useOutlineStore((state) => state.animatingCompletionIds);
	const visibleNodes = nodes?.filter((node) => isPotentiallyVisible(node, showCompleted, animatingCompletionIds));
	const [maxToRender, setMaxToRender] = useState(initialMaxToRender);
	const total = visibleNodes?.length ?? 0;
	const growWindow = () => {
		setMaxToRender((current) => nextMaxToRender(current, total));
	};
	const backlinksRootId =
		total <= maxToRender && isBacklinksSectionVisible(backlinks, showCompleted) ? backlinks?.rootId : null;

	if (!visibleNodes || (total === 0 && backlinksRootId == null)) {
		return null;
	}

	return (
		<div className={isRoot ? ROOT_CHILDREN_CLASS : NESTED_CHILDREN_CLASS}>
			{visibleNodes.slice(0, maxToRender).map((node) => (
				<OutlineRow key={node.id} depth={depth} node={node} />
			))}
			{total > maxToRender && <RenderSentinel onReached={growWindow} />}
			{backlinksRootId == null ? null : (
				<BacklinksSection depth={depth} items={backlinks?.items ?? []} rootId={backlinksRootId} />
			)}
		</div>
	);
}

/**
 * Renders the outline under `parentId` as nested `.project` / `.children` elements,
 * matching upstream's DOM: each expanded row holds its children inline.
 */
export function OutlineTree({parentId}: OutlineTreeProps) {
	const {isLoading, error} = useChildren(parentId);

	if (isLoading) {
		return <div className="outline-tree-loading">Loading...</div>;
	}

	if (error) {
		return <div className="outline-tree-error">Error loading nodes: {error.message}</div>;
	}

	return (
		<div className="outline-tree-container">
			<div className="scroller">
				<ZoomRootRow nodeId={parentId}>
					<OutlineChildren isRoot parentId={parentId} />
					<AddChildButton parentId={parentId} />
				</ZoomRootRow>
			</div>
		</div>
	);
}
