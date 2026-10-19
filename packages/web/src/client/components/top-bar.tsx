import {useRef, useState} from "react";
import {locationKey} from "@workflowy/shared";
import {useNavigate} from "react-router-dom";
import {useChildren, useExpandAll, useNode, useUpdateNode} from "../hooks/use-nodes.js";
import {useStarActions, useStars} from "../hooks/use-starred.js";
import {useShowCompletedToggle} from "../hooks/use-show-completed-toggle.js";
import {useOutlineStore} from "../stores/outline.js";
import {Breadcrumbs} from "./breadcrumbs.js";
import {FaIcon} from "./fa-icons.js";
import {GearMenu} from "./gear-menu.js";
import type {GearMenuHeaderItem} from "./gear-menu.js";
import {useMediaQuery} from "../hooks/use-media-query.js";
import {IconButton} from "./icon-button.js";
import {LayoutMenu} from "./layout-menu.js";
import {SearchBox} from "./search-box.js";
import {StarButton, StarIcon} from "./star-button.js";
import type {LayoutMode} from "./layout-menu.js";
import {useNavigateToToday} from "../hooks/use-navigate-to-today.js";
import {stepNav, useNavStackSync} from "../navigation.js";

/**
 * Top toolbar matching upstream's div.wf-header.header: flat children (hamburger,
 * pagination, breadcrumbs, right cluster), 48px tall, fixed at the top.
 */
/** The workflowy.com URL of a node, keyed by the last 12 hex digits of its id. */
export function shareUrl(id: string): string {
	return `https://workflowy.com/#/${id.replaceAll("-", "").slice(-12)}`;
}

interface TopBarProps {
	onUndo: () => void;
	onRedo: () => void;
}

export function TopBar({onUndo, onRedo}: TopBarProps) {
	const {zoomedNodeId, toggleLeftBar, showCompleted, openSettings, openPresentation, leftBarOffset, leftBarMode} =
		useOutlineStore();
	const navigate = useNavigate();
	const navigateToToday = useNavigateToToday();
	const toggleCompleted = useShowCompletedToggle();
	useNavStackSync();
	const canGoBack = useOutlineStore((state) => state.nav.back.length > 0);
	const canGoForward = useOutlineStore((state) => state.nav.forward.length > 0);
	const [menuOpen, setMenuOpen] = useState(false);
	const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
	const [layoutMenuPosition, setLayoutMenuPosition] = useState({top: 0, right: 0});
	const menuRef = useRef<HTMLDivElement>(null);
	const layoutButtonRef = useRef<HTMLDivElement>(null);
	const updateNodeMutation = useUpdateNode();
	const {stars, unavailable: starsUnavailable} = useStars();
	const {toggleStar} = useStarActions();
	const currentPageKey = zoomedNodeId === null ? null : locationKey({nodeId: zoomedNodeId, query: null});
	const isCurrentPageStarred = stars.some((star) => star.key === currentPageKey);
	const expandAll = useExpandAll();
	const zoomedNode = useNode(zoomedNodeId);
	const rootChildren = useChildren(null);
	const canPresent =
		zoomedNodeId === null ? (rootChildren.data?.length ?? 0) > 0 : zoomedNode.data?.hasChildren === true;
	// Upstream's zv4: under 701px the compactable actions move into the more menu.
	const compact = !useMediaQuery("(min-width: 701px)");

	const handleNavigateBack = () => {
		stepNav(navigate, "back");
	};
	const handleNavigateForward = () => {
		stepNav(navigate, "forward");
	};

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

	const handleLayoutToggle = (anchor: Element | null) => {
		if (!layoutMenuOpen && anchor) {
			const rect = anchor.getBoundingClientRect();
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

	// Upstream: the kebab's Expand/Collapse all act on the zoomed item's whole subtree (every top-level item at Home).
	const handleExpandAll = () => {
		expandAll(zoomedNodeId, true);
	};

	const handleCollapseAll = () => {
		expandAll(zoomedNodeId, false);
	};

	const handleShare = () => {
		if (zoomedNodeId !== null) {
			window.open(shareUrl(zoomedNodeId), "_blank", "noopener");
		}
	};

	const headerItems: GearMenuHeaderItem[] = [];
	if (compact) {
		if (zoomedNodeId !== null) {
			headerItems.push({label: "Share", icon: <FaIcon icon="fal:user-plus" />, onSelect: handleShare});
		}
		headerItems.push({
			label: "Present",
			icon: <FaIcon icon="fal:play" />,
			onSelect: handlePresentationClick,
			disabled: !canPresent,
		});
		if (zoomedNodeId !== null) {
			headerItems.push({
				label: isCurrentPageStarred ? "Unstar" : "Star",
				icon: <StarIcon starred={isCurrentPageStarred} />,
				onSelect: () => {
					if (!starsUnavailable) {
						void toggleStar({nodeId: zoomedNodeId, query: null});
					}
				},
			});
		}
		headerItems.push(
			{
				label: showCompleted ? "Hide completed" : "Show completed",
				icon: <FaIcon icon="fal:check" />,
				onSelect: toggleCompleted,
			},
			{
				label: "Change layout",
				icon: <FaIcon icon="fal:list-ul" />,
				// The menu item has no element of its own, so anchor under the kebab like upstream.
				onSelect: () => {
					handleLayoutToggle(document.querySelector(".wf-header .gearMenu"));
				},
			},
		);
	}

	const layoutMenu = layoutMenuOpen && (
		<LayoutMenu
			currentLayout={null}
			onClose={handleLayoutClose}
			onSelect={handleLayoutSelect}
			position={layoutMenuPosition}
		/>
	);

	return (
		<div
			className="wf-header header bg-primary border-b border-solid border-primary"
			style={{left: leftBarOffset(), zIndex: 200}}
		>
			{/* Upstream swaps the hamburger for a 16px spacer while the left bar is pinned. */}
			{leftBarMode === "alwaysOpen" ? (
				<div className="w-l" />
			) : (
				<div style={{position: "relative"}}>
					<IconButton data-handbook="toggle_leftbar" onClick={toggleLeftBar}>
						<FaIcon icon="fal:bars" />
					</IconButton>
				</div>
			)}

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
				<SearchBox />

				{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream wraps the Today IconButton in a bare clickable div; the IconButton handles keys */}
				<div onClick={() => void navigateToToday()}>
					<IconButton shortcut="⌃T" tooltip="Today">
						<FaIcon icon="fal:calendar-day" />
					</IconButton>
				</div>

				{!compact && (
					<>
						{/* Share hands off to workflowy.com's own share dialog until share-dialog lands */}
						{zoomedNodeId !== null && (
							<IconButton onClick={handleShare} tooltip="Share">
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

						{zoomedNodeId !== null && (
							<StarButton nodeId={zoomedNodeId} handbook="starring.star" size="lg" />
						)}

						<IconButton
							data-handbook="complete.toggle"
							onClick={toggleCompleted}
							shortcut="⌘O"
							tooltip={showCompleted ? "Hide completed" : "Show completed"}
						>
							<FaIcon
								icon="fal:check"
								style={showCompleted ? {color: "var(--wf-text-tint)"} : undefined}
							/>
						</IconButton>

						{/* Change layout */}
						<div className="relative" ref={layoutButtonRef}>
							<IconButton
								aria-expanded={layoutMenuOpen}
								aria-haspopup="true"
								data-handbook="bullet.layout"
								onClick={() => {
									handleLayoutToggle(layoutButtonRef.current);
								}}
								tooltip="Change layout"
							>
								<FaIcon icon="fal:list-ul" />
							</IconButton>
							{layoutMenu}
						</div>
					</>
				)}
				{compact && layoutMenu}

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
						headerItems={headerItems}
						isOpen={menuOpen}
						onClose={handleMenuClose}
						onCollapseAll={handleCollapseAll}
						onExpandAll={handleExpandAll}
						onOpenSettings={handleSettingsClick}
						onRedo={onRedo}
						onUndo={onUndo}
					/>
				</div>
			</div>
		</div>
	);
}
