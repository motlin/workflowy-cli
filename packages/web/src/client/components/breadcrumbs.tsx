import {useNodeNavigation} from '../navigation.js';
import {stripHtmlTags} from '@workflowy/shared/html';
import {useAncestors} from '../hooks/use-nodes.js';

interface BreadcrumbItem {
	id: string;
	name: string;
}

/**
 * Strips HTML tags from node names for display.
 * Matches the stripHtmlTags method from PathBuilder service.
 */

/**
 * Breadcrumb separator using production Workflowy SVG.
 */
function BreadcrumbSeparator() {
	return (
		<svg
			aria-hidden="true"
			className="breadcrumb-separator-icon"
			fill="none"
			height="8"
			viewBox="0 0 5 8"
			width="5"
		>
			<path
				d="M0 0 L4 4 L0 8"
				stroke="currentColor"
				strokeLinecap="round"
			/>
		</svg>
	);
}

/**
 * Home icon for root navigation.
 */
function HomeIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="currentColor"
			height="18"
			viewBox="0 0 576 512"
			width="20"
		>
			<path d="M298.6 4c-6-5.3-15.1-5.3-21.2 0L5.4 244c-6.6 5.8-7.3 16-1.4 22.6s16 7.3 22.6 1.4L64 235.1 64 432c0 44.2 35.8 80 80 80l288 0c44.2 0 80-35.8 80-80l0-196.9 37.4 32.9c6.6 5.8 16.7 5.2 22.6-1.4s5.2-16.7-1.4-22.6L298.6 4zM96 432l0-225.3L288 37.3 480 206.7 480 432c0 26.5-21.5 48-48 48l-64 0 0-160c0-17.7-14.3-32-32-32l-96 0c-17.7 0-32 14.3-32 32l0 160-64 0c-26.5 0-48-21.5-48-48zm144 48l0-160 96 0 0 160-96 0z" />
		</svg>
	);
}

interface BreadcrumbsProps {
	nodeId: string | null;
}

/**
 * Displays a breadcrumb trail from root to the current zoomed node.
 * Each segment is clickable to navigate to that level.
 * Matches Workflowy's breadcrumb navigation with < > arrows and home icon.
 */
export function Breadcrumbs({nodeId}: BreadcrumbsProps) {
	const {navigateToNode} = useNodeNavigation();
	const {data: ancestors, isLoading} = useAncestors(nodeId);

	// If at root level, show just the home icon
	if (nodeId === null) {
		return (
			<nav
				aria-label="Breadcrumb navigation"
				className="breadcrumbs"
			>
				<span
					aria-label="Home"
					className="breadcrumb-home-icon"
				>
					<HomeIcon />
				</span>
			</nav>
		);
	}

	if (isLoading) {
		return (
			<nav
				aria-label="Breadcrumb navigation"
				className="breadcrumbs breadcrumbs-loading"
			>
				<span className="breadcrumb-home-icon">
					<HomeIcon />
				</span>
			</nav>
		);
	}

	// Transform ancestors to breadcrumb items
	const path: BreadcrumbItem[] = (ancestors ?? []).map((node) => ({
		id: node.id,
		name: stripHtmlTags(node.name ?? 'Untitled'),
	}));

	return (
		<nav
			aria-label="Breadcrumb navigation"
			className="breadcrumbs"
		>
			{/* Home icon - navigates to root */}
			<button
				aria-label="Home"
				className="breadcrumb-home-icon"
				onClick={() => navigateToNode(null)}
				title="Home"
				type="button"
			>
				<HomeIcon />
			</button>

			{/* Path items with separators */}
			{path.map((item, index) => (
				<span
					className="breadcrumb-path-segment"
					key={item.id}
				>
					<span className="breadcrumb-separator">
						<BreadcrumbSeparator />
					</span>
					{index === path.length - 1 ? (
						<span className="breadcrumb-item breadcrumb-current">{item.name}</span>
					) : (
						<button
							className="breadcrumb-item"
							onClick={() => navigateToNode(item.id)}
							type="button"
						>
							{item.name}
						</button>
					)}
				</span>
			))}
		</nav>
	);
}
