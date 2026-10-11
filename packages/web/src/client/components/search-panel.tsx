import {useCallback, useEffect, useState} from "react";
import {nodeRoute} from "../navigation.js";
import {stripHtmlTags as stripHtml} from "@workflowy/shared/html";
import {useNavigate} from "react-router-dom";
import {useOutlineStore} from "../stores/outline.js";
import {readJson} from "../read-json.js";

interface SearchResult {
	id: string;
	name: string | null;
	note: string | null;
	parentPath: string;
	score?: number;
}

interface SearchResponse {
	results: SearchResult[];
	totalCount: number;
}

const EMBEDDING_MODEL_KEYS = ["minilm", "mpnet", "bge"] as const;

type EmbeddingModelKey = (typeof EMBEDDING_MODEL_KEYS)[number];

function isEmbeddingModelKey(value: string): value is EmbeddingModelKey {
	return EMBEDDING_MODEL_KEYS.some((key) => key === value);
}

interface ModelInfo {
	label: string;
	dimensions: number;
	speed: string;
	description: string;
}

const EMBEDDING_MODELS: Record<EmbeddingModelKey, ModelInfo> = {
	minilm: {
		label: "MiniLM",
		dimensions: 384,
		speed: "Fast",
		description: "Lightweight model, best for quick searches",
	},
	mpnet: {
		label: "MPNet",
		dimensions: 768,
		speed: "Balanced",
		description: "Good balance of speed and quality",
	},
	bge: {
		label: "BGE Large",
		dimensions: 1024,
		speed: "Best quality",
		description: "Highest quality, slower processing",
	},
};

const STORAGE_KEY = "workflowy-search-model";

function getStoredModel(): EmbeddingModelKey {
	if (typeof globalThis === "undefined") {
		return "minilm";
	}
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored !== null && isEmbeddingModelKey(stored)) {
		return stored;
	}
	return "minilm";
}

function setStoredModel(model: EmbeddingModelKey): void {
	if (typeof globalThis !== "undefined") {
		localStorage.setItem(STORAGE_KEY, model);
	}
}

function highlightMatches(text: string, query: string): string {
	if (!query.trim()) {
		return text;
	}
	const escaped = query.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
	const regex = new RegExp(`(${escaped})`, "gi");
	return text.replaceAll(regex, "<mark>$1</mark>");
}

/**
 * Full-screen search panel component.
 * Opens with Escape key, displays search input and results.
 * Click a result to navigate to that node.
 * Close with Escape when open.
 * Supports opening with a pre-filled query (e.g., from tag exploding).
 */
const SEARCH_SCOPE_STORAGE_KEY = "workflowy-search-scope";

type SearchScope = "all" | "branch";

function getStoredScope(): SearchScope {
	if (typeof globalThis === "undefined") {
		return "branch";
	}
	const stored = localStorage.getItem(SEARCH_SCOPE_STORAGE_KEY);
	if (stored === "all" || stored === "branch") {
		return stored;
	}
	return "branch";
}

function setStoredScope(scope: SearchScope): void {
	if (typeof globalThis !== "undefined") {
		localStorage.setItem(SEARCH_SCOPE_STORAGE_KEY, scope);
	}
}

export function SearchPanel() {
	const searchPanelOpen = useOutlineStore((state) => state.searchPanelOpen);
	const searchInitialQuery = useOutlineStore((state) => state.searchInitialQuery);
	const searchPanelSession = useOutlineStore((state) => state.searchPanelSession);
	// Keying on the session remounts the panel per open request, so each one starts from fresh state.
	return searchPanelOpen ? (
		<SearchPanelContent initialQuery={searchInitialQuery ?? ""} key={searchPanelSession} />
	) : null;
}

function SearchPanelContent({initialQuery}: {initialQuery: string}) {
	const {
		toggleSearchPanel,
		savedSearches,
		saveSearch,
		removeSavedSearch,
		recentSearches,
		addRecentSearch,
		clearRecentSearches,
		zoomedNodeId,
	} = useOutlineStore();
	const [query, setQuery] = useState(initialQuery);
	const [results, setResults] = useState<SearchResult[]>([]);
	const [totalCount, setTotalCount] = useState(0);
	const [isSearching, setIsSearching] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [selectedModel, setSelectedModel] = useState<EmbeddingModelKey>(getStoredModel);
	const [showModelInfo, setShowModelInfo] = useState(false);
	const [searchScope, setSearchScope] = useState<SearchScope>(getStoredScope);
	const navigate = useNavigate();

	// Determine if we should search within branch (only when zoomed and scope is 'branch')
	const effectiveParentId = zoomedNodeId && searchScope === "branch" ? zoomedNodeId : null;

	const handleScopeChange = useCallback((scope: SearchScope) => {
		setSearchScope(scope);
		setStoredScope(scope);
	}, []);

	const handleModelChange = useCallback((model: EmbeddingModelKey) => {
		setSelectedModel(model);
		setStoredModel(model);
	}, []);

	const handleSaveSearch = useCallback(() => {
		if (query.trim()) {
			saveSearch(query.trim());
		}
	}, [query, saveSearch]);

	// An empty query shows no results, so clear stale ones here rather than in the search effect
	const changeQuery = useCallback((value: string) => {
		setQuery(value);
		if (!value.trim()) {
			setResults([]);
			setTotalCount(0);
		}
	}, []);

	const isQuerySaved = savedSearches.includes(query.trim());

	const PAGE_SIZE = 20;

	// Perform search when query, model, or scope changes
	useEffect(() => {
		if (!query.trim()) {
			// oxlint-disable-next-line unicorn/no-useless-undefined -- consistent-return needs a value beside the cleanup return
			return undefined;
		}

		const searchTimeout = setTimeout(async () => {
			setIsSearching(true);
			const requestBody: {
				query: string;
				limit: number;
				offset: number;
				model: EmbeddingModelKey;
				parentId?: string;
			} = {
				query,
				limit: PAGE_SIZE,
				offset: 0,
				model: selectedModel,
			};
			if (effectiveParentId) {
				requestBody.parentId = effectiveParentId;
			}
			const response = await fetch("/api/search", {
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify(requestBody),
			});
			if (response.ok) {
				const data = await readJson<SearchResponse>(response);
				setResults(data.results);
				setTotalCount(data.totalCount);
				setSelectedIndex(0);
			}
			setIsSearching(false);
		}, 200);

		return () => clearTimeout(searchTimeout);
	}, [query, selectedModel, effectiveParentId]);

	const handleNavigateToResult = useCallback(
		(result: SearchResult) => {
			addRecentSearch(query);
			toggleSearchPanel();
			void navigate(nodeRoute(result.id));
		},
		[addRecentSearch, navigate, query, toggleSearchPanel],
	);

	const handleLoadMore = useCallback(async () => {
		if (isLoadingMore || results.length >= totalCount) {
			return;
		}

		setIsLoadingMore(true);
		const requestBody: {query: string; limit: number; offset: number; model: EmbeddingModelKey; parentId?: string} =
			{
				query,
				limit: PAGE_SIZE,
				offset: results.length,
				model: selectedModel,
			};
		if (effectiveParentId) {
			requestBody.parentId = effectiveParentId;
		}
		const response = await fetch("/api/search", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify(requestBody),
		});
		if (response.ok) {
			const data = await readJson<SearchResponse>(response);
			setResults((prev) => [...prev, ...data.results]);
		}
		setIsLoadingMore(false);
	}, [isLoadingMore, results.length, totalCount, query, selectedModel, effectiveParentId]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			switch (event.key) {
				case "Escape": {
					event.preventDefault();
					toggleSearchPanel();
					break;
				}
				case "ArrowDown": {
					event.preventDefault();
					setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
					break;
				}
				case "ArrowUp": {
					event.preventDefault();
					setSelectedIndex((prev) => Math.max(prev - 1, 0));
					break;
				}
				case "Enter": {
					event.preventDefault();
					if (results[selectedIndex]) {
						handleNavigateToResult(results[selectedIndex]);
					}
					break;
				}
			}
		},
		[handleNavigateToResult, results, selectedIndex, toggleSearchPanel],
	);

	const handleBackdropClick = useCallback(
		(event: React.MouseEvent) => {
			if (event.target === event.currentTarget) {
				toggleSearchPanel();
			}
		},
		[toggleSearchPanel],
	);

	return (
		<div className="search-panel-overlay" onClick={handleBackdropClick} role="presentation">
			<div className="search-panel">
				<div className="search-panel-header">
					<div className="search-panel-input-row">
						<input
							// oxlint-disable-next-line jsx-a11y/no-autofocus -- opening the search panel is a request to type a query
							autoFocus
							className="search-panel-input"
							onChange={(event) => changeQuery(event.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Search nodes..."
							type="text"
							value={query}
						/>
						<button
							aria-label={isQuerySaved ? "Search saved" : "Save search"}
							className={`search-panel-star ${isQuerySaved ? "saved" : ""}`}
							disabled={!query.trim() || isQuerySaved}
							onClick={handleSaveSearch}
							title={isQuerySaved ? "Search saved" : "Save this search"}
							type="button"
						>
							{isQuerySaved ? "\u2605" : "\u2606"}
						</button>
						<button
							aria-label="Close search"
							className="search-panel-close"
							onClick={toggleSearchPanel}
							type="button"
						>
							&times;
						</button>
					</div>
					<div className="search-panel-model-row">
						<div className="search-panel-model-selector">
							<span className="search-panel-model-label">Model:</span>
							<div className="search-panel-model-buttons">
								{EMBEDDING_MODEL_KEYS.map((modelKey) => (
									<button
										className={`search-panel-model-button ${selectedModel === modelKey ? "selected" : ""}`}
										key={modelKey}
										onClick={() => handleModelChange(modelKey)}
										type="button"
									>
										{EMBEDDING_MODELS[modelKey].label}
									</button>
								))}
							</div>
							<button
								aria-label="Toggle model info"
								className="search-panel-info-toggle"
								onClick={() => setShowModelInfo(!showModelInfo)}
								type="button"
							>
								?
							</button>
						</div>
						{showModelInfo && (
							<div className="search-panel-model-info">
								<div className="search-panel-model-info-item">
									<span className="search-panel-model-info-label">
										{EMBEDDING_MODELS[selectedModel].label}
									</span>
									<span className="search-panel-model-info-value">
										{EMBEDDING_MODELS[selectedModel].dimensions} dimensions
									</span>
									<span className="search-panel-model-info-speed">
										{EMBEDDING_MODELS[selectedModel].speed}
									</span>
								</div>
								<p className="search-panel-model-info-desc">
									{EMBEDDING_MODELS[selectedModel].description}
								</p>
							</div>
						)}
					</div>
					{zoomedNodeId && (
						<div className="search-panel-scope-row">
							<span className="search-panel-scope-label">Scope:</span>
							<div className="search-panel-scope-buttons">
								<button
									className={`search-panel-scope-button ${searchScope === "branch" ? "selected" : ""}`}
									onClick={() => handleScopeChange("branch")}
									type="button"
								>
									Current branch
								</button>
								<button
									className={`search-panel-scope-button ${searchScope === "all" ? "selected" : ""}`}
									onClick={() => handleScopeChange("all")}
									type="button"
								>
									All nodes
								</button>
							</div>
						</div>
					)}
				</div>

				<div className="search-panel-results">
					{isSearching && <p className="search-panel-status">Searching...</p>}

					{!isSearching && query.trim() && results.length === 0 && (
						<p className="search-panel-status">No results found</p>
					)}

					{!isSearching && results.length > 0 && (
						<>
							<p className="search-panel-count">
								{results.length} of {totalCount} result{totalCount === 1 ? "" : "s"}
							</p>
							<ul className="search-panel-list">
								{results.map((result, index) => (
									<li key={result.id}>
										<button
											className={`search-panel-result ${index === selectedIndex ? "selected" : ""}`}
											onClick={() => handleNavigateToResult(result)}
											type="button"
										>
											{result.parentPath && (
												<span className="search-panel-result-path">{result.parentPath}</span>
											)}
											<span
												className="search-panel-result-name"
												dangerouslySetInnerHTML={{
													__html: highlightMatches(stripHtml(result.name), query),
												}}
											/>
											{result.note && (
												<span
													className="search-panel-result-note"
													dangerouslySetInnerHTML={{
														__html: highlightMatches(stripHtml(result.note), query),
													}}
												/>
											)}
										</button>
									</li>
								))}
							</ul>
							{results.length < totalCount && (
								<button
									className="search-panel-load-more"
									disabled={isLoadingMore}
									onClick={handleLoadMore}
									type="button"
								>
									{isLoadingMore
										? "Loading..."
										: `Load more (${totalCount - results.length} remaining)`}
								</button>
							)}
						</>
					)}

					{!query.trim() && (
						<div className="search-panel-saved-searches">
							{savedSearches.length > 0 && (
								<>
									<p className="search-panel-saved-searches-title">Saved Searches</p>
									<ul className="search-panel-saved-searches-list">
										{savedSearches.map((savedQuery) => (
											<li className="search-panel-saved-search-item" key={savedQuery}>
												<button
													className="search-panel-saved-search"
													onClick={() => changeQuery(savedQuery)}
													type="button"
												>
													<span className="search-panel-saved-search-icon">{"\u2605"}</span>
													<span className="search-panel-saved-search-text">{savedQuery}</span>
												</button>
												<button
													aria-label="Remove saved search"
													className="search-panel-saved-search-delete"
													onClick={() => removeSavedSearch(savedQuery)}
													type="button"
												>
													&times;
												</button>
											</li>
										))}
									</ul>
								</>
							)}
							{recentSearches.length > 0 && (
								<>
									<div className="search-panel-recent-searches-header">
										<p className="search-panel-saved-searches-title">Recent Searches</p>
										<button
											aria-label="Clear recent searches"
											className="search-panel-recent-searches-clear"
											onClick={clearRecentSearches}
											type="button"
										>
											Clear
										</button>
									</div>
									<ul className="search-panel-saved-searches-list">
										{recentSearches.map((recentQuery) => (
											<li className="search-panel-saved-search-item" key={recentQuery}>
												<button
													className="search-panel-saved-search"
													onClick={() => changeQuery(recentQuery)}
													type="button"
												>
													<span className="search-panel-saved-search-icon">
														{"\u{1F551}"}
													</span>
													<span className="search-panel-saved-search-text">
														{recentQuery}
													</span>
												</button>
											</li>
										))}
									</ul>
								</>
							)}
							{savedSearches.length === 0 && recentSearches.length === 0 && (
								<p className="search-panel-hint">Type to search nodes</p>
							)}
						</div>
					)}
				</div>

				<div className="search-panel-footer">
					<span className="search-panel-shortcut">
						<kbd>Esc</kbd> to close
					</span>
					<span className="search-panel-shortcut">
						<kbd>&uarr;</kbd> <kbd>&darr;</kbd> to navigate
					</span>
					<span className="search-panel-shortcut">
						<kbd>Enter</kbd> to select
					</span>
				</div>
			</div>
		</div>
	);
}
