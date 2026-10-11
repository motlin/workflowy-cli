import {useQuery} from "@tanstack/react-query";
import {useCallback, useEffect, useState} from "react";
import {nodeRoute} from "../navigation.js";
import {stripHtmlTags as stripHtml} from "@workflowy/shared/html";
import {useNavigate} from "react-router-dom";
import {z} from "zod";
import {useOutlineStore} from "../stores/outline.js";
import {readJson} from "../read-json.js";

const StringArraySchema = z.array(z.string());

const RECENT_NODES_STORAGE_KEY = "workflowy-recent-nodes";
const MAX_RECENT_NODES = 10;

interface NodeResult {
	id: string;
	name: string | null;
	note: string | null;
}

interface SearchResponse {
	results: NodeResult[];
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
	const jumpMenuOpen = useOutlineStore((state) => state.jumpMenuOpen);
	// Mounting the dialog only while open gives every opening fresh state.
	return jumpMenuOpen ? <JumpMenuDialog /> : null;
}

async function fetchNodes(ids: string[]): Promise<NodeResult[]> {
	const nodes = await Promise.all(
		ids.map(async (id) => {
			const response = await fetch(`/api/v1/nodes/${encodeURIComponent(id)}`);
			if (response.ok) {
				const data = await readJson<{node: NodeResult}>(response);
				return data.node;
			}
			return null;
		}),
	);
	return nodes.filter((node): node is NodeResult => node !== null);
}

function JumpMenuDialog() {
	const toggleJumpMenu = useOutlineStore((state) => state.toggleJumpMenu);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<NodeResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [recentIds] = useState(getRecentNodeIds);
	const navigate = useNavigate();

	const {data: recentNodes = [], isLoading: isLoadingRecent} = useQuery({
		queryKey: ["recent-nodes", recentIds],
		queryFn: async () => fetchNodes(recentIds),
		enabled: recentIds.length > 0,
		staleTime: 0,
	});

	// An empty query shows the default list, so clear stale results here rather than in the search effect
	const handleQueryChange = useCallback((value: string) => {
		setQuery(value);
		if (!value.trim()) {
			setResults([]);
			setSelectedIndex(0);
		}
	}, []);

	// Perform search when query changes
	useEffect(() => {
		if (!query.trim()) {
			// oxlint-disable-next-line unicorn/no-useless-undefined -- consistent-return needs a value beside the cleanup return
			return undefined;
		}

		const runSearch = async () => {
			setIsSearching(true);
			const response = await fetch("/api/search", {
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({query, limit: 10}),
			});
			if (response.ok) {
				const data = await readJson<SearchResponse>(response);
				setResults(data.results);
				setSelectedIndex(0);
			}
			setIsSearching(false);
		};
		const searchTimeout = setTimeout(() => {
			void runSearch();
		}, 150);

		return () => clearTimeout(searchTimeout);
	}, [query]);

	const handleNavigateToNode = useCallback(
		(node: NodeResult) => {
			addRecentNode(node.id);
			toggleJumpMenu();
			void navigate(nodeRoute(node.id));
		},
		[navigate, toggleJumpMenu],
	);

	// Display list: search results if query exists, otherwise recent nodes
	const displayList = query.trim() ? results : recentNodes;

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			switch (event.key) {
				case "Escape": {
					event.preventDefault();
					toggleJumpMenu();
					break;
				}
				case "ArrowDown": {
					event.preventDefault();
					setSelectedIndex((previous) => Math.min(previous + 1, displayList.length - 1));
					break;
				}
				case "ArrowUp": {
					event.preventDefault();
					setSelectedIndex((previous) => Math.max(previous - 1, 0));
					break;
				}
				case "Enter": {
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

	const showingRecent = !query.trim() && recentNodes.length > 0;
	const showingResults = query.trim() && results.length > 0;
	const showNoResults = query.trim() && !isSearching && results.length === 0;
	const showEmpty = !query.trim() && !isLoadingRecent && recentNodes.length === 0;

	return (
		<div className="jump-menu-overlay" onClick={handleBackdropClick} role="presentation">
			<div className="jump-menu">
				<div className="jump-menu-header">
					<input
						className="jump-menu-input"
						onChange={(event) => handleQueryChange(event.target.value)}
						onKeyDown={handleKeyDown}
						// oxlint-disable-next-line jsx-a11y/no-autofocus -- opening the jump menu is a request to type a query
						autoFocus
						placeholder="Jump to node..."
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
											className={`jump-menu-result ${index === selectedIndex ? "selected" : ""}`}
											onClick={() => handleNavigateToNode(node)}
											type="button"
										>
											<span className="jump-menu-result-name">
												{stripHtml(node.name) || "Untitled"}
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
										className={`jump-menu-result ${index === selectedIndex ? "selected" : ""}`}
										onClick={() => handleNavigateToNode(node)}
										type="button"
									>
										<span className="jump-menu-result-name">
											{stripHtml(node.name) || "Untitled"}
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
