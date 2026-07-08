import {useCallback, useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {z} from 'zod';
import {useOutlineStore} from '../stores/outline.js';

const StringArraySchema = z.array(z.string());

const RECENT_NODES_STORAGE_KEY = 'workflowy-recent-nodes';
const MAX_RECENT_NODES = 10;

interface NodeResult {
	id: string;
	name: string | null;
	note: string | null;
}

interface SearchResponse {
	results: NodeResult[];
}

function stripHtml(html: string | null): string {
	if (!html) return '';
	return html.replaceAll(/<[^>]*>/g, '');
}

function getRecentNodeIds(): string[] {
	const stored = localStorage.getItem(RECENT_NODES_STORAGE_KEY);
	if (stored === null) {
		return [];
	}
	const result = StringArraySchema.safeParse(JSON.parse(stored));
	return result.success ? result.data : [];
}

function addRecentNode(nodeId: string): void {
	const recent = getRecentNodeIds();
	const filtered = recent.filter((id) => id !== nodeId);
	const updated = [nodeId, ...filtered].slice(0, MAX_RECENT_NODES);
	localStorage.setItem(RECENT_NODES_STORAGE_KEY, JSON.stringify(updated));
}

/**
 * Command palette style jump menu component.
 * Opens with Cmd+K, allows quick navigation to any node.
 * Shows recent nodes by default, or search results when typing.
 */
export function JumpMenu() {
	const {jumpMenuOpen, toggleJumpMenu} = useOutlineStore();
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<NodeResult[]>([]);
	const [recentNodes, setRecentNodes] = useState<NodeResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [isLoadingRecent, setIsLoadingRecent] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const navigate = useNavigate();

	// Load recent nodes when menu opens
	useEffect(() => {
		if (jumpMenuOpen && inputRef.current) {
			inputRef.current.focus();
			setQuery('');
			setResults([]);
			setSelectedIndex(0);

			// Fetch recent nodes
			const recentIds = getRecentNodeIds();
			if (recentIds.length > 0) {
				setIsLoadingRecent(true);
				void Promise.all(
					recentIds.map(async (id) => {
						const response = await fetch(`/api/v1/nodes/${encodeURIComponent(id)}`);
						if (response.ok) {
							const data = (await response.json()) as {node: NodeResult};
							return data.node;
						}
						return null;
					}),
				)
					.then((nodes) => {
						const validNodes = nodes.filter((node): node is NodeResult => node !== null);
						setRecentNodes(validNodes);
					})
					.finally(() => {
						setIsLoadingRecent(false);
					});
			} else {
				setRecentNodes([]);
			}
		}
	}, [jumpMenuOpen]);

	// Perform search when query changes
	useEffect(() => {
		if (!query.trim()) {
			setResults([]);
			setSelectedIndex(0);
			return;
		}

		const searchTimeout = setTimeout(async () => {
			setIsSearching(true);
			const response = await fetch('/api/search', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({query, limit: 10}),
			});
			if (response.ok) {
				const data = (await response.json()) as SearchResponse;
				setResults(data.results);
				setSelectedIndex(0);
			}
			setIsSearching(false);
		}, 150);

		return () => clearTimeout(searchTimeout);
	}, [query]);

	const handleNavigateToNode = useCallback(
		(node: NodeResult) => {
			addRecentNode(node.id);
			toggleJumpMenu();
			void navigate(`/node/${node.id}`);
		},
		[navigate, toggleJumpMenu],
	);

	// Display list: search results if query exists, otherwise recent nodes
	const displayList = query.trim() ? results : recentNodes;

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			switch (event.key) {
				case 'Escape': {
					event.preventDefault();
					toggleJumpMenu();
					break;
				}
				case 'ArrowDown': {
					event.preventDefault();
					setSelectedIndex((previous) => Math.min(previous + 1, displayList.length - 1));
					break;
				}
				case 'ArrowUp': {
					event.preventDefault();
					setSelectedIndex((previous) => Math.max(previous - 1, 0));
					break;
				}
				case 'Enter': {
					event.preventDefault();
					if (displayList[selectedIndex]) {
						handleNavigateToNode(displayList[selectedIndex]);
					}
					break;
				}
			}
		},
		[displayList, handleNavigateToNode, selectedIndex, toggleJumpMenu],
	);

	const handleBackdropClick = useCallback(
		(event: React.MouseEvent) => {
			if (event.target === event.currentTarget) {
				toggleJumpMenu();
			}
		},
		[toggleJumpMenu],
	);

	if (!jumpMenuOpen) {
		return null;
	}

	const showingRecent = !query.trim() && recentNodes.length > 0;
	const showingResults = query.trim() && results.length > 0;
	const showNoResults = query.trim() && !isSearching && results.length === 0;
	const showEmpty = !query.trim() && !isLoadingRecent && recentNodes.length === 0;

	return (
		<div
			className="jump-menu-overlay"
			onClick={handleBackdropClick}
		>
			<div className="jump-menu">
				<div className="jump-menu-header">
					<input
						className="jump-menu-input"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Jump to node..."
						ref={inputRef}
						type="text"
						value={query}
					/>
					<button
						aria-label="Close jump menu"
						className="jump-menu-close"
						onClick={toggleJumpMenu}
						type="button"
					>
						&times;
					</button>
				</div>

				<div className="jump-menu-results">
					{(isSearching || isLoadingRecent) && <p className="jump-menu-status">Loading...</p>}

					{showNoResults && <p className="jump-menu-status">No results found</p>}

					{showEmpty && (
						<p className="jump-menu-hint">Type to search or visit some nodes to build your recent list</p>
					)}

					{showingRecent && !isLoadingRecent && (
						<>
							<p className="jump-menu-section-title">Recent</p>
							<ul className="jump-menu-list">
								{recentNodes.map((node, index) => (
									<li key={node.id}>
										<button
											className={`jump-menu-result ${index === selectedIndex ? 'selected' : ''}`}
											onClick={() => handleNavigateToNode(node)}
											type="button"
										>
											<span className="jump-menu-result-name">
												{stripHtml(node.name) || 'Untitled'}
											</span>
											{node.note && (
												<span className="jump-menu-result-note">{stripHtml(node.note)}</span>
											)}
										</button>
									</li>
								))}
							</ul>
						</>
					)}

					{showingResults && !isSearching && (
						<ul className="jump-menu-list">
							{results.map((node, index) => (
								<li key={node.id}>
									<button
										className={`jump-menu-result ${index === selectedIndex ? 'selected' : ''}`}
										onClick={() => handleNavigateToNode(node)}
										type="button"
									>
										<span className="jump-menu-result-name">
											{stripHtml(node.name) || 'Untitled'}
										</span>
										{node.note && (
											<span className="jump-menu-result-note">{stripHtml(node.note)}</span>
										)}
									</button>
								</li>
							))}
						</ul>
					)}
				</div>

				<div className="jump-menu-footer">
					<span className="jump-menu-shortcut">
						<kbd>Esc</kbd> to close
					</span>
					<span className="jump-menu-shortcut">
						<kbd>&uarr;</kbd> <kbd>&darr;</kbd> to navigate
					</span>
					<span className="jump-menu-shortcut">
						<kbd>Enter</kbd> to select
					</span>
				</div>
			</div>
		</div>
	);
}
