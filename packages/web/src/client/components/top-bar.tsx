import {useEffect, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useShallow} from "zustand/react/shallow";
import {useStableNavigate} from "../hooks/use-stable-navigate.js";
import {useOutlineStore} from "../stores/outline.js";
import {Breadcrumbs} from "./breadcrumbs.js";
import {FaIcon} from "./fa-icons.js";
import {useHeaderActions} from "./header-actions.js";
import {HeaderMoreMenu} from "./header-more-menu.js";
import {useMediaQuery} from "../hooks/use-media-query.js";
import {IconButton} from "./icon-button.js";
import {NewPaneIcon} from "./new-pane-icon.js";
import {SearchBox} from "./search-box.js";
import {StarButton} from "./star-button.js";
import {useNavigateToToday} from "../hooks/use-navigate-to-today.js";
import {goToNode, stepNav, useNavStackSync} from "../navigation.js";
import {cachedResolvedId} from "../node-cache.js";
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
		leftBarOffset,
		leftBarMode,
		openLeftBarDrawer,
		closeLeftBarDrawer,
		sidePane,
		openSidePane,
		closeSidePane,
	} = useOutlineStore(
		useShallow((state) => ({
			zoomedNodeId: state.zoomedNodeId,
			toggleLeftBar: state.toggleLeftBar,
			leftBarOffset: state.leftBarOffset(),
			leftBarMode: state.leftBarMode,
			openLeftBarDrawer: state.openLeftBarDrawer,
			closeLeftBarDrawer: state.closeLeftBarDrawer,
			sidePane: state.sidePane,
			openSidePane: state.openSidePane,
			closeSidePane: state.closeSidePane,
		})),
	);
	const [peek] = useState(() =>
		createPeekController({
			open: openLeftBarDrawer,
			close: closeLeftBarDrawer,
			isHovered: () => useOutlineStore.getState().leftBarHovered,
		}),
	);
	useEffect(() => peek.dispose, [peek]);
	const navigate = useStableNavigate();
	const queryClient = useQueryClient();
	const navigateToToday = useNavigateToToday();
	useNavStackSync();
	const canGoBack = useOutlineStore((state) => state.nav.back.length > 0);
	const canGoForward = useOutlineStore((state) => state.nav.forward.length > 0);
	const actions = useHeaderActions(zoomedNodeId);
	// Upstream's zv4: under 701px, or while a pane is open, the compactable actions move into the more menu.
	const narrow = !useMediaQuery("(min-width: 701px)");
	const compact = narrow || sidePane !== null;

	const resolveCached = (locationId: string) => cachedResolvedId(queryClient, locationId);
	const handleNavigateBack = () => {
		stepNav(navigate, "back", resolveCached);
	};
	const handleNavigateForward = () => {
		stepNav(navigate, "forward", resolveCached);
	};

	return (
		<div
			className={`wf-header header bg-primary border-b border-solid border-primary ${PANE_HEADER_ACTIVE_BORDER}`}
			style={{left: leftBarOffset, zIndex: 200}}
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
							<IconButton onClick={actions.share} tooltip="Share">
								<FaIcon icon="fal:user-plus" />
							</IconButton>
						)}

						{actions.canPresent && (
							<IconButton
								data-handbook="present_it"
								onClick={actions.present}
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
							onClick={actions.toggleCompleted}
							shortcut="⌘O"
							tooltip={actions.showCompleted ? "Hide completed" : "Show completed"}
						>
							<FaIcon
								icon="fal:check"
								style={actions.showCompleted ? {color: "var(--wf-text-tint)"} : undefined}
							/>
						</IconButton>

						{/* Change layout */}
						<IconButton
							data-handbook="bullet.layout"
							onClick={(event) => {
								actions.openLayoutPicker(event.currentTarget);
							}}
							tooltip="Change layout"
						>
							{actions.layoutIcon}
						</IconButton>
					</>
				)}

				<HeaderMoreMenu
					anchorSelector=".wf-header .gearMenu"
					compact={compact}
					onRedo={onRedo}
					onUndo={onUndo}
					zoomedId={zoomedNodeId}
				/>

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
