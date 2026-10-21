import {useEffect, useRef, useState} from "react";
import {locationKey} from "@workflowy/shared";
import {useNavigate} from "react-router-dom";
import {useChildren, useExpandAll, useHome, useNode} from "../hooks/use-nodes.js";
import {useStarActions, useStars} from "../hooks/use-starred.js";
import {useShowCompletedToggle} from "../hooks/use-show-completed-toggle.js";
import {useOutlineStore} from "../stores/outline.js";
import {Breadcrumbs} from "./breadcrumbs.js";
import {FaIcon} from "./fa-icons.js";
import {typeIcon} from "./item-type-icon.js";
import {GearMenu} from "./gear-menu.js";
import type {GearMenuHeaderItem} from "./gear-menu.js";
import {useMediaQuery} from "../hooks/use-media-query.js";
import {IconButton} from "./icon-button.js";
import {SearchBox} from "./search-box.js";
import {StarButton, StarIcon} from "./star-button.js";
import {currentTypeIcon} from "../layout-types.js";
import {useNavigateToToday} from "../hooks/use-navigate-to-today.js";
import {goToNode, stepNav, useNavStackSync} from "../navigation.js";
import {internalLinkUrl} from "../item-menu-model.js";
import {PANE_HEADER_ACTIVE_BORDER} from "./pane-context.js";

/** Upstream's hamburger hover peek: the drawer closes this long after the pointer leaves the hamburger. */
const PEEK_CLOSE_DELAY_MS = 200;

export interface PeekControllerOptions {
	open: () => void;
	close: () => void;
	/** True while the pointer is over the left bar itself, which keeps the drawer open. */
	isHovered: () => boolean;
}

/**
 * Hamburger hover peek: enter cancels any pending close and opens the drawer; leave closes it
 * 200ms later unless the pointer has moved onto the left bar by then.
 */
export function createPeekController({open, close, isHovered}: PeekControllerOptions) {
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	const cancel = () => {
		clearTimeout(closeTimer);
		closeTimer = undefined;
	};
	return {
		enter: () => {
			cancel();
			open();
		},
		leave: () => {
			cancel();
			closeTimer = setTimeout(() => {
				closeTimer = undefined;
				if (!isHovered()) {
					close();
				}
			}, PEEK_CLOSE_DELAY_MS);
		},
		dispose: cancel,
	};
}

function canHover(): boolean {
	return globalThis.matchMedia("(any-hover: hover) and (pointer: fine)").matches;
}

/** Upstream's custom 30x27 "columns +" New pane icon (ZC4). */
function NewPaneIcon() {
	return (
		<svg
			aria-hidden
			focusable="false"
			width="30"
			height="27"
			viewBox="0 0 33 30"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M7.125 11.875V9.625C7.125 8.39453 8.14453 7.375 9.375 7.375H20.625C21.8555 7.375 22.875 8.39453 22.875 9.625V13H21.75H15.5625V22H20.625C21.2578 22 21.75 21.5078 21.75 20.875H22.875C22.875 22.1055 21.8555 23.125 20.625 23.125H9.375C8.14453 23.125 7.125 22.1055 7.125 20.875V11.875ZM9.375 8.5H20.625C21.2578 8.5 21.75 8.99219 21.75 9.625V11.875H8.25V9.625C8.25 8.99219 8.74219 8.5 9.375 8.5ZM14.4375 13V22H9.375C8.74219 22 8.25 21.5078 8.25 20.875V13H14.4375Z"
				fill="currentColor"
			/>
			<path
				d="M25.5714 13.5714V16.4286H28.4286C28.75 16.4286 29 16.6786 29 17C29 17.3214 28.75 17.5714 28.4286 17.5714H25.5714V20.4286C25.5714 20.75 25.3214 21 25 21C24.6786 21 24.4286 20.75 24.4286 20.4286V17.5714H21.5714C21.25 17.5714 21 17.3214 21 17C21 16.6786 21.25 16.4286 21.5714 16.4286H24.4286V13.5714C24.4286 13.25 24.6786 13 25 13C25.3214 13 25.5714 13.25 25.5714 13.5714Z"
				fill="currentColor"
			/>
		</svg>
	);
}

/**
 * Top toolbar matching upstream's div.wf-header.header: flat children (hamburger,
 * pagination, breadcrumbs, right cluster), 48px tall, fixed at the top.
 */
interface TopBarProps {
	onUndo: () => void;
	onRedo: () => void;
}

export function TopBar({onUndo, onRedo}: TopBarProps) {
	const {
		zoomedNodeId,
		toggleLeftBar,
		showCompleted,
		openSettings,
		openPresentation,
		leftBarOffset,
		leftBarMode,
		showItemTypePicker,
		openLeftBarDrawer,
		closeLeftBarDrawer,
		sidePane,
		openSidePane,
		closeSidePane,
	} = useOutlineStore();
	const [peek] = useState(() =>
		createPeekController({
			open: openLeftBarDrawer,
			close: closeLeftBarDrawer,
			isHovered: () => useOutlineStore.getState().leftBarHovered,
		}),
	);
	useEffect(() => peek.dispose, [peek]);
	const navigate = useNavigate();
	const navigateToToday = useNavigateToToday();
	const toggleCompleted = useShowCompletedToggle();
	useNavStackSync();
	const canGoBack = useOutlineStore((state) => state.nav.back.length > 0);
	const canGoForward = useOutlineStore((state) => state.nav.forward.length > 0);
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	const {stars, unavailable: starsUnavailable} = useStars();
	const {toggleStar} = useStarActions();
	const currentPageKey = zoomedNodeId === null ? null : locationKey({nodeId: zoomedNodeId, query: null});
	const isCurrentPageStarred = stars.some((star) => star.key === currentPageKey);
	const expandAll = useExpandAll();
	const zoomedNode = useNode(zoomedNodeId);
	const home = useHome();
	const layoutIcon = (
		<FaIcon
			icon={typeIcon(
				currentTypeIcon(zoomedNodeId === null ? home.data?.layoutMode : zoomedNode.data?.data.layoutMode),
			)}
		/>
	);
	const rootChildren = useChildren(null);
	const canPresent =
		zoomedNodeId === null ? (rootChildren.data?.length ?? 0) > 0 : zoomedNode.data?.hasChildren === true;
	// Upstream's zv4: under 701px, or while a pane is open, the compactable actions move into the more menu.
	const narrow = !useMediaQuery("(min-width: 701px)");
	const compact = narrow || sidePane !== null;

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

	// Upstream: showItemTypePicker at {top: rect.bottom + 4, left: rect.left}; the picker centers itself there.
	const handleLayoutOpen = (anchor: Element | null) => {
		if (anchor) {
			const rect = anchor.getBoundingClientRect();
			showItemTypePicker({nodeIds: [zoomedNodeId ?? "home"], position: {top: rect.bottom + 4, left: rect.left}});
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
			window.open(internalLinkUrl(zoomedNodeId), "_blank", "noopener");
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
				icon: layoutIcon,
				// The menu item has no element of its own, so anchor under the kebab like upstream.
				onSelect: () => {
					handleLayoutOpen(document.querySelector(".wf-header .gearMenu"));
				},
			},
		);
	}

	return (
		<div
			className={`wf-header header bg-primary border-b border-solid border-primary ${PANE_HEADER_ACTIVE_BORDER}`}
			style={{left: leftBarOffset(), zIndex: 200}}
		>
			{/* Upstream swaps the hamburger for a 16px spacer while the left bar is pinned. */}
			{leftBarMode === "alwaysOpen" ? (
				<div className="w-l" />
			) : (
				<div
					style={{position: "relative"}}
					onMouseEnter={() => {
						// Upstream peeks on pointer devices only; touch taps go through the toggle.
						if (canHover()) {
							peek.enter();
						}
					}}
					onMouseLeave={peek.leave}
				>
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
						<IconButton
							data-handbook="bullet.layout"
							onClick={(event) => {
								handleLayoutOpen(event.currentTarget);
							}}
							tooltip="Change layout"
						>
							{layoutIcon}
						</IconButton>
					</>
				)}

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

				{/* Upstream's header.controls.new-pane: shown until a pane is open, on any zoom including Home. */}
				{/* While a pane is open the main header is a pane header too: its xmark closes the main pane, so the
				    side pane's zoom becomes the main outline's. */}
				{sidePane !== null && (
					<IconButton
						className="text-tertiary hover:text-on-surface flex-shrink-0"
						onClick={() => {
							goToNode(navigate, sidePane.zoomedId);
							closeSidePane();
						}}
						tooltip="Close pane"
					>
						<FaIcon icon="fal:xmark" />
					</IconButton>
				)}
				{sidePane === null && (
					<>
						<div className="self-stretch border-l border-solid border-primary mx-s" />
						<IconButton
							onClick={() => {
								openSidePane(zoomedNodeId);
							}}
							shortcut="⌃R"
							tooltip="New pane"
						>
							<NewPaneIcon />
						</IconButton>
					</>
				)}
			</div>
		</div>
	);
}
