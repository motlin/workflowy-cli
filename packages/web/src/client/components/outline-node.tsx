// fallow-ignore-file circular-dependency
// Mutual recursion between OutlineRow and OutlineChildren is intentional.
import type {BacklinkCrumb, NodeAttachment, NodeResponse} from "../../node-types.js";
import {memo, useContext, useEffect, useLayoutEffect, useRef, useState} from "react";
import {browserSlideDeps, slideDown, slideUp} from "../animate.js";
import {bulletClickAction, nodeUrl, useNodeNavigation} from "../navigation.js";
import {clearSelectionFromBullet, useContentMouseDown} from "../hooks/use-drag-select.js";
import {useBulletDrag} from "../hooks/use-bullet-drag.js";
import {useZoomTo} from "../hooks/use-zoom-to.js";
import {useMoveTo} from "../hooks/use-move-to.js";
import {useQueryClient} from "@tanstack/react-query";
import {toggleComplete, useCreateNode, useDeleteNode, useExpandAll, useUpdateNode} from "../hooks/use-nodes.js";
import {useCopyLink, useSortChildren} from "../hooks/use-item-actions.js";
import {deleteDates} from "../date-pills.js";
import {outlineActions, useOutlineStore} from "../stores/outline.js";
import {useOutlineSearchFilter} from "../search-filter-context.js";
import type {ClickPosition} from "../stores/outline.js";
import {useRowState} from "../hooks/use-row-state.js";
import {isSearchExpanded} from "../search-filter.js";
import {expansionSlide} from "../children-slide.js";
import {searchClasses, withClasses} from "../search-classes.js";
import {FlatCrumbs, LeftCollapsingCrumbs} from "./breadcrumbs.js";
import {EditableNote} from "./editable-note.js";
import {editableText} from "./editable-text.js";
import {expandArrow} from "./expand-arrow.js";
import {resolveLayoutMode} from "./layout-mode.js";
import {itemMenuLeft} from "../item-menu-model.js";
import {openInPane} from "../pane-commands.js";
import {ItemMenuTrigger} from "./node-context-menu.js";
import type {DropHover} from "../bullet-drag-state.js";
import {OutlineChildren} from "./outline-tree.js";
import {PaneContext, usePaneId} from "./pane-context.js";
import {nameClassName, projectClassName} from "./row-classes.js";
import {rowClickResumesEditing} from "./row-click.js";
import {planDuplicate, rowHasChildren} from "../tree-ops.js";

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
	onMouseDown: (event: React.MouseEvent<HTMLAnchorElement>) => void;
	/** A plain press that did not become a drag; a selected row's bullet clears the selection instead. */
	onZoom: () => void;
	onClearSelection: () => boolean;
}

/**
 * The zoom bullet: upstream's `a.bullet > span.bulletHalo > svg`. A collapsed
 * parent shows the halo; a mirror renders a diamond. A press that does not
 * become a drag, or Enter, zooms in. A plain element, not a component, so a resting row mounts no fiber for it.
 */
function nodeBullet({nodeId, isMirror, showHalo, onMouseDown, onZoom, onClearSelection}: NodeBulletProps) {
	const className = ["bullet", isMirror && "diamond", showHalo && "bullet--show-halo keep-bullet"]
		.filter(Boolean)
		.join(" ");
	return (
		<a
			href={nodeUrl(nodeId)}
			data-handbook="bullet.handle"
			data-item-id={nodeId}
			className={className}
			style={{left: "calc(var(--name-left-overhang) + 1px)", width: "18px", ["--bullet-size" as string]: "18px"}}
			onMouseDown={onMouseDown}
			onClick={(event) => {
				event.stopPropagation();
				if (bulletClickAction(event) === "browser") {
					return;
				}
				event.preventDefault();
				// Only a press the drag armed and released before moving 3px zooms; a finished drag does not.
				if (event.currentTarget.dataset.preDragClick !== "true") {
					return;
				}
				delete event.currentTarget.dataset.preDragClick;
				// A selected row's bullet clears the selection and stays put.
				if (onClearSelection()) {
					return;
				}
				onZoom();
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onZoom();
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

export function TodoCheckbox({isCompleted, onComplete}: {isCompleted: boolean; onComplete: () => void}) {
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

interface NodeItemMenuProps {
	node: NodeResponse;
	left?: string;
	onComplete: () => void;
	onOpenChange: (open: boolean) => void;
}

/** The bullet-menu trigger wired to the node's outline actions. */
export function NodeItemMenu({node, left, onComplete, onOpenChange}: NodeItemMenuProps) {
	const queryClient = useQueryClient();
	const {navigateToNode} = useNodeNavigation();
	const expandAll = useExpandAll();
	const {focusNote, focusName, openPresentation, openExportDialog, requestDatePicker} = outlineActions();
	const createNode = useCreateNode();
	const deleteNode = useDeleteNode();
	const updateNode = useUpdateNode();
	const moveTo = useMoveTo();
	const copyLink = useCopyLink();
	const sortChildren = useSortChildren();
	return (
		<ItemMenuTrigger
			actions={{
				onOpenInPane: () => {
					openInPane(useOutlineStore.getState(), node.id);
				},
				onComplete,
				onAddNote: () => {
					// Upstream: "Add note" from inside the note moves the caret to the end of the name.
					if (useOutlineStore.getState().editingNoteId === node.id) {
						focusName(node.id, "end");
					} else {
						focusNote(node.id);
					}
				},
				onAddDate: () => {
					requestDatePicker(node.id);
				},
				onDeleteDates: () => {
					// Upstream: name and note lose their dates in one undoable edit.
					updateNode.mutate({
						nodeId: node.id,
						name: deleteDates(node.name ?? ""),
						...(node.note === null ? {} : {note: deleteDates(node.note)}),
					});
				},
				onPresent: () => {
					navigateToNode(node.id);
					openPresentation(node.id);
				},
				onMoveTo: () => {
					void moveTo([node.id]);
				},
				onDuplicate: () => {
					// Same mutation as ⇧⌘D, without moving focus into the copy.
					createNode.mutate(planDuplicate(queryClient, node));
				},
				onExport: () => {
					openExportDialog({nodeIds: [node.id]});
				},
				onCopyLink: () => {
					void copyLink(node.id);
				},
				onMakeTemplate: () => {
					updateNode.mutate({nodeId: node.id, name: `${node.name ?? ""} #template`});
				},
				onDelete: () => {
					deleteNode.mutate(node.id);
				},
				onExpandAll: () => {
					expandAll(node.id, true);
				},
				onCollapseAll: () => {
					expandAll(node.id, false);
				},
				onSort: (direction) => {
					void sortChildren(node.id, direction);
				},
			}}
			left={left}
			node={node}
			onOpenChange={onOpenChange}
		/>
	);
}

interface NodeNameProps {
	node: NodeResponse;
	/** Whether this row's name is being edited in the active pane. */
	isEditing: boolean;
	/** Where the editing click landed, while `isEditing`. */
	editingClickPosition: ClickPosition | null;
	isExpanded: boolean;
	hasChildren: boolean;
	depth: number;
	withEmbedder: boolean;
	/** Whether a search is filtering the outline; the arrow then writes the search expansion. */
	searching: boolean;
	/** Classes the search appends to `.name`. */
	searchNameClasses: readonly string[];
}

/**
 * Upstream's `.name` row: bullet, todo checkbox, `.content` holding the text,
 * an always-empty `.nameButtons`, the expand control, then the bullet-menu trigger,
 * which is mounted only while `.name` is hovered or its menu is open.
 */
function NodeName({
	node,
	isEditing,
	editingClickPosition,
	isExpanded,
	hasChildren,
	depth,
	withEmbedder,
	searching,
	searchNameClasses,
}: NodeNameProps) {
	const [isHovered, setIsHovered] = useState(false);
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const {setItemMenuOpen, toggleExpand, toggleSearchExpansion, resumeEditing} = outlineActions();
	// A row unmounted with its menu open (collapsed parent, deleted row) must not leave a stale highlight.
	useEffect(
		() => () => {
			setItemMenuOpen(node.id, false);
		},
		[node.id, setItemMenuOpen],
	);
	const queryClient = useQueryClient();
	const expandAll = useExpandAll();
	const mainZoomTo = useZoomTo();
	const pane = useContext(PaneContext);
	const handleBulletMouseDown = useBulletDrag(node.id);
	// Inside a side pane a bullet zooms that pane; the main outline zooms by navigating.
	const zoomIn = () => {
		if (pane === null) {
			void mainZoomTo(node.id, "first_child");
		} else {
			pane.zoom(node.id);
		}
	};
	const isCompleted = node.completedAt !== null;
	const layout = resolveLayoutMode(node.data.layoutMode);
	const name = node.name ?? "";

	const handleContentMouseDown = useContentMouseDown(node.id);

	// Clicking the row outside its text edits the node with the caret at the end;
	// clicks inside an editor (the text or note being edited) belong to that editor.
	const handleRowClick = (event: React.MouseEvent<HTMLDivElement>) => {
		const target = event.target instanceof Element ? event.target : null;
		if (rowClickResumesEditing(target, event.currentTarget)) {
			resumeEditing(node.id, Number.MAX_SAFE_INTEGER);
		}
	};

	const handleComplete = () => {
		toggleComplete(queryClient, {nodeId: node.id, isCurrentlyCompleted: isCompleted});
	};

	const nameClasses = withClasses(nameClassName({empty: name === "", withEmbedder}), searchNameClasses);

	return (
		// Mouse shortcut for editing; keyboard users reach nodes by moving the caret with the arrow keys.
		<div
			tabIndex={-1}
			className={nameClasses}
			onClick={handleRowClick}
			onMouseEnter={() => {
				setIsHovered(true);
			}}
			onMouseLeave={() => {
				setIsHovered(false);
			}}
			role="presentation"
		>
			{nodeBullet({
				nodeId: node.id,
				isMirror: node.isMirror === true,
				showHalo: hasChildren && !isExpanded,
				onMouseDown: handleBulletMouseDown,
				onZoom: zoomIn,
				onClearSelection: () => clearSelectionFromBullet(queryClient, node.id),
			})}
			{layout.isTodo ? <TodoCheckbox isCompleted={isCompleted} onComplete={handleComplete} /> : null}
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- mouse-only item selection (⌘/⌥/⇧-press, drag); keyboard users select with ⇧↑/⇧↓ */}
			<div className="notranslate content whitespace-pre-wrap" onMouseDown={handleContentMouseDown}>
				{/* Called, not mounted: it only picks the editing or resting text, so it needs no fiber of its own. */}
				{name !== "" || isEditing
					? editableText({
							clickPosition: isEditing ? (editingClickPosition ?? undefined) : undefined,
							initialValue: name,
							isEditing,
							nodeId: node.id,
							parentId: node.parent_id,
							priority: node.priority,
						})
					: null}
				{node.attachment ? <NodeAttachmentIndicator attachment={node.attachment} /> : null}
			</div>
			<div className="wf-menu nameButtons" style={{marginLeft: 0}} />
			{/* Hook-free, so called as a plain element rather than mounted as a component. */}
			{expandArrow({
				hasChildren,
				isExpanded,
				nodeId: node.id,
				onExpandAll: searching ? undefined : expandAll,
				onToggle: searching
					? (id) => {
							toggleSearchExpansion(id, isExpanded);
						}
					: toggleExpand,
			})}
			{isHovered || isMenuOpen ? (
				<NodeItemMenu
					left={itemMenuLeft(hasChildren, depth)}
					node={node}
					onComplete={handleComplete}
					onOpenChange={(open) => {
						setIsMenuOpen(open);
						setItemMenuOpen(node.id, open);
					}}
				/>
			) : null}
		</div>
	);
}

function rowProjectClassName(
	node: NodeResponse,
	hasChildren: boolean,
	isExpanded: boolean,
	isEditingNote: boolean,
	slidingUp: boolean,
	slidingDown: boolean,
	moving: boolean,
	animatingShowChildren: boolean,
	addedToSelection: boolean,
	highlighted: boolean,
	dragHover: DropHover,
): string {
	return projectClassName({
		hasChildren,
		expanded: isExpanded,
		completed: node.completedAt !== null,
		hasNote: Boolean(node.note),
		noteFocused: isEditingNote,
		isZoomRoot: false,
		hasMirrors: false,
		highlighted,
		addedToSelection,
		layoutClass: resolveLayoutMode(node.data.layoutMode).projectClass ?? undefined,
		slidingUp,
		slidingDown,
		moving,
		animatingShowChildren,
		dragHoveredIn: dragHover === "in",
		dragHoveredAt: dragHover === "at",
	});
}

/**
 * Upstream's backlink breadcrumbs (`ui.item.name.beforebegin.backlink_breadcrumbs`):
 * the source's ancestors in gray above the backlink row, with Home only for a
 * top-level source. A local adaptation lays backlink crumbs out flat, without the
 * header's truncation engine; Found Dates crumbs (`fitted`) collapse from the left to fit.
 */
function BacklinkCrumbs({crumbs, fitted}: {crumbs: BacklinkCrumb[]; fitted: boolean}) {
	const items =
		crumbs.length === 0 ? [{id: "None", isRoot: true}] : crumbs.map(({id, name}) => ({id, name, isRoot: false}));
	return (
		<div className="text-xs mobile:text-s text-tertiary mt-m ml-xl mobile:ml-2xl leading-s">
			{fitted ? <LeftCollapsingCrumbs crumbs={items} /> : <FlatCrumbs crumbs={items} />}
		</div>
	);
}

/**
 * Upstream's `div.project`: `.name`, `.notes`, `.drop-line`, then, when expanded,
 * the node's `.children`. Indentation and guide lines come from the enclosing
 * `.children` container, so the row carries no inline style. `depth` is the
 * visual depth below the zoom root, 1 for its children. Memoized: the cache keeps an unchanged node's object, so a
 * sibling list that changes elsewhere does not re-render this row.
 */
export const OutlineRow = memo(function OutlineRow({
	node,
	depth = 1,
	backlinkCrumbs,
	fitCrumbs = false,
}: {
	node: NodeResponse;
	depth?: number;
	/** A backlink item's source crumbs, rendered before `.name`. */
	backlinkCrumbs?: BacklinkCrumb[];
	/** Collapse the crumbs from the left to fit the row, as Found Dates rows do. */
	fitCrumbs?: boolean;
}) {
	const search = useOutlineSearchFilter();
	const paneId = usePaneId();
	const {
		isPersistentlyExpanded,
		isEditingNote,
		isEditingName,
		editingClickPosition,
		isSlidingUp,
		isMoving,
		isAddedToSelection,
		isHighlighted,
		isSlidingDown,
		dragHover,
		showCompleted,
	} = useRowState(node.id, paneId);
	const isExpanded = search === null ? isPersistentlyExpanded : isSearchExpanded(node.id, search);
	const rowSearchClasses = searchClasses({id: node.id, parentId: node.parent_id}, search);
	const {endCompletionAnimation} = outlineActions();
	const hasChildren = rowHasChildren(node, showCompleted);

	// Upstream mounts `.notes` once the note is non-empty, has had focus, or the name was edited, and never unmounts it.
	const [noteMounted, setNoteMounted] = useState(false);
	const shouldMountNote = Boolean(node.note) || isEditingNote || isEditingName;
	if (shouldMountNote && !noteMounted) {
		setNoteMounted(true);
	}

	// Expanding slides `.children` down; collapsing removes `open` at once but keeps `.children` mounted while it
	// slides up. A row that mounts expanded, or whose expansion a search entering or leaving changed, does not slide.
	const expansion = {expanded: isExpanded, searching: search !== null};
	const [prevExpansion, setPrevExpansion] = useState(expansion);
	const [childrenSlide, setChildrenSlide] = useState<"down" | "up" | null>(null);
	if (expansion.expanded !== prevExpansion.expanded || expansion.searching !== prevExpansion.searching) {
		setPrevExpansion(expansion);
		setChildrenSlide(expansionSlide(prevExpansion, expansion));
	}
	const childrenRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		if (childrenSlide === null) {
			return () => {};
		}
		const done = () => {
			setChildrenSlide(null);
		};
		const el = childrenRef.current;
		if (el === null) {
			// Children not rendered yet (still loading) get no slide.
			const frame = requestAnimationFrame(done);
			return () => {
				cancelAnimationFrame(frame);
			};
		}
		return (childrenSlide === "down" ? slideDown : slideUp)(el, browserSlideDeps(), done);
	}, [childrenSlide]);

	// The slideUp's own transition ending hides the row; a child's transition does not.
	const handleTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
		if (isSlidingUp && event.target === event.currentTarget) {
			endCompletionAnimation([node.id]);
		}
	};

	return (
		<div
			className={withClasses(
				rowProjectClassName(
					node,
					hasChildren,
					isExpanded,
					isEditingNote,
					isSlidingUp,
					isSlidingDown,
					isMoving,
					childrenSlide === "down",
					isAddedToSelection,
					isHighlighted,
					dragHover,
				),
				rowSearchClasses.project,
			)}
			onTransitionEnd={handleTransitionEnd}
		>
			{backlinkCrumbs ? <BacklinkCrumbs crumbs={backlinkCrumbs} fitted={fitCrumbs} /> : null}
			<NodeName
				depth={depth}
				editingClickPosition={editingClickPosition}
				isEditing={isEditingName}
				hasChildren={hasChildren}
				isExpanded={isExpanded}
				node={node}
				searchNameClasses={rowSearchClasses.name}
				searching={search !== null}
				withEmbedder={backlinkCrumbs !== undefined}
			/>
			{noteMounted || shouldMountNote ? (
				<EditableNote
					extraClasses={rowSearchClasses.note}
					initialValue={node.note ?? ""}
					isFocused={isEditingNote}
					nodeId={node.id}
				/>
			) : null}
			<div className="drop-line">
				<div className="line" />
			</div>
			{isExpanded || childrenSlide === "up" ? (
				<OutlineChildren containerRef={childrenRef} depth={depth + 1} owner={node} parentId={node.id} />
			) : null}
		</div>
	);
});
