import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useChildren, useCreateNode, useNode} from '../hooks/use-nodes.js';
import {useOutlineStore} from '../stores/outline.js';

/**
 * SVG icon components matching Font Awesome style.
 */
function CalendarDayIcon() {
	return (
		<svg
			fill="currentColor"
			height="16"
			viewBox="0 0 448 512"
			width="16"
		>
			<path d="M128 0c17.7 0 32 14.3 32 32l0 32 128 0 0-32c0-17.7 14.3-32 32-32s32 14.3 32 32l0 32 48 0c26.5 0 48 21.5 48 48l0 48L0 160l0-48C0 85.5 21.5 64 48 64l48 0 0-32c0-17.7 14.3-32 32-32zM0 192l448 0 0 272c0 26.5-21.5 48-48 48L48 512c-26.5 0-48-21.5-48-48L0 192zm80 64c-8.8 0-16 7.2-16 16l0 96c0 8.8 7.2 16 16 16l96 0c8.8 0 16-7.2 16-16l0-96c0-8.8-7.2-16-16-16l-96 0z" />
		</svg>
	);
}

function SearchIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M384 208A176 176 0 1 0 32 208a176 176 0 1 0 352 0zM343.3 366C307 397.2 259.7 416 208 416C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208c0 51.7-18.8 99-50 135.3L507.3 484.7c6.2 6.2 6.2 16.4 0 22.6s-16.4 6.2-22.6 0L343.3 366z" />
		</svg>
	);
}

function ChevronIcon({expanded}: {expanded: boolean}) {
	return (
		<svg
			className={`section-chevron ${expanded ? 'expanded' : ''}`}
			fill="currentColor"
			height="10"
			viewBox="0 0 320 512"
			width="10"
		>
			<path d="M299.3 244.7c6.2 6.2 6.2 16.4 0 22.6l-192 192c-6.2 6.2-16.4 6.2-22.6 0s-6.2-16.4 0-22.6L265.4 256 84.7 75.3c-6.2-6.2-6.2-16.4 0-22.6s16.4-6.2 22.6 0l192 192z" />
		</svg>
	);
}

function ExpandToggleIcon({expanded}: {expanded: boolean}) {
	return (
		<svg
			className={`tree-toggle-icon ${expanded ? 'expanded' : ''}`}
			fill="currentColor"
			height="10"
			viewBox="0 0 320 512"
			width="10"
		>
			<path d="M299.3 244.7c6.2 6.2 6.2 16.4 0 22.6l-192 192c-6.2 6.2-16.4 6.2-22.6 0s-6.2-16.4 0-22.6L265.4 256 84.7 75.3c-6.2-6.2-6.2-16.4 0-22.6s16.4-6.2 22.6 0l192 192z" />
		</svg>
	);
}

function ArrowLeftIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 320 512"
			width="14"
		>
			<path d="M20.7 267.3c-6.2-6.2-6.2-16.4 0-22.6l192-192c6.2-6.2 16.4-6.2 22.6 0s6.2 16.4 0 22.6L54.6 256 235.3 436.7c6.2 6.2 6.2 16.4 0 22.6s-16.4 6.2-22.6 0l-192-192z" />
		</svg>
	);
}

function PlusIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 448 512"
			width="14"
		>
			<path d="M240 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 144L32 208c-17.7 0-32 14.3-32 32s14.3 32 32 32l144 0 0 144c0 17.7 14.3 32 32 32s32-14.3 32-32l0-144 144 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-144 0 0-144z" />
		</svg>
	);
}

/**
 * Star icon (filled) for starred locations.
 */
function StarIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 576 512"
			width="14"
		>
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
		void navigate(`/node/${nodeId}`);
	};

	const handleRemove = (event: React.MouseEvent) => {
		event.stopPropagation();
		toggleStarPage(nodeId);
	};

	const displayName = node?.name?.replace(/<[^>]*>/g, '') || 'Loading...';

	return (
		<li>
			<button
				className="left-sidebar-item"
				onClick={handleClick}
				type="button"
			>
				<span className="left-sidebar-icon starred-icon">
					<StarIcon />
				</span>
				<span className="left-sidebar-label">{displayName}</span>
				<span
					aria-label="Unstar this page"
					className="left-sidebar-unstar"
					onClick={handleRemove}
					role="button"
					tabIndex={0}
				>
					&times;
				</span>
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

	const handleRemove = (event: React.MouseEvent) => {
		event.stopPropagation();
		removeSavedSearch(query);
	};

	return (
		<li>
			<button
				className="left-sidebar-item"
				onClick={handleClick}
				type="button"
			>
				<span className="left-sidebar-icon">
					<SearchIcon />
				</span>
				<span className="left-sidebar-label">{query}</span>
				<span
					aria-label="Remove saved search"
					className="left-sidebar-unstar"
					onClick={handleRemove}
					role="button"
					tabIndex={0}
				>
					&times;
				</span>
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
		void navigate(`/node/${nodeId}`);
	};

	const handleToggle = (event: React.MouseEvent) => {
		event.stopPropagation();
		setIsExpanded(!isExpanded);
	};

	const displayName = name?.replace(/<[^>]*>/g, '') || 'Untitled';

	return (
		<li className="home-tree-item">
			<button
				className="left-sidebar-item"
				onClick={handleClick}
				type="button"
			>
				{hasChildren && (
					<span
						className="home-tree-toggle"
						onClick={handleToggle}
						role="button"
						tabIndex={0}
					>
						<ExpandToggleIcon expanded={isExpanded} />
					</span>
				)}
				{!hasChildren && <span className="home-tree-toggle-placeholder" />}
				<span className="left-sidebar-label">{displayName}</span>
			</button>
			{isExpanded && children && children.length > 0 && (
				<ul className="home-tree-children">
					{children.map((child) => (
						<HomeTreeItem
							hasChildren={true}
							key={child.id}
							name={child.name ?? ''}
							nodeId={child.id}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

/**
 * Left sidebar component for the outline view.
 * Contains Today, Starred searches, and Home tree.
 * Toggled open/closed with Ctrl+L keyboard shortcut.
 * Styled to match Workflowy's left sidebar layout.
 */
export function LeftSidebar() {
	const {leftSidebarOpen, toggleLeftSidebar, savedSearches, starredPages, zoomedNodeId} = useOutlineStore();
	const navigate = useNavigate();
	const createNode = useCreateNode();
	const {data: rootNodes} = useChildren(null);
	const [starredExpanded, setStarredExpanded] = useState(true);
	const [homeExpanded, setHomeExpanded] = useState(true);
	const starredPagesArray = [...starredPages];

	const handleTodayClick = () => {
		void navigate('/');
	};

	const handleNewNode = () => {
		createNode.mutate({
			parent_id: zoomedNodeId ?? undefined,
			name: '',
		});
	};

	if (!leftSidebarOpen) {
		return null;
	}

	return (
		<aside className="left-sidebar">
			<div className="left-sidebar-header">
				<button
					aria-label="Close sidebar"
					className="left-sidebar-close"
					onClick={toggleLeftSidebar}
					type="button"
				>
					<ArrowLeftIcon />
				</button>
			</div>

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

				{/* Starred Section */}
				<section className="left-sidebar-section">
					<h3
						className="left-sidebar-section-title"
						onClick={() => setStarredExpanded(!starredExpanded)}
					>
						<span className="left-sidebar-section-toggle">
							<ChevronIcon expanded={starredExpanded} />
						</span>
						Starred
					</h3>
					{starredExpanded && (
						<ul className="left-sidebar-list">
							{starredPagesArray.length === 0 && savedSearches.length === 0 ? (
								<li className="left-sidebar-empty">No starred items</li>
							) : (
								<>
									{starredPagesArray.map((nodeId) => (
										<StarredPageItem
											key={nodeId}
											nodeId={nodeId}
										/>
									))}
									{savedSearches.map((query) => (
										<SavedSearchItem
											key={query}
											query={query}
										/>
									))}
								</>
							)}
						</ul>
					)}
				</section>

				{/* Home Section */}
				<section className="left-sidebar-section">
					<h3
						className="left-sidebar-section-title"
						onClick={() => setHomeExpanded(!homeExpanded)}
					>
						<span className="left-sidebar-section-toggle">
							<ChevronIcon expanded={homeExpanded} />
						</span>
						Home
					</h3>
					{homeExpanded && (
						<ul className="left-sidebar-list home-tree">
							{rootNodes?.map((node) => (
								<HomeTreeItem
									hasChildren={true}
									key={node.id}
									name={node.name ?? ''}
									nodeId={node.id}
								/>
							))}
						</ul>
					)}
				</section>
			</nav>

			<div className="left-sidebar-footer">
				<button
					className="left-sidebar-new-node"
					onClick={handleNewNode}
					type="button"
				>
					<span className="left-sidebar-new-node-icon">
						<PlusIcon />
					</span>
					<span>New node</span>
				</button>
			</div>
		</aside>
	);
}
