import {useEffect, useRef, useState} from 'react';
import {stripHtmlTags as stripHtml} from '@workflowy/shared/html';
import {createPortal} from 'react-dom';
import {useNodeNavigation, uuidToShortId} from '../navigation.js';
import type {NodeResponse} from './outline-node.js';

interface MirrorLocationPath {
	id: string;
	name: string;
}

interface MirrorLocation {
	id: string;
	path: MirrorLocationPath[];
	isOriginal: boolean;
}

interface MirrorsResponse {
	mirrors: MirrorLocation[];
	originalId: string;
	nodeName: string;
}

interface NodeContextMenuProps {
	node: NodeResponse;
	onComplete: () => void;
	onDelete: () => void;
	onExpandAll: () => void;
	onCollapseAll: () => void;
	onClose: () => void;
	onShowMirrors?: (data: MirrorsResponse) => void;
	position: {top: number; left: number};
}

function formatTimestamp(unixTimestamp: number | null): string {
	if (unixTimestamp === null) return 'Unknown';
	const date = new Date(unixTimestamp * 1000);
	return date.toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength) + '...';
}

/**
 * Modal dialog showing all mirror locations for a node.
 * Matches production Workflowy's "Mirrors for..." dialog.
 */
function MirrorsModal({data, onClose}: {data: MirrorsResponse; onClose: () => void}) {
	const {navigateToNode} = useNodeNavigation();
	const modalRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
				onClose();
			}
		}
		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') onClose();
		}
		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('keydown', handleEscape);
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [onClose]);

	const handleNavigate = (nodeId: string, event: React.MouseEvent) => {
		event.preventDefault();
		onClose();
		navigateToNode(nodeId);
	};

	const displayName = truncate(stripHtml(data.nodeName), 30);

	return createPortal(
		<div className="mirrors-modal-overlay">
			<div
				className="mirrors-modal"
				ref={modalRef}
			>
				<div className="mirrors-modal-header">
					<h2 className="mirrors-modal-title">Mirrors for &ldquo;{displayName}&rdquo;</h2>
					<button
						className="mirrors-modal-close"
						onClick={onClose}
						type="button"
					>
						&times;
					</button>
				</div>
				<div className="mirrors-modal-body">
					{data.mirrors.map((loc, index) => {
						const breadcrumbs = loc.path.map((p) => truncate(stripHtml(p.name), 20));
						return (
							<div
								className={`mirrors-modal-location ${loc.isOriginal ? 'original' : ''}`}
								key={loc.id}
							>
								<div className="mirrors-modal-location-label">
									{loc.isOriginal ? 'Original' : 'Linked copy'}
								</div>
								<a
									className="mirrors-modal-location-path"
									href={`/node/${uuidToShortId(loc.id)}`}
									onClick={(event) => handleNavigate(loc.id, event)}
								>
									<span className="mirrors-modal-location-number">{index + 1}.</span>
									{breadcrumbs.map((crumb, i) => (
										<span key={i}>
											{i > 0 && <span className="mirrors-modal-breadcrumb-sep"> &gt; </span>}
											<span>{crumb}</span>
										</span>
									))}
								</a>
							</div>
						);
					})}
				</div>
			</div>
		</div>,
		document.body,
	);
}

/**
 * Banner shown at the top of context menu for mirror nodes.
 * Shows mirror count with a "See them" link that opens a modal.
 */
function MirrorBanner({
	originalNodeId,
	onShowMirrors,
}: {
	originalNodeId: string;
	onShowMirrors: (data: MirrorsResponse) => void;
}) {
	const [mirrorsData, setMirrorsData] = useState<MirrorsResponse | null>(null);

	useEffect(() => {
		fetch(`/api/v1/nodes/${encodeURIComponent(originalNodeId)}/mirrors`)
			.then(async (response) => {
				if (response.ok) {
					const data = (await response.json()) as MirrorsResponse;
					setMirrorsData(data);
				}
			})
			.catch(() => {});
	}, [originalNodeId]);

	if (!mirrorsData || mirrorsData.mirrors.length <= 1) return null;

	const handleSeeAll = (event: React.MouseEvent) => {
		event.stopPropagation();
		onShowMirrors(mirrorsData);
	};

	return (
		<div className="mirror-banner">
			<span>Node has {mirrorsData.mirrors.length} mirrors. </span>
			<button
				className="mirror-banner-link"
				onClick={handleSeeAll}
				type="button"
			>
				See them
			</button>
		</div>
	);
}

/**
 * Context menu dropdown for node actions.
 * Shows working actions and disabled placeholders for future features.
 */
function NodeContextMenu({
	node,
	onComplete,
	onDelete,
	onExpandAll,
	onCollapseAll,
	onClose,
	onShowMirrors,
	position,
}: NodeContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const isCompleted = node.completedAt !== null;

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				onClose();
			}
		}

		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				onClose();
			}
		}

		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('keydown', handleEscape);

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [onClose]);

	const handleAction = (action: () => void) => {
		action();
		onClose();
	};

	const menu = (
		<div
			className="node-context-menu"
			ref={menuRef}
			style={{top: position.top, left: position.left}}
		>
			{node.isMirror && node.originalNodeId && onShowMirrors && (
				<MirrorBanner
					onShowMirrors={(data) => {
						onClose();
						onShowMirrors(data);
					}}
					originalNodeId={node.originalNodeId}
				/>
			)}
			<div className="node-context-menu-section">
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					<span>Turn into...</span>
				</button>
				<button
					className="node-context-menu-item"
					onClick={() => handleAction(onComplete)}
					type="button"
				>
					<span>{isCompleted ? 'Uncomplete' : 'Complete'}</span>
					<span className="node-context-menu-shortcut">⌘↵</span>
				</button>
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					<span>Add note</span>
					<span className="node-context-menu-shortcut">⇧↵</span>
				</button>
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					<span>Add date</span>
					<span className="node-context-menu-shortcut">!!</span>
				</button>
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-section">
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					<span>Present</span>
					<span className="node-context-menu-shortcut">⇧⌘P</span>
				</button>
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					<span>Add comment</span>
					<span className="node-context-menu-shortcut">^M</span>
				</button>
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-section">
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					Move To...
				</button>
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					Move to Today
				</button>
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					Move to Tomorrow
				</button>
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					Move to Next Week
				</button>
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					Upload file
				</button>
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					Mirror To...
				</button>
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					<span>Mirror</span>
					<span className="node-context-menu-shortcut">⇧⌘M</span>
				</button>
				{node.isMirror && (
					<button
						className="node-context-menu-item disabled"
						disabled
						type="button"
					>
						Detach Mirror
					</button>
				)}
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					<span>Duplicate</span>
					<span className="node-context-menu-shortcut">⇧⌘D</span>
				</button>
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-section">
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					Share
				</button>
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					Export
				</button>
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					<span>Copy internal link</span>
					<span className="node-context-menu-shortcut">⇧⌘L</span>
				</button>
				<button
					className="node-context-menu-item disabled"
					disabled
					type="button"
				>
					Make template
				</button>
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-section">
				<button
					className="node-context-menu-item danger"
					onClick={() => handleAction(onDelete)}
					type="button"
				>
					<span>Delete</span>
					<span className="node-context-menu-shortcut">⇧⌘⌫</span>
				</button>
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-section">
				<button
					className="node-context-menu-item"
					onClick={() => handleAction(onExpandAll)}
					type="button"
				>
					Expand all
				</button>
				<button
					className="node-context-menu-item"
					onClick={() => handleAction(onCollapseAll)}
					type="button"
				>
					Collapse all
				</button>
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-timestamps">
				<div className="node-context-menu-timestamp">
					<span className="node-context-menu-timestamp-label">Changed:</span>
					<span className="node-context-menu-timestamp-value">{formatTimestamp(node.modifiedAt)}</span>
				</div>
				<div className="node-context-menu-timestamp">
					<span className="node-context-menu-timestamp-label">Created:</span>
					<span className="node-context-menu-timestamp-value">{formatTimestamp(node.createdAt)}</span>
				</div>
			</div>
		</div>
	);

	return createPortal(menu, document.body);
}

interface NodeContextMenuButtonProps {
	node: NodeResponse;
	onComplete: () => void;
	onDelete: () => void;
	onExpandAll: () => void;
	onCollapseAll: () => void;
	isVisible: boolean;
}

/**
 * Button that triggers the context menu.
 * Appears on hover or when node is selected.
 */
export function NodeContextMenuButton({
	node,
	onComplete,
	onDelete,
	onExpandAll,
	onCollapseAll,
	isVisible,
}: NodeContextMenuButtonProps) {
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [menuPosition, setMenuPosition] = useState({top: 0, left: 0});
	const [mirrorsModalData, setMirrorsModalData] = useState<MirrorsResponse | null>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	const handleClick = (event: React.MouseEvent) => {
		event.stopPropagation();
		if (!isMenuOpen && buttonRef.current) {
			const rect = buttonRef.current.getBoundingClientRect();
			setMenuPosition({
				top: rect.bottom,
				left: rect.left,
			});
		}
		setIsMenuOpen(!isMenuOpen);
	};

	const handleClose = () => {
		setIsMenuOpen(false);
	};

	return (
		<div className="nameButtons">
			<button
				className={`node-context-menu-button ${isVisible || isMenuOpen ? 'visible' : ''}`}
				onClick={handleClick}
				ref={buttonRef}
				title="More actions"
				type="button"
			>
				<svg
					fill="currentColor"
					height="24"
					viewBox="0 0 24 24"
					width="24"
				>
					<circle
						cx="6"
						cy="12"
						r="2"
					/>
					<circle
						cx="12"
						cy="12"
						r="2"
					/>
					<circle
						cx="18"
						cy="12"
						r="2"
					/>
				</svg>
			</button>
			{isMenuOpen && (
				<NodeContextMenu
					node={node}
					onClose={handleClose}
					onCollapseAll={onCollapseAll}
					onComplete={onComplete}
					onDelete={onDelete}
					onExpandAll={onExpandAll}
					onShowMirrors={(data) => setMirrorsModalData(data)}
					position={menuPosition}
				/>
			)}
			{mirrorsModalData && (
				<MirrorsModal
					data={mirrorsModalData}
					onClose={() => setMirrorsModalData(null)}
				/>
			)}
		</div>
	);
}
