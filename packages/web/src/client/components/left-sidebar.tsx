import {useEffect, useRef, useState} from "react";
import type {ReactNode, PointerEvent as ReactPointerEvent} from "react";
import {nodeRoute} from "../navigation.js";
import {useNavigate} from "react-router-dom";
import {useChildren, useCreateNode, useNode} from "../hooks/use-nodes.js";
import {useOutlineStore} from "../stores/outline.js";
import {FaIcon, TriangleSvg} from "./fa-icons.js";
import {IconButton} from "./icon-button.js";

/**
 * SVG icon components matching Font Awesome style.
 */
function CalendarDayIcon() {
	return (
		<svg fill="currentColor" height="16" viewBox="0 0 448 512" width="16">
			<path d="M128 0c17.7 0 32 14.3 32 32l0 32 128 0 0-32c0-17.7 14.3-32 32-32s32 14.3 32 32l0 32 48 0c26.5 0 48 21.5 48 48l0 48L0 160l0-48C0 85.5 21.5 64 48 64l48 0 0-32c0-17.7 14.3-32 32-32zM0 192l448 0 0 272c0 26.5-21.5 48-48 48L48 512c-26.5 0-48-21.5-48-48L0 192zm80 64c-8.8 0-16 7.2-16 16l0 96c0 8.8 7.2 16 16 16l96 0c8.8 0 16-7.2 16-16l0-96c0-8.8-7.2-16-16-16l-96 0z" />
		</svg>
	);
}

function SearchIcon() {
	return (
		<svg fill="currentColor" height="14" viewBox="0 0 512 512" width="14">
			<path d="M384 208A176 176 0 1 0 32 208a176 176 0 1 0 352 0zM343.3 366C307 397.2 259.7 416 208 416C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208c0 51.7-18.8 99-50 135.3L507.3 484.7c6.2 6.2 6.2 16.4 0 22.6s-16.4 6.2-22.6 0L343.3 366z" />
		</svg>
	);
}

function ExpandToggleIcon({expanded}: {expanded: boolean}) {
	return (
		<svg
			className={`tree-toggle-icon ${expanded ? "expanded" : ""}`}
			fill="currentColor"
			height="10"
			viewBox="0 0 320 512"
			width="10"
		>
			<path d="M299.3 244.7c6.2 6.2 6.2 16.4 0 22.6l-192 192c-6.2 6.2-16.4 6.2-22.6 0s-6.2-16.4 0-22.6L265.4 256 84.7 75.3c-6.2-6.2-6.2-16.4 0-22.6s16.4-6.2 22.6 0l192 192z" />
		</svg>
	);
}

function PlusIcon() {
	return (
		<svg fill="currentColor" height="14" viewBox="0 0 448 512" width="14">
			<path d="M240 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 144L32 208c-17.7 0-32 14.3-32 32s14.3 32 32 32l144 0 0 144c0 17.7 14.3 32 32 32s32-14.3 32-32l0-144 144 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-144 0 0-144z" />
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

/**
 * Renders a collapsible tree item for root nodes.
 */
function HomeTreeItem({nodeId, name, hasChildren}: {nodeId: string; name: string; hasChildren: boolean}) {
	const [isExpanded, setIsExpanded] = useState(false);
	const navigate = useNavigate();
	const {data: children} = useChildren(isExpanded ? nodeId : null);

	const handleClick = () => {
		void navigate(nodeRoute(nodeId));
	};

	const handleToggle = () => {
		setIsExpanded(!isExpanded);
	};

	const displayName = name.replaceAll(/<[^>]*>/gu, "") || "Untitled";

	return (
		<li className="home-tree-item">
			<div className="left-sidebar-row home-tree-row">
				{hasChildren ? (
					<button
						aria-expanded={isExpanded}
						aria-label={isExpanded ? `Collapse ${displayName}` : `Expand ${displayName}`}
						className="home-tree-toggle"
						onClick={handleToggle}
						type="button"
					>
						<ExpandToggleIcon expanded={isExpanded} />
					</button>
				) : (
					<span className="home-tree-toggle-placeholder" />
				)}
				<button className="left-sidebar-item" onClick={handleClick} type="button">
					<span className="left-sidebar-label">{displayName}</span>
				</button>
			</div>
			{isExpanded && children && children.length > 0 && (
				<ul className="home-tree-children">
					{children.map((child) => (
						<HomeTreeItem hasChildren={true} key={child.id} name={child.name ?? ""} nodeId={child.id} />
					))}
				</ul>
			)}
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
export function LeftBarSection({name, contextKey, children}: {name: string; contextKey: string; children?: ReactNode}) {
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

/** Today, Starred and Home sections plus the New node footer; replaced section by section by upstream ports. */
function LeftBarSections() {
	const {savedSearches, starredPages, zoomedNodeId} = useOutlineStore();
	const navigate = useNavigate();
	const createNode = useCreateNode();
	const {data: rootNodes} = useChildren(null);
	const starredPagesArray = [...starredPages];

	const handleTodayClick = () => {
		void navigate("/");
	};

	const handleNewNode = () => {
		createNode.mutate({
			parent_id: zoomedNodeId ?? undefined,
			name: "",
		});
	};

	return (
		<>
			<nav className="left-sidebar-nav">
				{/* Today Section */}
				<section className="left-sidebar-section">
					<ul className="left-sidebar-list">
						<li>
							<button
								className="left-sidebar-item left-sidebar-today"
								onClick={handleTodayClick}
								type="button"
							>
								<span className="left-sidebar-icon">
									<CalendarDayIcon />
								</span>
								<span className="left-sidebar-label">Today</span>
							</button>
						</li>
					</ul>
				</section>

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

				<LeftBarSection contextKey="leftbar__home__" name="Home">
					<ul className="left-sidebar-list home-tree">
						{rootNodes?.map((node) => (
							<HomeTreeItem hasChildren={true} key={node.id} name={node.name ?? ""} nodeId={node.id} />
						))}
					</ul>
				</LeftBarSection>
			</nav>

			<div className="left-sidebar-footer">
				<button className="left-sidebar-new-node" onClick={handleNewNode} type="button">
					<span className="left-sidebar-new-node-icon">
						<PlusIcon />
					</span>
					<span>New node</span>
				</button>
			</div>
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
