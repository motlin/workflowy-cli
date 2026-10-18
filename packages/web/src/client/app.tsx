import {QueryClient, QueryClientProvider, skipToken, useQuery} from "@tanstack/react-query";
import {useEffect} from "react";
import {BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams} from "react-router-dom";
import type {NodeResponse} from "../node-types.js";

import {ChangesView} from "./components/changes-view.js";
import {ErrorBoundary} from "./components/error-boundary.js";
import {ErrorNotifications} from "./components/error-notification.js";
import {ExportDialog} from "./components/export-dialog.js";
import {JumpMenu} from "./components/jump-menu.js";
import {LadderView} from "./components/ladder-view.js";
import {LeftBar} from "./components/left-sidebar.js";
import {LinkInsertModal} from "./components/link-insert-modal.js";
import {LoadingOverlay} from "./components/loading-spinner.js";
import {MoveAssistant} from "./components/move-assistant.js";
import {OfflineBanner} from "./components/offline-banner.js";
import {OutlineTree} from "./components/outline-tree.js";
import {PresentationMode} from "./components/presentation-mode.js";
import {RelatedNodesPanel} from "./components/related-nodes-panel.js";
import {RightSidebar} from "./components/right-sidebar.js";
import {SearchPanel} from "./components/search-panel.js";
import {Settings} from "./components/settings.js";
import {TopBar} from "./components/top-bar.js";
import {useKeyboardShortcuts} from "./hooks/use-keyboard-shortcuts.js";
import {locationUrl, parseLocationHash} from "./location.js";
import {nodeUrl, resolveZoomTarget} from "./navigation.js";
import {nodeKeys} from "./node-cache.js";
import {readJson} from "./read-json.js";
import {selectIsMutating, useOutlineStore} from "./stores/outline.js";
import "./wf-tailwind.css";
import "./styles.css";

/**
 * Custom retry function that retries transient failures.
 * Does not retry on 4xx client errors (except 408 timeout and 429 rate limit).
 */
function shouldRetry(failureCount: number, error: Error): boolean {
	// Max 3 retries
	if (failureCount >= 3) {
		return false;
	}

	// Check for HTTP status in error message
	const statusDigits = error.message.match(/(\d{3})/)?.[1];
	if (statusDigits !== undefined) {
		const status = Number.parseInt(statusDigits, 10);
		// Don't retry client errors except timeout (408) and rate limit (429)
		if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
			return false;
		}
	}

	// Retry for network errors and server errors
	return true;
}

/**
 * Calculate exponential backoff delay.
 */
function getRetryDelay(attemptIndex: number): number {
	// Exponential backoff: 1s, 2s, 4s
	return Math.min(1000 * 2 ** attemptIndex, 4000);
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 1000 * 60,
			refetchOnWindowFocus: false,
			retry: shouldRetry,
			retryDelay: getRetryDelay,
		},
		mutations: {
			retry: shouldRetry,
			retryDelay: getRetryDelay,
		},
	},
});

function OutlineView() {
	const {zoomedNodeId, rightSidebarOpen, relatedNodesPanelOpen} = useOutlineStore();
	const isMutating = useOutlineStore(selectIsMutating);

	// Register keyboard shortcuts
	useKeyboardShortcuts();

	const containerClasses = [
		"outline-container",
		rightSidebarOpen && "with-right-sidebar",
		relatedNodesPanelOpen && "with-related-panel",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div className={containerClasses}>
			<OfflineBanner />
			<TopBar />
			<LeftBar />
			<div className="outline-view">
				<OutlineTree parentId={zoomedNodeId} />
			</div>
			<RightSidebar />
			<RelatedNodesPanel />
			<SearchPanel />
			<JumpMenu />
			<LinkInsertModal />
			<MoveAssistant />
			<ExportDialog />
			<Settings />
			<PresentationMode />
			<ErrorNotifications />
			{isMutating && <LoadingOverlay message="Saving changes..." />}
		</div>
	);
}

/** Resolve a location id (short or full) to the node's full uuid; null when the server has no such node. */
async function fetchResolvedId(locationId: string): Promise<string | null> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(locationId)}`);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`Failed to resolve node: ${response.statusText}`);
	}
	const data = await readJson<{node: NodeResponse}>(response);
	return data.node.id;
}

/**
 * The `/` route: zooms to the node named by the `#/<id>?q=` hash and, like
 * upstream, pushes the canonical URL when it differs (`#/<full uuid>` becomes
 * `#/<12hex>`; an unknown id becomes `/` and drops `?q=`).
 */
function HashLocationRoute() {
	const location = useLocation();
	const navigate = useNavigate();
	const zoom = useOutlineStore((state) => state.zoom);
	const setUrlSearchQuery = useOutlineStore((state) => state.setUrlSearchQuery);
	const {id, query} = parseLocationHash(location.hash);
	const resolved = useQuery({
		queryKey: nodeKeys.resolvedId(id ?? ""),
		queryFn: id === null ? skipToken : async () => fetchResolvedId(id),
		staleTime: Number.POSITIVE_INFINITY,
	});
	const unknown = resolved.data === null;
	const target = resolveZoomTarget(id, () => resolved.data ?? null);
	const currentUrl = location.pathname + location.hash;

	useEffect(() => {
		if (unknown) {
			zoom(null);
			void navigate("/");
			return;
		}
		if (target === null) {
			return;
		}
		const fullId = target === "home" ? null : target;
		zoom(fullId);
		const canonical = locationUrl({id: fullId, query});
		if (canonical !== currentUrl) {
			void navigate(canonical);
		}
	}, [currentUrl, navigate, query, target, unknown, zoom]);

	useEffect(() => {
		setUrlSearchQuery(query);
	}, [query, setUrlSearchQuery]);

	return <OutlineView />;
}

/** `/node/:id` is a legacy alias: replace it with the hash URL, which resolves the id. */
function NodeRedirect() {
	const {id} = useParams<{id: string}>();
	return <Navigate replace to={id === undefined ? "/" : nodeUrl(id)} />;
}

export function App() {
	return (
		<ErrorBoundary>
			<QueryClientProvider client={queryClient}>
				<BrowserRouter>
					<div className="app">
						<Routes>
							<Route element={<HashLocationRoute />} path="/" />
							<Route element={<ChangesView />} path="/changes" />
							<Route element={<LadderView />} path="/ladder" />
							<Route element={<NodeRedirect />} path="/node/:id" />
						</Routes>
					</div>
				</BrowserRouter>
			</QueryClientProvider>
		</ErrorBoundary>
	);
}
