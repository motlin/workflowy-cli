import {useEffect, useRef} from "react";
import type {ReactNode, PointerEvent as ReactPointerEvent} from "react";
import {nodeRoute} from "../navigation.js";
import {useNavigate} from "react-router-dom";
import {useChildren, useCreateNode, useNode} from "../hooks/use-nodes.js";
import {useOutlineStore} from "../stores/outline.js";
import {FaIcon, TriangleSvg} from "./fa-icons.js";
import {IconButton} from "./icon-button.js";
import {FilesListRows} from "./left-bar-files-list.js";
import {zoomToToday} from "../zoom-to-today.js";

/** Font Awesome style search icon for saved-search rows. */
function SearchIcon() {
	return (
		<svg fill="currentColor" height="14" viewBox="0 0 512 512" width="14">
			<path d="M384 208A176 176 0 1 0 32 208a176 176 0 1 0 352 0zM343.3 366C307 397.2 259.7 416 208 416C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208c0 51.7-18.8 99-50 135.3L507.3 484.7c6.2 6.2 6.2 16.4 0 22.6s-16.4 6.2-22.6 0L343.3 366z" />
		</svg>
	);
}

/**
 * Star icon (filled) for starred locations.
 */
function StarIcon() {
	return (
		<svg fill="currentColor" height="14" viewBox="0 0 576 512" width="14">
			<path d="M316.9 18C311.6 7 300.4 0 288.1 0s-23.4 7-28.8 18L195 150.3 51.4 171.5c-12 1.8-22 10.2-25.7 21.7s-.7 24.2 7.9 32.7L137.8 329 113.2 474.7c-2 12 3 24.2 12.9 31.3s23 8 33.8 2.3l128.3-68.5 128.3 68.5c10.8 5.7 23.9 4.9 33.8-2.3s14.9-19.3 12.9-31.3L438.5 329 542.6 225.9c8.6-8.5 11.7-21.2 7.9-32.7s-13.7-19.9-25.7-21.7L381.2 150.3 316.9 18z" />
		</svg>
	);
}

/**
 * Renders a single starred page item with navigation to that node.
 * Fetches the node name from the API.
 */
function StarredPageItem({nodeId}: {nodeId: string}) {
	const navigate = useNavigate();
	const toggleStarPage = useOutlineStore((state) => state.toggleStarPage);
	const {data: node} = useNode(nodeId);

	const handleClick = () => {
		void navigate(nodeRoute(nodeId));
	};

	const handleRemove = () => {
		toggleStarPage(nodeId);
	};

	const displayName = (node?.name?.replaceAll(/<[^>]*>/gu, "") ?? "") || "Loading...";

	return (
		<li className="left-sidebar-row">
			<button className="left-sidebar-item" onClick={handleClick} type="button">
				<span className="left-sidebar-icon starred-icon">
					<StarIcon />
				</span>
				<span className="left-sidebar-label">{displayName}</span>
			</button>
			<button aria-label="Unstar this page" className="left-sidebar-unstar" onClick={handleRemove} type="button">
				&times;
			</button>
		</li>
	);
}

/**
 * Renders a single saved search item with navigation to search panel.
 */
function SavedSearchItem({query}: {query: string}) {
	const openSearchWithQuery = useOutlineStore((state) => state.openSearchWithQuery);
	const removeSavedSearch = useOutlineStore((state) => state.removeSavedSearch);

	const handleClick = () => {
		openSearchWithQuery(query);
	};

	const handleRemove = () => {
		removeSavedSearch(query);
	};

	return (
		<li className="left-sidebar-row">
			<button className="left-sidebar-item" onClick={handleClick} type="button">
				<span className="left-sidebar-icon">
					<SearchIcon />
				</span>
				<span className="left-sidebar-label">{query}</span>
			</button>
			<button
				aria-label="Remove saved search"
				className="left-sidebar-unstar"
				onClick={handleRemove}
				type="button"
			>
				&times;
			</button>
		</li>
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
	const navigate = useNavigate();
	return (
		<div className="my-xl mx-l desktop:mt-m desktop:mb-2xl">
			{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- verbatim upstream markup: a plain clickable div */}
			<div
				className="relative flex flex-row px-m py-s rounded-m gap-m text-secondary hover:bg-tertiary active:bg-tertiary cursor-pointer"
				onClick={() => void zoomToToday({navigate})}
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
	const {savedSearches, starredPages} = useOutlineStore();
	const starredPagesArray = [...starredPages];

	return (
		<nav className="left-sidebar-nav">
			<TodayRow />

			<LeftBarSection contextKey="leftbar__starred__" name="Starred">
				<ul className="left-sidebar-list">
					{starredPagesArray.length === 0 && savedSearches.length === 0 ? (
						<li className="left-sidebar-empty">No starred items</li>
					) : (
						<>
							{starredPagesArray.map((nodeId) => (
								<StarredPageItem key={nodeId} nodeId={nodeId} />
							))}
							{savedSearches.map((query) => (
								<SavedSearchItem key={query} query={query} />
							))}
						</>
					)}
				</ul>
			</LeftBarSection>

			<LeftBarSection contextKey="leftbar__home__" name={<HomeSectionName />}>
				<FilesListRows contextKey="leftbar__home__" depth={0} parentId={null} />
			</LeftBarSection>
			<NewNodeButton />
		</nav>
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
