// fallow-ignore-file circular-dependency
// Mutual recursion between OutlineRow and OutlineChildren is intentional.
import type {ReactNode} from "react";
import {useEffect, useRef, useState} from "react";
import {useChildren, useCreateNode, useNode, useToggleComplete} from "../hooks/use-nodes.js";
import {initialMaxToRender, nextMaxToRender} from "../render-window.js";
import {useOutlineStore} from "../stores/outline.js";
import {isPotentiallyVisible, planAddChild} from "../tree-ops.js";
import {FaIcon} from "./fa-icons.js";
import {IconButton} from "./icon-button.js";
import {EditableText} from "./editable-text.js";
import {NodeItemMenu, OutlineRow} from "./outline-node.js";
import {projectClassName} from "./row-classes.js";
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
				position: plan.index,
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
 * like any row (`editingId === nodeId`), in a `.name--main` row, then the root `.children`. At the main-tree root (no zoom) it is
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
	const isMainTreeRoot = nodeId === null;
	const isEditing = !isMainTreeRoot && editingId === nodeId;
	const nameHtml = isMainTreeRoot ? "" : (node?.name ?? "");

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
					hasNote: false,
					noteFocused: false,
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
 * Upstream's `div.children`: the visible children of `parentId`, each a recursive
 * `OutlineRow`. Renders nothing when no child is visible, so a collapsed or empty
 * parent has no `.children` in the DOM.
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
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const animatingCompletionIds = useOutlineStore((state) => state.animatingCompletionIds);
	const visibleNodes = nodes?.filter((node) => isPotentiallyVisible(node, showCompleted, animatingCompletionIds));
	const [maxToRender, setMaxToRender] = useState(initialMaxToRender);
	const total = visibleNodes?.length ?? 0;
	const growWindow = () => {
		setMaxToRender((current) => nextMaxToRender(current, total));
	};

	if (!visibleNodes || total === 0) {
		return null;
	}

	return (
		<div className={isRoot ? ROOT_CHILDREN_CLASS : NESTED_CHILDREN_CLASS}>
			{visibleNodes.slice(0, maxToRender).map((node) => (
				<OutlineRow key={node.id} depth={depth} node={node} />
			))}
			{total > maxToRender && <RenderSentinel onReached={growWindow} />}
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
