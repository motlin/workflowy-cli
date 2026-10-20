import {useEffect, useRef} from "react";
import type {ReactNode, PointerEvent as ReactPointerEvent} from "react";
import {label} from "@workflowy/shared";
import type {Star} from "@workflowy/shared";
import {locationUrl} from "../location.js";
import {useNavigate} from "react-router-dom";
import {useChildren, useCreateNode, useNode} from "../hooks/use-nodes.js";
import {useRecordStarViews, useStarActions, useStarredLocations} from "../hooks/use-starred.js";
import {useOutlineStore} from "../stores/outline.js";
import {FaIcon, TriangleSvg} from "./fa-icons.js";
import {IconButton} from "./icon-button.js";
import {FilesListArrow, FilesListRows, LeftBarRow, RowName, nodeNameHtml} from "./left-bar-files-list.js";
import {useLeftBarExpansionStore} from "../stores/left-bar-expansions.js";
import {rowHasChildren} from "../tree-ops.js";
import {useNavigateToToday} from "../hooks/use-navigate-to-today.js";

const STARRED_CONTEXT = "leftbar__starred__";

/** The current zoom/search location is this star's location. */
function useIsCurrent(star: Star): boolean {
	const zoomedNodeId = useOutlineStore((state) => state.zoomedNodeId);
	const query = useOutlineStore((state) => state.urlSearchQuery);
	return zoomedNodeId === star.nodeId && (query ?? null) === star.query;
}

/** Keep a control click from following the row's link. */
function swallow(event: {preventDefault: () => void; stopPropagation: () => void}): void {
	event.preventDefault();
	event.stopPropagation();
}

/**
 * Upstream's starred-row hover controls: a filled spark star that unstars, then for pages a plus that
 * opens the page and adds an empty first child. Clicks never follow the row's link.
 */
export function StarredRowControls({star}: {star: Star}) {
	const navigate = useNavigate();
	const {toggleStar} = useStarActions();
	const createNode = useCreateNode();
	const startEditing = useOutlineStore((state) => state.startEditing);
	return (
		<>
			<IconButton
				className="!text-spark hover:!bg-quaternary"
				onClick={(event) => {
					swallow(event);
					void toggleStar({nodeId: star.nodeId, query: star.query});
				}}
				shape="square"
				size="sm"
			>
				<FaIcon icon="fas:star" />
			</IconButton>
			{star.query === null ? (
				<IconButton
					className=" hover:!bg-quaternary add-node"
					onClick={(event) => {
						swallow(event);
						void navigate(locationUrl({id: star.nodeId}));
						createNode.mutate(
							{...(star.nodeId === null ? {} : {parent_id: star.nodeId}), name: "", position: 0},
							{
								onSuccess(createdNode) {
									startEditing(createdNode.id);
								},
							},
						);
					}}
					shape="square"
					size="sm"
				>
					<FaIcon icon="fal:plus" />
				</IconButton>
			) : null}
		</>
	);
}

/** A starred page: an expandable FilesList row in the starred context, labelled by its custom name or rich name. */
function StarredPageRow({star}: {star: Star}) {
	const {data: node} = useNode(star.nodeId);
	const current = useIsCurrent(star);
	const expansionKey = star.nodeId ?? "None";
	const expanded =
		useLeftBarExpansionStore((state) => state.expansions[STARRED_CONTEXT])?.includes(expansionKey) ?? false;
	const toggle = useLeftBarExpansionStore((state) => state.toggle);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const customName = star.name !== null && star.name !== "";
	const name =
		customName || star.nodeId === null ? (
			<RowName text={label(star, () => "")} />
		) : (
			<RowName html={nodeNameHtml(node?.name)} />
		);
	return (
		<>
			<LeftBarRow
				arrow={
					<FilesListArrow
						current={current}
						expanded={expanded}
						noChildren={star.nodeId !== null && node !== undefined && !rowHasChildren(node, showCompleted)}
						onToggle={() => {
							toggle(STARRED_CONTEXT, expansionKey);
						}}
					/>
				}
				completed={(node?.completedAt ?? null) !== null}
				controls={<StarredRowControls star={star} />}
				current={current}
				depth={0}
				expanded={expanded}
				href={locationUrl({id: star.nodeId})}
				label={name}
			/>
			{expanded ? <FilesListRows contextKey={STARRED_CONTEXT} depth={1} parentId={star.nodeId} /> : null}
		</>
	);
}

/** A starred search: the magnifier replaces the arrow and the label names the page it searches. */
function StarredSearchRow({star}: {star: Star}) {
	const {data: node} = useNode(star.nodeId);
	const current = useIsCurrent(star);
	return (
		<LeftBarRow
			arrow={
				<div className="flex shrink-0 items-center justify-center" style={{width: 20, height: 20}}>
					<FaIcon icon="fas:magnifying-glass" size="xs" />
				</div>
			}
			completed={false}
			controls={<StarredRowControls star={star} />}
			current={current}
			depth={0}
			expanded={false}
			href={locationUrl({id: star.nodeId, query: star.query})}
			label={
				<span>
					{label(star, () => "")}{" "}
					<span className="font-light text-[.8em] opacity-75">
						in{" "}
						{star.nodeId === null ? <RowName text="Home" /> : <RowName html={nodeNameHtml(node?.name)} />}
					</span>
				</span>
			}
		/>
	);
}

/** Upstream's Starred section: hidden entirely when nothing is starred, rows in the hook's order. */
export function StarredSection() {
	const stars = useStarredLocations();
	if (stars.length === 0) {
		return null;
	}
	return (
		<LeftBarSection contextKey={STARRED_CONTEXT} name="Starred">
			{stars.map((star) => (
				<div className="relative" key={star.key}>
					{star.query === null ? <StarredPageRow star={star} /> : <StarredSearchRow star={star} />}
				</div>
			))}
		</LeftBarSection>
	);
}

const MIN_LEFT_BAR_WIDTH = 160;

/** Width after dragging the resize handle from `startX` to `x`, clamped to upstream's 160px minimum. */
// oxlint-disable-next-line react/only-export-components -- pure helper exported for unit tests; it never changes at runtime
export function resizeWidth(startWidth: number, startX: number, x: number): number {
	return Math.max(MIN_LEFT_BAR_WIDTH, startWidth + x - startX);
}

/** Upstream pads the page body by the pinned left bar width so the outline shifts right; drawers overlay. */
// oxlint-disable-next-line react/only-export-components -- pure helper exported for unit tests; it never changes at runtime
export function applyBodyOffset(style: Pick<CSSStyleDeclaration, "transition" | "paddingLeft">, offset: number): void {
	style.transition = "padding-left .25s";
	style.paddingLeft = `${offset}px`;
}

/** Pinned-mode resize handle: pointer drag on the right edge updates the stored width. */
function ResizeTarget({width, onWidthChange}: {width: number; onWidthChange: (width: number) => void}) {
	const drag = useRef<{startWidth: number; startX: number} | null>(null);
	return (
		<div
			className="resizeTarget absolute top-0 bottom-0 right-0 w-[4px] cursor-ew-resize"
			onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				drag.current = {startWidth: width, startX: event.clientX};
			}}
			onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
				if (drag.current !== null) {
					onWidthChange(resizeWidth(drag.current.startWidth, drag.current.startX, event.clientX));
				}
			}}
			onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
				drag.current = null;
				event.currentTarget.releasePointerCapture(event.pointerId);
			}}
		/>
	);
}

/**
 * Upstream's collapsible left-bar section: a clickable header with a rotating triangle, the children
 * while open, and a spacer. Open state persists per `contextKey` and defaults to open.
 */
export function LeftBarSection({
	name,
	contextKey,
	children,
}: {
	name: ReactNode;
	contextKey: string;
	children?: ReactNode;
}) {
	const expansions = useOutlineStore((state) => state.leftBarSectionExpansions);
	const setExpanded = useOutlineStore((state) => state.setLeftBarSectionExpanded);
	const open = expansions[contextKey] ?? true;
	return (
		<>
			{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- verbatim upstream markup: a plain clickable div header */}
			<div
				className="relative pl-xl flex items-center font-normal text-secondary mb-m hover:cursor-pointer left-bar-section-header group "
				onClick={() => {
					setExpanded(contextKey, !open);
				}}
			>
				<div
					className={`absolute -top-[3px] left-2xs flex items-center justify-center ${open ? "opacity-25" : "opacity-50"} hover:opacity-100 group-hover:opacity-100 sectionArrow ${open ? "expanded" : ""}`}
				>
					<div>
						<TriangleSvg className="block transition-transform duration-200 ease-base [.expanded_&]:rotate-90" />
					</div>
				</div>
				{name}
			</div>
			{open ? children : null}
			<div style={{marginBottom: open ? 24 : 16}} />
		</>
	);
}

/** Upstream's Home section label: a root link that does not toggle the section. */
export function HomeSectionName() {
	const navigate = useNavigate();
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- verbatim upstream markup: a plain clickable span
		<span
			className="hover:underline"
			onClick={(event) => {
				event.stopPropagation();
				void navigate("/");
			}}
		>
			Home
		</span>
	);
}

/** Upstream's Today row: zooms to today's day node. */
export function TodayRow() {
	const navigateToToday = useNavigateToToday();
	return (
		<div className="my-xl mx-l desktop:mt-m desktop:mb-2xl">
			{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- verbatim upstream markup: a plain clickable div */}
			<div
				className="relative flex flex-row px-m py-s rounded-m gap-m text-secondary hover:bg-tertiary active:bg-tertiary cursor-pointer"
				onClick={() => void navigateToToday()}
			>
				<FaIcon className="text-tertiary" icon="fal:calendar-day" />
				<span>Today</span>
			</div>
		</div>
	);
}

/** Upstream's "New node" pill: appends an empty node to the end of the root and edits it. */
export function NewNodeButton() {
	const createNode = useCreateNode();
	const rootChildren = useChildren(null).data ?? [];
	const startEditing = useOutlineStore((state) => state.startEditing);
	return (
		<div className="mt-ml mx-xl">
			<button
				className="w-full cursor-pointer button"
				onClick={() => {
					createNode.mutate(
						{name: "", position: rootChildren.length},
						{
							onSuccess(createdNode) {
								startEditing(createdNode.id);
							},
						},
					);
				}}
				type="button"
			>
				<span className="">
					<FaIcon className="mr-xs opacity-50" icon="fal:plus" /> New node
				</span>
			</button>
		</div>
	);
}

/** Today, Starred and Home sections plus the New node button; replaced section by section by upstream ports. */
function LeftBarSections() {
	useRecordStarViews();

	return (
		<>
			<TodayRow />

			<StarredSection />

			<LeftBarSection contextKey="leftbar__home__" name={<HomeSectionName />}>
				<FilesListRows contextKey="leftbar__home__" depth={0} parentId={null} />
			</LeftBarSection>
			<NewNodeButton />
		</>
	);
}

/**
 * Upstream's always-mounted `.leftBar` shell: an offscreen drawer below the header (drawerClosed),
 * the same drawer slid in with a shadow (drawerOpen), or a full-height pinned column with a
 * resize handle (alwaysOpen). The arrow pin toggles modes; it points left when pinned.
 */
export function LeftBar() {
	const {
		leftBarMode: mode,
		leftBarWidth: width,
		leftBarHovered: hovered,
		toggleLeftBar,
		closeLeftBarDrawer,
		setLeftBarHovered,
		setLeftBarWidth,
	} = useOutlineStore();
	const pinned = mode === "alwaysOpen";
	const drawerOpen = mode === "drawerOpen";
	const closed = mode === "drawerClosed";
	const borderRadius = pinned ? "0 0px 0px 0" : "0 6px 6px 0";

	useEffect(() => {
		applyBodyOffset(document.body.style, pinned ? width : 0);
	}, [pinned, width]);

	return (
		<div
			className="fixed left-0 bottom-0 transition-[top] duration-250 ease-base leftBar"
			onMouseEnter={() => {
				setLeftBarHovered(true);
			}}
			onMouseLeave={() => {
				setLeftBarHovered(false);
				if (drawerOpen) {
					closeLeftBarDrawer();
				}
			}}
			style={{zIndex: 200, top: pinned ? 0 : 49, width: "var(--safe-area-inset-right)"}}
		>
			<div
				className={`wf-left-bar absolute z-[2] box-border ${pinned ? "bg-secondary" : "bg-primary "} text-tertiary`}
				style={{
					top: pinned ? 0 : 12,
					bottom: pinned ? 0 : 12,
					left: pinned || drawerOpen ? 0 : -width,
					width,
					borderRadius,
					overflowX: pinned ? "hidden" : undefined,
					transition: "left 0.25s, bottom 0.25s",
				}}
			>
				<div
					className="absolute top-0 left-0 bottom-0 right-0 transition-[opacity] duration-250 ease-base"
					style={{borderRadius, boxShadow: "var(--wf-box-shadow-m)", opacity: drawerOpen ? 1 : 0}}
				/>
				{pinned ? null : (
					<div className="absolute -top-5 -left-px -right-px h-[19px] leftBarTopHiddenHoverTarget" />
				)}
				<div
					className="absolute top-0 left-0 right-0 bottom-0 mr-1 pt-3xl pb-m overflow-x-hidden scroller vertical-scrollable-container"
					style={{
						paddingLeft: "var(--safe-area-inset-left)",
						overflowY: closed && !hovered ? "hidden" : "auto",
						scrollbarGutter: "stable",
					}}
				>
					<LeftBarSections />
				</div>
				{pinned ? (
					<>
						<div className="absolute top-0 bottom-0 -right-px w-px shadow-[0_2px_10px_rgba(0,0,0,0.5)]" />
						<ResizeTarget onWidthChange={setLeftBarWidth} width={width} />
					</>
				) : null}
				<IconButton
					className="absolute top-m right-m transition-[transform] duration-250 ease-base"
					onClick={toggleLeftBar}
					style={{transform: `rotate(${pinned ? 0 : 135}deg)`}}
				>
					<FaIcon icon="fal:arrow-left" />
				</IconButton>
			</div>
		</div>
	);
}
