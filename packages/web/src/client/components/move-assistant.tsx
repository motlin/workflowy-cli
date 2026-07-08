import {useCallback, useEffect, useRef, useState} from 'react';
import {useOutlineStore} from '../stores/outline.js';

interface RelatedNode {
	id: string;
	name: string | null;
	note: string | null;
	distance: number;
	path: string[];
}

interface RelatedResponse {
	results: RelatedNode[];
}

interface SearchResponse {
	results: Array<{
		id: string;
		name: string | null;
		note: string | null;
	}>;
}

function stripHtml(html: string | null): string {
	if (!html) return '';
	return html.replaceAll(/<[^>]*>/g, '');
}

function formatSimilarityScore(distance: number): string {
	const similarity = Math.max(0, Math.min(100, (1 - distance) * 100));
	return `${similarity.toFixed(0)}%`;
}

/**
 * Modal for suggesting parent nodes when moving or copying a node.
 * Uses semantic similarity via 'parent-candidates' from /api/related
 * to suggest nodes that could logically contain the source node as a child.
 */
export function MoveAssistant() {
	const {moveAssistantOpen, moveAssistantContext, closeMoveAssistant} = useOutlineStore();
	const [query, setQuery] = useState('');
	const [searchResults, setSearchResults] = useState<RelatedNode[]>([]);
	const [parentCandidates, setParentCandidates] = useState<RelatedNode[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Load parent candidates when modal opens
	useEffect(() => {
		if (moveAssistantOpen && moveAssistantContext && inputRef.current) {
			inputRef.current.focus();
			setQuery('');
			setSearchResults([]);
			setParentCandidates([]);
			setSelectedIndex(0);
			setError(null);

			// Fetch semantically related parent candidates using embeddings
			setIsLoadingCandidates(true);
			fetch('/api/related', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					nodeId: moveAssistantContext.nodeId,
					type: 'parent-candidates',
					limit: 10,
					threshold: 0.7,
				}),
			})
				.then(async (response) => {
					if (!response.ok) {
						const data = (await response.json()) as {error?: string};
						throw new Error(data.error ?? 'Failed to fetch parent candidates');
					}
					return response.json() as Promise<RelatedResponse>;
				})
				.then((data) => {
					setParentCandidates(data.results);
				})
				.catch((error_: Error) => {
					setError(error_.message);
				})
				.finally(() => {
					setIsLoadingCandidates(false);
				});
		}
	}, [moveAssistantOpen, moveAssistantContext]);

	// Perform search when query changes
	useEffect(() => {
		if (!query.trim()) {
			setSearchResults([]);
			setSelectedIndex(0);
			return;
		}

		const searchTimeout = setTimeout(async () => {
			setIsSearching(true);
			setError(null);
			try {
				const response = await fetch('/api/search', {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({query, limit: 10}),
				});
				if (response.ok) {
					const data = (await response.json()) as SearchResponse;
					// Convert search results to RelatedNode format for consistent display
					const results: RelatedNode[] = data.results.map((result) => ({
						...result,
						distance: 0, // No distance score for text search
						path: [],
					}));
					setSearchResults(results);
					setSelectedIndex(0);
				}
			} catch {
				setError('Search failed');
			}
			setIsSearching(false);
		}, 150);

		return () => clearTimeout(searchTimeout);
	}, [query]);

	const selectParentAsync = useCallback(
		async (targetNode: RelatedNode) => {
			if (!moveAssistantContext) {
				closeMoveAssistant();
				return;
			}

			const {nodeId, mode} = moveAssistantContext;

			try {
				if (mode === 'move') {
					// Move node to new parent
					const response = await fetch(`/api/v1/nodes/${nodeId}`, {
						method: 'POST',
						headers: {'Content-Type': 'application/json'},
						body: JSON.stringify({parent_id: targetNode.id}),
					});

					if (!response.ok) {
						const data = (await response.json()) as {error?: string};
						throw new Error(data.error ?? 'Failed to move node');
					}
				} else {
					// Copy node to new parent (create duplicate under new parent)
					// First get the source node's details
					const sourceResponse = await fetch(`/api/v1/nodes/${nodeId}`);
					if (!sourceResponse.ok) {
						throw new Error('Failed to fetch source node');
					}
					const sourceNode = (await sourceResponse.json()) as {
						name: string;
						note?: string;
						data?: {layoutMode?: string};
					};

					// Create a copy under the target parent
					const createResponse = await fetch('/api/v1/nodes', {
						method: 'POST',
						headers: {'Content-Type': 'application/json'},
						body: JSON.stringify({
							parent_id: targetNode.id,
							name: sourceNode.name,
							note: sourceNode.note,
							layoutMode: sourceNode.data?.layoutMode,
						}),
					});

					if (!createResponse.ok) {
						const data = (await createResponse.json()) as {error?: string};
						throw new Error(data.error ?? 'Failed to copy node');
					}
				}

				closeMoveAssistant();
				// Trigger a page refresh to show the updated tree
				globalThis.location.reload();
			} catch (error_) {
				setError(error_ instanceof Error ? error_.message : 'Operation failed');
			}
		},
		[moveAssistantContext, closeMoveAssistant],
	);

	const handleSelectParent = useCallback(
		(targetNode: RelatedNode) => {
			selectParentAsync(targetNode).catch(() => {
				// Error already handled in selectParentAsync
			});
		},
		[selectParentAsync],
	);

	// Display list: search results if query exists, otherwise parent candidates
	const displayList = query.trim() ? searchResults : parentCandidates;

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			switch (event.key) {
				case 'Escape': {
					event.preventDefault();
					closeMoveAssistant();
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
						handleSelectParent(displayList[selectedIndex]);
					}
					break;
				}
			}
		},
		[displayList, handleSelectParent, selectedIndex, closeMoveAssistant],
	);

	const handleBackdropClick = useCallback(
		(event: React.MouseEvent) => {
			if (event.target === event.currentTarget) {
				closeMoveAssistant();
			}
		},
		[closeMoveAssistant],
	);

	if (!moveAssistantOpen || !moveAssistantContext) {
		return null;
	}

	const showingCandidates = !query.trim() && parentCandidates.length > 0;
	const showingResults = query.trim() && searchResults.length > 0;
	const showNoResults = query.trim() && !isSearching && searchResults.length === 0;
	const showEmpty = !query.trim() && !isLoadingCandidates && parentCandidates.length === 0 && !error;
	const actionVerb = moveAssistantContext.mode === 'move' ? 'Move' : 'Copy';
	const actionVerbLower = moveAssistantContext.mode === 'move' ? 'move' : 'copy';

	return (
		<div
			className="move-assistant-overlay"
			onClick={handleBackdropClick}
		>
			<div className="move-assistant-modal">
				<div className="move-assistant-header">
					<div className="move-assistant-title">
						{actionVerb}:{' '}
						<span className="move-assistant-node-name">
							"{stripHtml(moveAssistantContext.nodeName) || 'Untitled'}"
						</span>
					</div>
					<input
						className="move-assistant-input"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Search for a destination..."
						ref={inputRef}
						type="text"
						value={query}
					/>
					<button
						aria-label="Close move assistant"
						className="move-assistant-close"
						onClick={closeMoveAssistant}
						type="button"
					>
						&times;
					</button>
				</div>

				<div className="move-assistant-results">
					{(isSearching || isLoadingCandidates) && <p className="move-assistant-status">Loading...</p>}

					{error && <p className="move-assistant-error">{error}</p>}

					{showNoResults && <p className="move-assistant-status">No results found</p>}

					{showEmpty && (
						<p className="move-assistant-hint">
							No suggested destinations found. Type to search for a parent node.
						</p>
					)}

					{showingCandidates && !isLoadingCandidates && (
						<>
							<p className="move-assistant-section-title">Suggested destinations</p>
							<ul className="move-assistant-list">
								{parentCandidates.map((node, index) => (
									<li key={node.id}>
										<button
											className={`move-assistant-result ${index === selectedIndex ? 'selected' : ''}`}
											onClick={() => handleSelectParent(node)}
											type="button"
										>
											<div className="move-assistant-result-header">
												<span className="move-assistant-result-name">
													{stripHtml(node.name) || 'Untitled'}
												</span>
												<span className="move-assistant-result-score">
													{formatSimilarityScore(node.distance)}
												</span>
											</div>
											{node.path.length > 0 && (
												<span className="move-assistant-result-path">
													{node.path.join(' > ')}
												</span>
											)}
											{node.note && (
												<span className="move-assistant-result-note">
													{stripHtml(node.note)}
												</span>
											)}
										</button>
									</li>
								))}
							</ul>
						</>
					)}

					{showingResults && !isSearching && (
						<ul className="move-assistant-list">
							{searchResults.map((node, index) => (
								<li key={node.id}>
									<button
										className={`move-assistant-result ${index === selectedIndex ? 'selected' : ''}`}
										onClick={() => handleSelectParent(node)}
										type="button"
									>
										<span className="move-assistant-result-name">
											{stripHtml(node.name) || 'Untitled'}
										</span>
										{node.note && (
											<span className="move-assistant-result-note">{stripHtml(node.note)}</span>
										)}
									</button>
								</li>
							))}
						</ul>
					)}
				</div>

				<div className="move-assistant-footer">
					<span className="move-assistant-shortcut">
						<kbd>Esc</kbd> to cancel
					</span>
					<span className="move-assistant-shortcut">
						<kbd>&uarr;</kbd> <kbd>&darr;</kbd> to navigate
					</span>
					<span className="move-assistant-shortcut">
						<kbd>Enter</kbd> to {actionVerbLower}
					</span>
				</div>
			</div>
		</div>
	);
}
