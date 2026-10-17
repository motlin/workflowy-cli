import {skipToken, useQuery} from "@tanstack/react-query";
import {useCallback} from "react";
import {nodeRoute} from "../navigation.js";
import {stripHtmlTags as stripHtml} from "@workflowy/shared/html";
import {useNavigate} from "react-router-dom";
import {useOutlineStore} from "../stores/outline.js";
import {readJson} from "../read-json.js";

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

async function fetchRelatedNodes(nodeId: string): Promise<RelatedNode[]> {
	const response = await fetch("/api/related", {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({
			nodeId,
			type: "similar",
			limit: 10,
			threshold: 0.7,
		}),
	});
	if (!response.ok) {
		const data = await readJson<{error?: string}>(response);
		throw new Error(data.error ?? "Failed to fetch related nodes");
	}
	const data = await readJson<RelatedResponse>(response);
	return data.results;
}

/**
 * Sidebar panel showing nodes semantically related to the most recently edited node.
 * Updates automatically when editing moves to another node, and keeps its results after the edit ends.
 * Click a result to navigate to that node.
 */
export function RelatedNodesPanel() {
	const {lastEditedId, relatedNodesPanelOpen, toggleRelatedNodesPanel} = useOutlineStore();
	const navigate = useNavigate();

	const {
		data: relatedNodes = [],
		isLoading,
		error: queryError,
	} = useQuery({
		queryKey: ["related", lastEditedId],
		queryFn:
			relatedNodesPanelOpen && lastEditedId !== null ? async () => fetchRelatedNodes(lastEditedId) : skipToken,
	});
	const error = queryError?.message ?? null;

	const handleNavigateToNode = useCallback(
		(nodeId: string) => {
			void navigate(nodeRoute(nodeId));
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
				{!lastEditedId && <p className="related-nodes-panel-hint">Edit a node to see related content</p>}

				{lastEditedId && isLoading && <p className="related-nodes-panel-status">Loading...</p>}

				{lastEditedId && error && <p className="related-nodes-panel-error">{error}</p>}

				{lastEditedId && !isLoading && !error && relatedNodes.length === 0 && (
					<p className="related-nodes-panel-empty">No related nodes found</p>
				)}

				{lastEditedId && !isLoading && !error && relatedNodes.length > 0 && (
					<ul className="related-nodes-panel-list">
						{relatedNodes.map((node) => (
							<li key={node.id}>
								<button
									className="related-nodes-panel-item"
									onClick={() => {
										handleNavigateToNode(node.id);
									}}
									type="button"
								>
									<div className="related-nodes-panel-item-header">
										<span className="related-nodes-panel-item-name">
											{stripHtml(node.name) || "Untitled"}
										</span>
										<span className="related-nodes-panel-item-score">
											{formatSimilarityScore(node.distance)}
										</span>
									</div>
									{node.path.length > 0 && (
										<span className="related-nodes-panel-item-path">{node.path.join(" > ")}</span>
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
