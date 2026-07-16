import {useCallback, useEffect, useState} from 'react';
import {stripHtmlTags as stripHtml} from '@workflowy/shared/html';
import {useNavigate} from 'react-router-dom';
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

function formatSimilarityScore(distance: number): string {
	// Convert distance to similarity percentage (1 - distance)
	// Cosine distance of 0 means identical, 1 means orthogonal
	const similarity = Math.max(0, Math.min(100, (1 - distance) * 100));
	return `${similarity.toFixed(0)}%`;
}

/**
 * Sidebar panel showing nodes semantically related to the currently selected node.
 * Updates automatically when the selected node changes.
 * Click a result to navigate to that node.
 */
export function RelatedNodesPanel() {
	const {selectedId, relatedNodesPanelOpen, toggleRelatedNodesPanel} = useOutlineStore();
	const [relatedNodes, setRelatedNodes] = useState<RelatedNode[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const navigate = useNavigate();

	// Fetch related nodes when selected node changes
	useEffect(() => {
		if (!relatedNodesPanelOpen || !selectedId) {
			setRelatedNodes([]);
			setError(null);
			return;
		}

		setIsLoading(true);
		setError(null);

		fetch('/api/related', {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				nodeId: selectedId,
				type: 'similar',
				limit: 10,
				threshold: 0.7,
			}),
		})
			.then(async (response) => {
				if (!response.ok) {
					const data = (await response.json()) as {error?: string};
					throw new Error(data.error ?? 'Failed to fetch related nodes');
				}
				return response.json() as Promise<RelatedResponse>;
			})
			.then((data) => {
				setRelatedNodes(data.results);
			})
			.catch((error_: Error) => {
				setError(error_.message);
				setRelatedNodes([]);
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [relatedNodesPanelOpen, selectedId]);

	const handleNavigateToNode = useCallback(
		(nodeId: string) => {
			void navigate(`/node/${nodeId}`);
		},
		[navigate],
	);

	if (!relatedNodesPanelOpen) {
		return null;
	}

	return (
		<div className="related-nodes-panel">
			<div className="related-nodes-panel-header">
				<h2 className="related-nodes-panel-title">Related Nodes</h2>
				<button
					aria-label="Close related nodes panel"
					className="related-nodes-panel-close"
					onClick={toggleRelatedNodesPanel}
					type="button"
				>
					&times;
				</button>
			</div>

			<div className="related-nodes-panel-content">
				{!selectedId && <p className="related-nodes-panel-hint">Select a node to see related content</p>}

				{selectedId && isLoading && <p className="related-nodes-panel-status">Loading...</p>}

				{selectedId && error && <p className="related-nodes-panel-error">{error}</p>}

				{selectedId && !isLoading && !error && relatedNodes.length === 0 && (
					<p className="related-nodes-panel-empty">No related nodes found</p>
				)}

				{selectedId && !isLoading && !error && relatedNodes.length > 0 && (
					<ul className="related-nodes-panel-list">
						{relatedNodes.map((node) => (
							<li key={node.id}>
								<button
									className="related-nodes-panel-item"
									onClick={() => handleNavigateToNode(node.id)}
									type="button"
								>
									<div className="related-nodes-panel-item-header">
										<span className="related-nodes-panel-item-name">
											{stripHtml(node.name) || 'Untitled'}
										</span>
										<span className="related-nodes-panel-item-score">
											{formatSimilarityScore(node.distance)}
										</span>
									</div>
									{node.path.length > 0 && (
										<span className="related-nodes-panel-item-path">{node.path.join(' > ')}</span>
									)}
									{node.note && (
										<span className="related-nodes-panel-item-note">{stripHtml(node.note)}</span>
									)}
								</button>
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="related-nodes-panel-footer">
				<p className="related-nodes-panel-hint-text">Based on semantic similarity using embeddings</p>
			</div>
		</div>
	);
}
