import {useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {useFlattenedTree} from "../hooks/use-flattened-tree.js";
import {useNavigationHistory} from "../hooks/use-navigation-history.js";
import {useChildren, useNode, useUpdateNode} from "../hooks/use-nodes.js";
import {useOutlineStore} from "../stores/outline.js";
import {Breadcrumbs} from "./breadcrumbs.js";
import {FaIcon} from "./fa-icons.js";
import {GearMenu} from "./gear-menu.js";
import {IconButton} from "./icon-button.js";
import {LayoutMenu} from "./layout-menu.js";
import type {LayoutMode} from "./layout-menu.js";
import {Tooltip} from "./tooltip.js";
import {zoomToToday} from "../zoom-to-today.js";

/**
 * Star icon (outline) for unstarred state.
 */
function StarOutlineIcon() {
	return (
		<svg fill="currentColor" height="16" viewBox="0 0 576 512" width="16">
			<path d="M287.9 0c9.2 0 17.6 5.2 21.6 13.5l68.6 141.3 153.2 22.6c9 1.3 16.5 7.6 19.3 16.3s.5 18.1-5.9 24.5L433.6 328.4l26.2 155.6c1.5 9-2.2 18.1-9.7 23.5s-17.3 6-25.3 1.7l-137-73.2L151 509.1c-8.1 4.3-17.9 3.7-25.3-1.7s-11.2-14.5-9.7-23.5l26.2-155.6L31.1 218.2c-6.5-6.4-8.7-15.9-5.9-24.5s10.3-14.9 19.3-16.3l153.2-22.6L266.3 13.5C270.4 5.2 278.7 0 287.9 0zm0 79L235.4 187.2c-3.5 7.1-10.2 12.1-18.1 13.3L99 217.9 184.9 303c5.5 5.5 8.1 13.3 6.8 21L172.7 440.7l108.6-58.3c7-3.8 15.4-3.8 22.4 0L412.3 440.7 393.2 324c-1.3-7.7 1.2-15.5 6.8-21l85.9-85.1-118.3-17.5c-7.8-1.2-14.6-6.1-18.1-13.3L287.9 79z" />
		</svg>
	);
}

/**
 * Star icon (filled) for starred state.
 */
function StarFilledIcon() {
	return (
		<svg fill="currentColor" height="16" viewBox="0 0 576 512" width="16">
			<path d="M316.9 18C311.6 7 300.4 0 288.1 0s-23.4 7-28.8 18L195 150.3 51.4 171.5c-12 1.8-22 10.2-25.7 21.7s-.7 24.2 7.9 32.7L137.8 329 113.2 474.7c-2 12 3 24.2 12.9 31.3s23 8 33.8 2.3l128.3-68.5 128.3 68.5c10.8 5.7 23.9 4.9 33.8-2.3s14.9-19.3 12.9-31.3L438.5 329 542.6 225.9c8.6-8.5 11.7-21.2 7.9-32.7s-13.7-19.9-25.7-21.7L381.2 150.3 316.9 18z" />
		</svg>
	);
}

/**
 * Top toolbar matching upstream's div.wf-header.header: flat children (hamburger,
 * pagination, breadcrumbs, right cluster), 48px tall, fixed at the top.
 */
/** The workflowy.com URL of a node, keyed by the last 12 hex digits of its id. */
export function shareUrl(id: string): string {
	return `https://workflowy.com/#/${id.replaceAll("-", "").slice(-12)}`;
}

export function TopBar() {
	const {
		zoomedNodeId,
		toggleLeftBar,
		toggleSearchPanel,
		toggleCompleted,
		showCompleted,
		openSettings,
		toggleStarPage,
		isPageStarred,
		openPresentation,
		leftBarOffset,
	} = useOutlineStore();
	const navigate = useNavigate();
	const {canGoBack, canGoForward} = useNavigationHistory();
	const [menuOpen, setMenuOpen] = useState(false);
	const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
	const [layoutMenuPosition, setLayoutMenuPosition] = useState({top: 0, right: 0});
	const menuRef = useRef<HTMLDivElement>(null);
	const layoutButtonRef = useRef<HTMLDivElement>(null);
	const updateNodeMutation = useUpdateNode();
	const isCurrentPageStarred = zoomedNodeId !== null && isPageStarred(zoomedNodeId);
	const expandAll = useOutlineStore((state) => state.expandAll);
	const collapseAll = useOutlineStore((state) => state.collapseAll);
	const {flattenedNodes} = useFlattenedTree(zoomedNodeId);
	const zoomedNode = useNode(zoomedNodeId);
	const rootChildren = useChildren(null);
	const canPresent =
		zoomedNodeId === null ? (rootChildren.data?.length ?? 0) > 0 : zoomedNode.data?.hasChildren === true;

	const handleStarToggle = () => {
		if (zoomedNodeId !== null) {
			toggleStarPage(zoomedNodeId);
		}
	};

	const handleNavigateBack = () => void navigate(-1);
	const handleNavigateForward = () => void navigate(1);

	const handleMenuToggle = () => {
		setMenuOpen((prev) => !prev);
	};

	const handleMenuClose = () => {
		setMenuOpen(false);
	};

	const handleSettingsClick = () => {
		setMenuOpen(false);
		openSettings();
	};

	const handlePresentationClick = () => {
		openPresentation(zoomedNodeId ?? "root");
	};

	const handleLayoutToggle = () => {
		if (!layoutMenuOpen && layoutButtonRef.current) {
			const rect = layoutButtonRef.current.getBoundingClientRect();
			setLayoutMenuPosition({
				top: rect.bottom + 4,
				right: window.innerWidth - rect.right,
			});
		}
		setLayoutMenuOpen((prev) => !prev);
	};

	const handleLayoutClose = () => {
		setLayoutMenuOpen(false);
	};

	const handleLayoutSelect = (layout: LayoutMode) => {
		if (zoomedNodeId !== null) {
			updateNodeMutation.mutate({
				nodeId: zoomedNodeId,
				layoutMode: layout,
			});
		}
	};

	const handleExpandAll = () => {
		const nodeIds = flattenedNodes.filter((fn) => fn.hasChildren).map((fn) => fn.node.id);
		expandAll(nodeIds);
	};

	const handleCollapseAll = () => {
		collapseAll();
	};

	return (
		<div
			className="wf-header header bg-primary border-b border-solid border-primary"
			style={{left: leftBarOffset(), zIndex: 200}}
		>
			<div style={{position: "relative"}}>
				<IconButton data-handbook="toggle_leftbar" onClick={toggleLeftBar}>
					<FaIcon icon="fal:bars" />
				</IconButton>
			</div>

			<div className="pagination">
				<IconButton data-handbook="nav.back" disabled={!canGoBack} onClick={handleNavigateBack} tooltip="Back">
					<FaIcon icon="fal:chevron-left" />
				</IconButton>
				{canGoForward && (
					<IconButton
						className="sm:flex hidden"
						data-handbook="nav.forward"
						onClick={handleNavigateForward}
						tooltip="Forward"
					>
						<FaIcon icon="fal:chevron-right" />
					</IconButton>
				)}
			</div>

			<Breadcrumbs nodeId={zoomedNodeId} />

			<div className="ml-auto flex self-stretch items-center gap-xs flex-shrink-0">
				{/* Search icon */}
				<Tooltip content="Search" shortcut="Esc">
					<button
						aria-label="Search"
						className="top-bar-search-box"
						onClick={toggleSearchPanel}
						type="button"
					>
						<svg fill="currentColor" height="16" viewBox="0 0 512 512" width="16">
							<path d="M384 208A176 176 0 1 0 32 208a176 176 0 1 0 352 0zM343.3 366C307 397.2 259.7 416 208 416C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208c0 51.7-18.8 99-50 135.3L507.3 484.7c6.2 6.2 6.2 16.4 0 22.6s-16.4 6.2-22.6 0L343.3 366z" />
						</svg>
						<span className="top-bar-search-placeholder">Search</span>
					</button>
				</Tooltip>

				{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream wraps the Today IconButton in a bare clickable div; the IconButton handles keys */}
				<div onClick={() => void zoomToToday({navigate})}>
					<IconButton shortcut="⌃T" tooltip="Today">
						<FaIcon icon="fal:calendar-day" />
					</IconButton>
				</div>

				{/* Share hands off to workflowy.com's own share dialog until share-dialog lands */}
				{zoomedNodeId !== null && (
					<IconButton
						onClick={() => {
							window.open(shareUrl(zoomedNodeId), "_blank", "noopener");
						}}
						tooltip="Share"
					>
						<FaIcon icon="fal:user-plus" />
					</IconButton>
				)}

				{canPresent && (
					<IconButton
						data-handbook="present_it"
						onClick={handlePresentationClick}
						tooltip="Start presentation"
					>
						<FaIcon icon="fal:play" />
					</IconButton>
				)}

				{/* Star slot: M1-29 replaces this with <StarButton nodeId={zoomedNodeId} handbook="starring.star" size="lg"/> */}
				{zoomedNodeId !== null && (
					<Tooltip content={isCurrentPageStarred ? "Unstar" : "Star"} shortcut="⇧⌘8">
						<button
							aria-label={isCurrentPageStarred ? "Unstar this page" : "Star this page"}
							className={`top-bar-button top-bar-star ${isCurrentPageStarred ? "starred" : ""}`}
							data-handbook="starring.star"
							onClick={handleStarToggle}
							type="button"
						>
							{isCurrentPageStarred ? <StarFilledIcon /> : <StarOutlineIcon />}
						</button>
					</Tooltip>
				)}

				<IconButton
					data-handbook="complete.toggle"
					onClick={toggleCompleted}
					shortcut="⌘O"
					tooltip={showCompleted ? "Hide completed" : "Show completed"}
				>
					<FaIcon icon="fal:check" style={showCompleted ? {color: "var(--wf-text-tint)"} : undefined} />
				</IconButton>

				{/* Change layout */}
				<div className="top-bar-layout-container" ref={layoutButtonRef}>
					<IconButton
						aria-expanded={layoutMenuOpen}
						aria-haspopup="true"
						data-handbook="bullet.layout"
						onClick={handleLayoutToggle}
						tooltip="Change layout"
					>
						<FaIcon icon="fal:list-ul" />
					</IconButton>
					{layoutMenuOpen && (
						<LayoutMenu
							currentLayout={null}
							onClose={handleLayoutClose}
							onSelect={handleLayoutSelect}
							position={layoutMenuPosition}
						/>
					)}
				</div>

				{/* More: upstream's gearMenu wrapper, no tooltip; blue dot omitted (no unread rows locally) */}
				<div
					// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's focusable gearMenu wrapper; markup parity with workflowy.com
					tabIndex={0}
					className="relative outline-none menu gearMenu"
					ref={menuRef}
				>
					<div>
						<IconButton onClick={handleMenuToggle}>
							<FaIcon icon="fal:ellipsis-vertical" size="lg" />
						</IconButton>
					</div>
					<GearMenu
						isOpen={menuOpen}
						onClose={handleMenuClose}
						onCollapseAll={handleCollapseAll}
						onExpandAll={handleExpandAll}
						onOpenSettings={handleSettingsClick}
					/>
				</div>
			</div>
		</div>
	);
}
