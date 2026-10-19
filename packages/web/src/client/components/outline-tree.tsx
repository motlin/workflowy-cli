// Mutual recursion between OutlineRow and OutlineChildren is intentional.
import type {ReactNode, Ref} from "react";
import type {BacklinkItem, NodeResponse} from "../../node-types.js";
import {useEffect, useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {backlinksLabel, isBacklinksSectionVisible} from "../backlinks.js";
import {useBacklinks, useChildren, useCreateNode, useNode, useToggleComplete} from "../hooks/use-nodes.js";
import {nodeUrl} from "../navigation.js";
import {isEntry} from "../item-selection.js";
import {currentSelectionView, HOME_ROOT} from "../hooks/use-selection-keymap.js";
import {dropHoverOf} from "../bullet-drag-state.js";
import {initialMaxToRender, nextMaxToRender} from "../render-window.js";
import {searchShowsCompleted, searchShowsNode} from "../search-filter.js";
import {usePrefetchSearchAncestors, useSearchFilter} from "../hooks/use-tree-search.js";
import {rootSearchClasses, shouldRenderAddChildButton} from "../search-classes.js";
import {useOutlineStore} from "../stores/outline.js";
import {isPotentiallyVisible, planAddChild, planAddSibling} from "../tree-ops.js";
import {ExpandArrow} from "./expand-arrow.js";
import {FaIcon} from "./fa-icons.js";
import {IconButton} from "./icon-button.js";
import {EditableNote} from "./editable-note.js";
import {EditableText} from "./editable-text.js";
import {resolveLayoutMode} from "./layout-mode.js";
import {NodeItemMenu, OutlineRow, TodoCheckbox} from "./outline-node.js";
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

/** The outline's own padding and gutters, not any row: a click there is a blank-space click. */
const BLANK_OUTLINE_SELECTOR = ".outline-tree-container, .scroller, .project.root, .project.root > .children";

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

	const handleClick = (event?: {currentTarget: {blur: () => void}}) => {
		const children = nodes ?? [];
		const visible = showCompleted ? children : children.filter((node) => node.completedAt === null);
		const plan = planAddChild({
			childCount: children.length,
			zoomedId: parentId,
			prevVisibleLayout: visible.at(-1)?.data.layoutMode,
		});
		// A client-generated id lets the caret enter the new row now, not after the round-trip;
		// blurring the button keeps Space/Enter typed meanwhile from clicking it again.
		const id = crypto.randomUUID();
		event?.currentTarget.blur();
		createNode.mutate({
			id,
			parent_id: plan.parent_id,
			name: plan.name,
			index: plan.index,
			...(plan.layoutMode === null ? {} : {layoutMode: plan.layoutMode}),
		});
		resumeEditing(id, 0);
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
 * Upstream's `.addSiblingButton`: a "+" at the bottom of a nested `.children` guide
 * line that creates an empty sibling right after `owner` (the row whose `.children`
 * holds it) and puts the caret in it. Clicking hides it with an inline opacity
 * until the next mouseenter. Uses no React built-in hooks so tests can invoke its
 * handlers directly.
 */
export function AddSiblingButton({owner}: {owner: NodeResponse}) {
	const createNode = useCreateNode();
	const {data: siblings} = useChildren(owner.parent_id);
	const resumeEditing = useOutlineStore((state) => state.resumeEditing);

	const handleClick = (event: {currentTarget: {style: {opacity: string}}}) => {
		const plan = planAddSibling({owner, siblings: siblings ?? [owner]});
		const id = crypto.randomUUID();
		event.currentTarget.style.opacity = "0";
		createNode.mutate({id, ...plan});
		resumeEditing(id, 0);
	};

	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream's markup is a bare svg; keyboard users add a sibling with Enter at the end of a row
		<svg
			viewBox="0 0 20 20"
			className="absolute left-[-11px] bottom-[3px] w-[20px] h-[20px] block opacity-0 hover:opacity-70 active:opacity-100 addSiblingButton"
			onClick={handleClick}
			onMouseEnter={(event: {currentTarget: {style: {opacity: string}}}) => {
				event.currentTarget.style.opacity = "";
			}}
		>
			<circle cx="10.5" cy="10.5" r="9" fill="var(--wf-background-quaternary)" />
			<line x1="6" y1="10.5" x2="15" y2="10.5" stroke="var(--wf-text-quaternary)" strokeWidth="1" />
			<line x1="10.5" y1="6" x2="10.5" y2="15" stroke="var(--wf-text-quaternary)" strokeWidth="1" />
		</svg>
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
	const isAddedToSelection = useOutlineStore((state) => nodeId !== null && isEntry(state.itemSelection, nodeId));
	const isMainTreeRoot = nodeId === null;
	const isDragHoveredIn = useOutlineStore((state) => dropHoverOf(state.dropIndicator, nodeId ?? HOME_ROOT) === "in");
	const isEditing = !isMainTreeRoot && editingId === nodeId;
	const searchRootClasses = rootSearchClasses(useSearchFilter());
	const nameHtml = isMainTreeRoot ? "" : (node?.name ?? "");
	const layout = resolveLayoutMode(node?.data.layoutMode);
	const handleComplete = () => {
		if (node) {
			toggleComplete.mutate({nodeId: node.id, isCurrentlyCompleted: node.completedAt !== null});
		}
	};

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
					addedToSelection: isAddedToSelection,
					layoutClass: layout.projectClass ?? undefined,
					dragHoveredIn: isDragHoveredIn,
				}),
				isMainTreeRoot && "mainTreeRoot",
				...searchRootClasses,
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
				{node && layout.isTodo ? (
					<TodoCheckbox isCompleted={node.completedAt !== null} onComplete={handleComplete} />
				) : null}
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
					<NodeItemMenu node={node} onComplete={handleComplete} onOpenChange={setIsMenuOpen} />
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
 * `OutlineRow`, then, once every child is rendered, the item's Backlinks section,
 * then (nested only) the add-sibling button.
 * Renders nothing when neither shows, so a collapsed or empty parent has no
 * `.children` in the DOM. During a search, rows the search does not show are
 * removed, and the Backlinks section is left out.
 */
export function OutlineChildren({
	parentId,
	owner,
	isRoot = false,
	depth = 1,
	containerRef,
}: {
	parentId: string | null;
	/** The `.children` element, for the expand/collapse slide. */
	containerRef?: Ref<HTMLDivElement>;
	/** The row whose `.children` this is; a nested `.children` ends with its add-sibling button. */
	owner?: NodeResponse;
	isRoot?: boolean;
	depth?: number;
}) {
	const {data: nodes} = useChildren(parentId);
	const {data: backlinks} = useBacklinks(parentId);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const animatingCompletionIds = useOutlineStore((state) => state.animatingCompletionIds);
	const search = useSearchFilter();
	const showsCompleted = searchShowsCompleted(showCompleted, search);
	const visibleNodes = nodes?.filter(
		(node) =>
			isPotentiallyVisible(node, showsCompleted, animatingCompletionIds) &&
			(search === null || searchShowsNode(node, search)),
	);
	const [maxToRender, setMaxToRender] = useState(initialMaxToRender);
	const total = visibleNodes?.length ?? 0;
	const growWindow = () => {
		setMaxToRender((current) => nextMaxToRender(current, total));
	};
	const backlinksRootId =
		search === null && total <= maxToRender && isBacklinksSectionVisible(backlinks, showCompleted)
			? backlinks?.rootId
			: null;

	if (!visibleNodes || (total === 0 && backlinksRootId == null)) {
		return null;
	}

	return (
		<div ref={containerRef} className={isRoot ? ROOT_CHILDREN_CLASS : NESTED_CHILDREN_CLASS}>
			{visibleNodes.slice(0, maxToRender).map((node) => (
				<OutlineRow key={node.id} depth={depth} node={node} />
			))}
			{total > maxToRender && <RenderSentinel onReached={growWindow} />}
			{backlinksRootId == null ? null : (
				<BacklinksSection depth={depth} items={backlinks?.items ?? []} rootId={backlinksRootId} />
			)}
			{isRoot || owner === undefined ? null : <AddSiblingButton owner={owner} />}
		</div>
	);
}

/**
 * Renders the outline under `parentId` as nested `.project` / `.children` elements,
 * matching upstream's DOM: each expanded row holds its children inline.
 */
export function OutlineTree({parentId}: OutlineTreeProps) {
	const {isLoading, error} = useChildren(parentId);
	const queryClient = useQueryClient();
	usePrefetchSearchAncestors(useSearchFilter());
	const showsAddChild = shouldRenderAddChildButton(useOutlineStore((state) => state.searchQuery));

	// A click on blank outline space (below or beside the rows) clears any item selection and edits the end of the
	// last visible row.
	const handleBlankClick = (event: React.MouseEvent<HTMLDivElement>) => {
		if (!(event.target instanceof Element) || !event.target.matches(BLANK_OUTLINE_SELECTOR)) {
			return;
		}
		const last = currentSelectionView(queryClient).rows.at(-1);
		const {clearItemSelection, resumeEditing} = useOutlineStore.getState();
		if (last === undefined) {
			clearItemSelection();
		} else {
			resumeEditing(last.id, Number.MAX_SAFE_INTEGER);
		}
	};

	if (isLoading) {
		return <div className="outline-tree-loading">Loading...</div>;
	}

	if (error) {
		return <div className="outline-tree-error">Error loading nodes: {error.message}</div>;
	}

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- a mouse shortcut to the last row; keyboard users move the caret with the arrow keys
		<div className="outline-tree-container" onClick={handleBlankClick}>
			<div className="scroller">
				<ZoomRootRow nodeId={parentId}>
					<OutlineChildren isRoot parentId={parentId} />
					{showsAddChild ? <AddChildButton parentId={parentId} /> : null}
				</ZoomRootRow>
			</div>
		</div>
	);
}
