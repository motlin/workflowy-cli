import {useCallback, useEffect, useRef, useState} from 'react';
import {stripHtmlTags as stripHtml} from '@workflowy/shared/html';
import {useOutlineStore} from '../stores/outline.js';

interface NodeResult {
	id: string;
	name: string | null;
	note: string | null;
}

interface RelatedNode extends NodeResult {
	distance: number;
	path: string[];
}

interface SearchResponse {
	results: NodeResult[];
}

interface RelatedResponse {
	results: RelatedNode[];
}

function formatSimilarityScore(distance: number): string {
	// Convert distance to similarity percentage (1 - distance)
	// Cosine distance of 0 means identical, 1 means orthogonal
	const similarity = Math.max(0, Math.min(100, (1 - distance) * 100));
	return `${similarity.toFixed(0)}%`;
}

/**
 * Modal for inserting links when text is selected and Cmd+K is pressed.
 * Shows search results and (when available) semantically related nodes.
 *
 * When a node is selected:
 * 1. The selected text becomes a link to the chosen node
 * 2. The link format follows Workflowy's internal link format
 */
export function LinkInsertModal() {
	const {linkInsertOpen, linkInsertContext, closeLinkInsert} = useOutlineStore();
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<NodeResult[]>([]);
	const [relatedNodes, setRelatedNodes] = useState<RelatedNode[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [isLoadingRelated, setIsLoadingRelated] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	// Load related nodes when modal opens (semantic suggestions based on current node)
	useEffect(() => {
		if (linkInsertOpen && linkInsertContext && inputRef.current) {
			inputRef.current.focus();
			setQuery('');
			setResults([]);
			setRelatedNodes([]);
			setSelectedIndex(0);

			// Fetch semantically related nodes using embeddings
			// These appear automatically without typing - our differentiating feature
			setIsLoadingRelated(true);
			void fetch('/api/related', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					nodeId: linkInsertContext.nodeId,
					type: 'link-targets',
					limit: 8,
					threshold: 0.6,
				}),
			})
				.then(async (response) => {
					if (response.ok) {
						const data = (await response.json()) as RelatedResponse;
						setRelatedNodes(data.results);
					}
				})
				.finally(() => {
					setIsLoadingRelated(false);
				});
		}
	}, [linkInsertOpen, linkInsertContext]);

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

	const insertLink = useCallback(
		(node: NodeResult) => {
			if (!linkInsertContext?.range) {
				closeLinkInsert();
				return;
			}

			const {range} = linkInsertContext;

			// Delete the selected text
			range.deleteContents();

			// Create an anchor element with Workflowy-style internal link
			const linkElement = document.createElement('a');
			linkElement.href = `#/node/${node.id}`;
			linkElement.textContent = linkInsertContext.selectedText;
			linkElement.className = 'internal-link';
			linkElement.dataset.nodeId = node.id;

			// Insert the link
			range.insertNode(linkElement);

			// Move cursor after the link
			const selection = globalThis.getSelection();
			if (selection) {
				selection.removeAllRanges();
				const newRange = document.createRange();
				newRange.setStartAfter(linkElement);
				newRange.collapse(true);
				selection.addRange(newRange);
			}

			// Trigger a blur event to save the changes
			const editableElement = range.commonAncestorContainer.parentElement;
			if (editableElement) {
				editableElement.dispatchEvent(new Event('input', {bubbles: true}));
			}

			closeLinkInsert();
		},
		[linkInsertContext, closeLinkInsert],
	);

	// Display list: search results if query exists, otherwise related nodes
	const displayList = query.trim() ? results : relatedNodes;

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			switch (event.key) {
				case 'Escape': {
					event.preventDefault();
					closeLinkInsert();
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
						insertLink(displayList[selectedIndex]);
					}
					break;
				}
			}
		},
		[displayList, insertLink, selectedIndex, closeLinkInsert],
	);

	const handleBackdropClick = useCallback(
		(event: React.MouseEvent) => {
			if (event.target === event.currentTarget) {
				closeLinkInsert();
			}
		},
		[closeLinkInsert],
	);

	if (!linkInsertOpen || !linkInsertContext) {
		return null;
	}

	const showingRelated = !query.trim() && relatedNodes.length > 0;
	const showingResults = query.trim() && results.length > 0;
	const showNoResults = query.trim() && !isSearching && results.length === 0;
	const showEmpty = !query.trim() && !isLoadingRelated && relatedNodes.length === 0;

	return (
		<div
			className="link-insert-overlay"
			onClick={handleBackdropClick}
		>
			<div className="link-insert-modal">
				<div className="link-insert-header">
					<div className="link-insert-title">
						Insert link for:{' '}
						<span className="link-insert-selected-text">"{linkInsertContext.selectedText}"</span>
					</div>
					<input
						className="link-insert-input"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Search for a node to link..."
						ref={inputRef}
						type="text"
						value={query}
					/>
					<button
						aria-label="Close link insert modal"
						className="link-insert-close"
						onClick={closeLinkInsert}
						type="button"
					>
						&times;
					</button>
				</div>

				<div className="link-insert-results">
					{(isSearching || isLoadingRelated) && <p className="link-insert-status">Loading...</p>}

					{showNoResults && <p className="link-insert-status">No results found</p>}

					{showEmpty && (
						<p className="link-insert-hint">
							No related nodes found. Type to search for a node to link to.
						</p>
					)}

					{showingRelated && !isLoadingRelated && (
						<>
							<p className="link-insert-section-title">Semantically related nodes</p>
							<ul className="link-insert-list">
								{relatedNodes.map((node, index) => (
									<li key={node.id}>
										<button
											className={`link-insert-result ${index === selectedIndex ? 'selected' : ''}`}
											onClick={() => insertLink(node)}
											type="button"
										>
											<div className="link-insert-result-header">
												<span className="link-insert-result-name">
													{stripHtml(node.name) || 'Untitled'}
												</span>
												<span className="link-insert-result-score">
													{formatSimilarityScore(node.distance)}
												</span>
											</div>
											{node.path.length > 0 && (
												<span className="link-insert-result-path">{node.path.join(' > ')}</span>
											)}
											{node.note && (
												<span className="link-insert-result-note">{stripHtml(node.note)}</span>
											)}
										</button>
									</li>
								))}
							</ul>
						</>
					)}

					{showingResults && !isSearching && (
						<ul className="link-insert-list">
							{results.map((node, index) => (
								<li key={node.id}>
									<button
										className={`link-insert-result ${index === selectedIndex ? 'selected' : ''}`}
										onClick={() => insertLink(node)}
										type="button"
									>
										<span className="link-insert-result-name">
											{stripHtml(node.name) || 'Untitled'}
										</span>
										{node.note && (
											<span className="link-insert-result-note">{stripHtml(node.note)}</span>
										)}
									</button>
								</li>
							))}
						</ul>
					)}
				</div>

				<div className="link-insert-footer">
					<span className="link-insert-shortcut">
						<kbd>Esc</kbd> to cancel
					</span>
					<span className="link-insert-shortcut">
						<kbd>&uarr;</kbd> <kbd>&darr;</kbd> to navigate
					</span>
					<span className="link-insert-shortcut">
						<kbd>Enter</kbd> to insert link
					</span>
				</div>
			</div>
		</div>
	);
}
