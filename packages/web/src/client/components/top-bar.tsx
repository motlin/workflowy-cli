import {useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useFlattenedTree} from '../hooks/use-flattened-tree.js';
import {useNavigationHistory} from '../hooks/use-navigation-history.js';
import {useUpdateNode} from '../hooks/use-nodes.js';
import {useOutlineStore} from '../stores/outline.js';
import {Breadcrumbs} from './breadcrumbs.js';
import {CalendarPanel} from './calendar-panel.js';
import {GearMenu} from './gear-menu.js';
import {HideCompletedToggle} from './hide-completed-toggle.js';
import {LayoutMenu, type LayoutMode} from './layout-menu.js';
import {Tooltip} from './tooltip.js';

/**
 * Star icon (outline) for unstarred state.
 */
function StarOutlineIcon() {
	return (
		<svg
			fill="currentColor"
			height="16"
			viewBox="0 0 576 512"
			width="16"
		>
			<path d="M287.9 0c9.2 0 17.6 5.2 21.6 13.5l68.6 141.3 153.2 22.6c9 1.3 16.5 7.6 19.3 16.3s.5 18.1-5.9 24.5L433.6 328.4l26.2 155.6c1.5 9-2.2 18.1-9.7 23.5s-17.3 6-25.3 1.7l-137-73.2L151 509.1c-8.1 4.3-17.9 3.7-25.3-1.7s-11.2-14.5-9.7-23.5l26.2-155.6L31.1 218.2c-6.5-6.4-8.7-15.9-5.9-24.5s10.3-14.9 19.3-16.3l153.2-22.6L266.3 13.5C270.4 5.2 278.7 0 287.9 0zm0 79L235.4 187.2c-3.5 7.1-10.2 12.1-18.1 13.3L99 217.9 184.9 303c5.5 5.5 8.1 13.3 6.8 21L172.7 440.7l108.6-58.3c7-3.8 15.4-3.8 22.4 0L412.3 440.7 393.2 324c-1.3-7.7 1.2-15.5 6.8-21l85.9-85.1-118.3-17.5c-7.8-1.2-14.6-6.1-18.1-13.3L287.9 79z" />
		</svg>
	);
}

/**
 * Star icon (filled) for starred state.
 */
function StarFilledIcon() {
	return (
		<svg
			fill="currentColor"
			height="16"
			viewBox="0 0 576 512"
			width="16"
		>
			<path d="M316.9 18C311.6 7 300.4 0 288.1 0s-23.4 7-28.8 18L195 150.3 51.4 171.5c-12 1.8-22 10.2-25.7 21.7s-.7 24.2 7.9 32.7L137.8 329 113.2 474.7c-2 12 3 24.2 12.9 31.3s23 8 33.8 2.3l128.3-68.5 128.3 68.5c10.8 5.7 23.9 4.9 33.8-2.3s14.9-19.3 12.9-31.3L438.5 329 542.6 225.9c8.6-8.5 11.7-21.2 7.9-32.7s-13.7-19.9-25.7-21.7L381.2 150.3 316.9 18z" />
		</svg>
	);
}

/**
 * Top toolbar component matching Workflowy's header design.
 * Contains navigation controls and action buttons.
 * Height: 48px, fixed position at top.
 */
export function TopBar() {
	const {
		zoomedNodeId,
		toggleLeftSidebar,
		toggleSearchPanel,
		openSearchWithQuery,
		toggleCompleted,
		showCompleted,
		openSettings,
		toggleStarPage,
		isPageStarred,
		openPresentation,
	} = useOutlineStore();
	const navigate = useNavigate();
	const {canGoForward} = useNavigationHistory();
	const [menuOpen, setMenuOpen] = useState(false);
	const [calendarOpen, setCalendarOpen] = useState(false);
	const [completedToggleOpen, setCompletedToggleOpen] = useState(false);
	const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
	const [layoutMenuPosition, setLayoutMenuPosition] = useState({top: 0, right: 0});
	const menuRef = useRef<HTMLDivElement>(null);
	const calendarButtonRef = useRef<HTMLButtonElement>(null);
	const completedButtonRef = useRef<HTMLButtonElement>(null);
	const layoutButtonRef = useRef<HTMLButtonElement>(null);
	const updateNodeMutation = useUpdateNode();
	const isCurrentPageStarred = zoomedNodeId !== null && isPageStarred(zoomedNodeId);
	const expandAll = useOutlineStore((state) => state.expandAll);
	const collapseAll = useOutlineStore((state) => state.collapseAll);
	const {flattenedNodes} = useFlattenedTree(zoomedNodeId);

	const handleStarToggle = () => {
		if (zoomedNodeId !== null) {
			toggleStarPage(zoomedNodeId);
		}
	};

	const handleNavigateBack = () => void navigate(-1);
	const handleNavigateForward = () => {
		if (canGoForward) {
			void navigate(1);
		}
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
		openPresentation(zoomedNodeId ?? 'root');
	};

	const handleCalendarToggle = () => {
		setCalendarOpen((prev) => !prev);
	};

	const handleCalendarClose = () => {
		setCalendarOpen(false);
	};

	const handleCompletedToggleOpen = () => {
		setCompletedToggleOpen(true);
	};

	const handleCompletedToggleClose = () => {
		setCompletedToggleOpen(false);
	};

	const handleDateSelect = (date: Date) => {
		// Format date as YYYY-MM-DD
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const dateString = `${year}-${month}-${day}`;

		// Open search with date query
		toggleSearchPanel();
		openSearchWithQuery(`date:${dateString}`);
		setCalendarOpen(false);
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
		<header className="top-bar">
			<div className="top-bar-left">
				<Tooltip
					content="Toggle sidebar"
					shortcut="^L"
				>
					<button
						aria-label="Toggle sidebar"
						className="top-bar-button"
						onClick={toggleLeftSidebar}
						type="button"
					>
						<svg
							fill="currentColor"
							height="16"
							viewBox="0 0 448 512"
							width="16"
						>
							<path d="M0 80c0-8.8 7.2-16 16-16l416 0c8.8 0 16 7.2 16 16s-7.2 16-16 16L16 96C7.2 96 0 88.8 0 80zM0 256c0-8.8 7.2-16 16-16l416 0c8.8 0 16 7.2 16 16s-7.2 16-16 16L16 272c-8.8 0-16-7.2-16-16zM432 432c0 8.8-7.2 16-16 16L16 448c-8.8 0-16-7.2-16-16s7.2-16 16-16l400 0c8.8 0 16 7.2 16 16z" />
						</svg>
					</button>
				</Tooltip>

				<div className="top-bar-nav-buttons">
					<Tooltip
						content="History back"
						shortcut="⌘["
					>
						<button
							aria-label="Go back"
							className="top-bar-button"
							onClick={handleNavigateBack}
							type="button"
						>
							<svg
								fill="currentColor"
								height="16"
								viewBox="0 0 320 512"
								width="16"
							>
								<path d="M20.7 267.3c-6.2-6.2-6.2-16.4 0-22.6l192-192c6.2-6.2 16.4-6.2 22.6 0s6.2 16.4 0 22.6L54.6 256 235.3 436.7c6.2 6.2 6.2 16.4 0 22.6s-16.4 6.2-22.6 0l-192-192z" />
							</svg>
						</button>
					</Tooltip>

					<Tooltip
						content="History forward"
						shortcut="⌘]"
					>
						<button
							aria-disabled={!canGoForward}
							aria-label="Go forward"
							className={`top-bar-button${canGoForward ? '' : ' disabled'}`}
							onClick={handleNavigateForward}
							type="button"
						>
							<svg
								fill="currentColor"
								height="16"
								viewBox="0 0 320 512"
								width="16"
							>
								<path d="M299.3 244.7c6.2 6.2 6.2 16.4 0 22.6l-192 192c-6.2 6.2-16.4 6.2-22.6 0s-6.2-16.4 0-22.6L265.4 256 84.7 75.3c-6.2-6.2-6.2-16.4 0-22.6s16.4-6.2 22.6 0l192 192z" />
							</svg>
						</button>
					</Tooltip>
				</div>

				<Breadcrumbs nodeId={zoomedNodeId} />

				{/* Star button - only shown when zoomed into a node */}
				{zoomedNodeId !== null && (
					<Tooltip
						content={isCurrentPageStarred ? 'Unstar' : 'Star'}
						shortcut="⇧⌘8"
					>
						<button
							aria-label={isCurrentPageStarred ? 'Unstar this page' : 'Star this page'}
							className={`top-bar-button top-bar-star ${isCurrentPageStarred ? 'starred' : ''}`}
							onClick={handleStarToggle}
							type="button"
						>
							{isCurrentPageStarred ? <StarFilledIcon /> : <StarOutlineIcon />}
						</button>
					</Tooltip>
				)}
			</div>

			<div className="top-bar-right">
				{/* Search icon */}
				<Tooltip
					content="Search"
					shortcut="Esc"
				>
					<button
						aria-label="Search"
						className="top-bar-search-box"
						onClick={toggleSearchPanel}
						type="button"
					>
						<svg
							fill="currentColor"
							height="16"
							viewBox="0 0 512 512"
							width="16"
						>
							<path d="M384 208A176 176 0 1 0 32 208a176 176 0 1 0 352 0zM343.3 366C307 397.2 259.7 416 208 416C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208c0 51.7-18.8 99-50 135.3L507.3 484.7c6.2 6.2 6.2 16.4 0 22.6s-16.4 6.2-22.6 0L343.3 366z" />
						</svg>
						<span className="top-bar-search-placeholder">Search</span>
					</button>
				</Tooltip>

				{/* Play/Present icon */}
				<Tooltip content="Present">
					<button
						aria-label="Present"
						className="top-bar-button"
						data-handbook="present.it"
						onClick={handlePresentationClick}
						type="button"
					>
						<svg
							fill="currentColor"
							height="16"
							viewBox="0 0 384 512"
							width="16"
						>
							<path d="M56.3 66.3c-4.9-3-11.1-3.1-16.2-.3s-8.2 8.2-8.2 14l0 352c0 5.8 3.1 11.1 8.2 14s11.2 2.7 16.2-.3l288-176c4.8-2.9 7.7-8.1 7.7-13.7s-2.9-10.7-7.7-13.7l-288-176zM24.5 38.1C39.7 29.6 58.2 30 73 39L361 215c14.3 8.7 23 24.2 23 41s-8.7 32.2-23 41L73 473c-14.8 9.1-33.4 9.4-48.5 .9S0 449.4 0 432L0 80C0 62.6 9.4 46.6 24.5 38.1z" />
						</svg>
					</button>
				</Tooltip>

				{/* Calendar icon */}
				<div className="top-bar-calendar-container">
					<Tooltip content="Calendar">
						<button
							aria-expanded={calendarOpen}
							aria-haspopup="true"
							aria-label="Calendar"
							className={`top-bar-button ${calendarOpen ? 'active' : ''}`}
							onClick={handleCalendarToggle}
							ref={calendarButtonRef}
							type="button"
						>
							<svg
								fill="currentColor"
								height="16"
								viewBox="0 0 448 512"
								width="16"
							>
								<path d="M128 16c0-8.8-7.2-16-16-16s-16 7.2-16 16l0 48L64 64C28.7 64 0 92.7 0 128l0 32 0 32L0 448c0 35.3 28.7 64 64 64l320 0c35.3 0 64-28.7 64-64l0-256 0-32 0-32c0-35.3-28.7-64-64-64l-32 0 0-48c0-8.8-7.2-16-16-16s-16 7.2-16 16l0 48L128 64l0-48zM32 192l384 0 0 256c0 17.7-14.3 32-32 32L64 480c-17.7 0-32-14.3-32-32l0-256zM64 96l320 0c17.7 0 32 14.3 32 32l0 32L32 160l0-32c0-17.7 14.3-32 32-32zm40 160l80 0c4.4 0 8 3.6 8 8l0 80c0 4.4-3.6 8-8 8l-80 0c-4.4 0-8-3.6-8-8l0-80c0-4.4 3.6-8 8-8zm-40 8l0 80c0 22.1 17.9 40 40 40l80 0c22.1 0 40-17.9 40-40l0-80c0-22.1-17.9-40-40-40l-80 0c-22.1 0-40 17.9-40 40z" />
							</svg>
						</button>
					</Tooltip>
					<CalendarPanel
						anchorRef={calendarButtonRef}
						isOpen={calendarOpen}
						onClose={handleCalendarClose}
						onDateSelect={handleDateSelect}
					/>
				</div>

				{/* Show/hide completed icon */}
				<div className="top-bar-completed-container">
					<Tooltip
						content={showCompleted ? 'Hide completed' : 'Show completed'}
						shortcut="⌘O"
					>
						<button
							aria-expanded={completedToggleOpen}
							aria-haspopup="true"
							aria-label={showCompleted ? 'Hide completed' : 'Show completed'}
							className={`top-bar-button ${showCompleted ? 'active' : ''}`}
							onClick={handleCompletedToggleOpen}
							ref={completedButtonRef}
							type="button"
						>
							<svg
								fill="currentColor"
								height="16"
								viewBox="0 0 448 512"
								width="16"
							>
								<path d="M443.3 100.7c6.2 6.2 6.2 16.4 0 22.6l-272 272c-6.2 6.2-16.4 6.2-22.6 0l-144-144c-6.2-6.2-6.2-16.4 0-22.6s16.4-6.2 22.6 0L160 361.4 420.7 100.7c6.2-6.2 16.4-6.2 22.6 0z" />
							</svg>
						</button>
					</Tooltip>
					<HideCompletedToggle
						anchorRef={completedButtonRef}
						isOpen={completedToggleOpen}
						onClose={handleCompletedToggleClose}
						onToggle={toggleCompleted}
						showCompleted={showCompleted}
					/>
				</div>

				{/* List/Layout icon */}
				<div className="top-bar-layout-container">
					<Tooltip content="Layout">
						<button
							aria-expanded={layoutMenuOpen}
							aria-haspopup="true"
							aria-label="Layout"
							className={`top-bar-button ${layoutMenuOpen ? 'active' : ''}`}
							data-handbook="bullet.layout"
							onClick={handleLayoutToggle}
							ref={layoutButtonRef}
							type="button"
						>
							<svg
								fill="currentColor"
								height="16"
								viewBox="0 0 512 512"
								width="16"
							>
								<path d="M64 64a32 32 0 1 0 0 64 32 32 0 1 0 0-64zM176 80c-8.8 0-16 7.2-16 16s7.2 16 16 16l320 0c8.8 0 16-7.2 16-16s-7.2-16-16-16L176 80zm0 160c-8.8 0-16 7.2-16 16s7.2 16 16 16l320 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-320 0zm0 160c-8.8 0-16 7.2-16 16s7.2 16 16 16l320 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-320 0zM64 224a32 32 0 1 0 0 64 32 32 0 1 0 0-64zm0 160a32 32 0 1 0 0 64 32 32 0 1 0 0-64z" />
							</svg>
						</button>
					</Tooltip>
					{layoutMenuOpen && (
						<LayoutMenu
							currentLayout={null}
							onClose={handleLayoutClose}
							onSelect={handleLayoutSelect}
							position={layoutMenuPosition}
						/>
					)}
				</div>

				{/* Menu dots icon */}
				<div
					className="top-bar-menu-container"
					ref={menuRef}
				>
					<Tooltip content="More options">
						<button
							aria-expanded={menuOpen}
							aria-haspopup="true"
							aria-label="More options"
							className="top-bar-button top-bar-menu-button"
							onClick={handleMenuToggle}
							type="button"
						>
							<svg
								fill="currentColor"
								height="16"
								viewBox="0 0 128 512"
								width="16"
							>
								<path d="M64 384a32 32 0 1 0 0 64 32 32 0 1 0 0-64zm0-160a32 32 0 1 0 0 64 32 32 0 1 0 0-64zM96 96A32 32 0 1 0 32 96a32 32 0 1 0 64 0z" />
							</svg>
							<span className="top-bar-menu-notification-dot" />
						</button>
					</Tooltip>
					<GearMenu
						isOpen={menuOpen}
						onClose={handleMenuClose}
						onCollapseAll={handleCollapseAll}
						onExpandAll={handleExpandAll}
						onOpenSettings={handleSettingsClick}
					/>
				</div>
			</div>
		</header>
	);
}
