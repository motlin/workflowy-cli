import {QueryClient, QueryClientProvider, skipToken, useQuery} from "@tanstack/react-query";
import {useEffect} from "react";
import {BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams} from "react-router-dom";
import type {NodeResponse} from "../node-types.js";

import {ItemTypePickerHost} from "./components/item-type-picker-host.js";
import {AppMessages} from "./components/app-message.js";
import {ChangesView} from "./components/changes-view.js";
import {ErrorBoundary} from "./components/error-boundary.js";
import {ErrorNotifications} from "./components/error-notification.js";
import {ExportDialog} from "./components/export-dialog.js";
import {JumpMenu} from "./components/jump-menu.js";
import {LadderView} from "./components/ladder-view.js";
import {LeftBar} from "./components/left-sidebar.js";
import {LinkInsertModal} from "./components/link-insert-modal.js";
import {LocationPickerHost} from "./components/location-picker-host.js";
import {OfflineBanner} from "./components/offline-banner.js";
import {OutlineTree} from "./components/outline-tree.js";
import {PresentationMode} from "./components/presentation-mode.js";
import {RelatedNodesPanel} from "./components/related-nodes-panel.js";
import {RightBar} from "./components/right-bar.js";
import {SearchCountIndicator} from "./components/search-count-indicator.js";
import {Settings} from "./components/settings.js";
import {TopBar} from "./components/top-bar.js";
import {useExpansionSync} from "./hooks/use-expansion-sync.js";
import {useCommandRegistry} from "./hooks/use-command-registry.js";
import {useGlobalKeymap} from "./hooks/use-global-keymap.js";
import {useSearchEscape} from "./hooks/use-search-escape.js";
import {useTagColors} from "./hooks/use-tag-colors.js";
import {useShowKeyboardShortcutsSync} from "./hooks/use-right-bar-sync.js";
import {useShowCompletedSync} from "./hooks/use-show-completed-toggle.js";
import {installWindowBlurredClass} from "./window-blurred.js";
import {locationUrl, parseLocationHash} from "./location.js";
import {nodeUrl, resolveZoomTarget} from "./navigation.js";
import {nodeKeys} from "./node-cache.js";
import {readJson} from "./read-json.js";
import {buildTagColorCss} from "./tag-color-styles.js";
import {useOutlineStore} from "./stores/outline.js";
import {outlineViewClassName} from "./search-classes.js";
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
	const statusDigits = error.message.match(/(\d{3})/u)?.[1];
	if (statusDigits !== undefined) {
		const status = Math.trunc(Number(statusDigits));
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
	const {zoomedNodeId, relatedNodesPanelOpen, searchQuery} = useOutlineStore();

	// Register keyboard shortcuts
	const commands = useCommandRegistry();
	useGlobalKeymap(commands);
	useSearchEscape();
	const runCommand = (commandId: "undo" | "redo") => () => {
		commands[commandId]?.execute({items: [], zoomedId: zoomedNodeId});
	};

	const containerClasses = [
		"outline-container vertical-scrollable-container",
		relatedNodesPanelOpen && "with-related-panel",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div className={containerClasses}>
			<OfflineBanner />
			<TopBar onRedo={runCommand("redo")} onUndo={runCommand("undo")} />
			<LeftBar />
			<div className={outlineViewClassName(searchQuery)}>
				<OutlineTree parentId={zoomedNodeId} />
				<SearchCountIndicator />
			</div>
			<RightBar />
			<RelatedNodesPanel />
			<JumpMenu />
			<LinkInsertModal />
			<LocationPickerHost />
			<ExportDialog />
			<Settings />
			<PresentationMode />
			<ErrorNotifications />
			<AppMessages />
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

/** Upstream's generated tag color sheet: colors `.contentTag` spans by their lowercased `data-val`. */
function TagColorStyles() {
	return <style id="tags-None">{buildTagColorCss(useTagColors())}</style>;
}

/** Keeps show/hide completed in step with the account's `show_completed` setting. */
function ShowCompletedSync() {
	useShowCompletedSync();
	return null;
}

/** Keeps the right bar's shortcuts help in step with the account's `show_keyboard_shortcuts` setting. */
function ShowKeyboardShortcutsSync() {
	useShowKeyboardShortcutsSync();
	return null;
}

/** Hydrates expansion from the account (`/api/v1/expansion`) once on load. */
function ExpansionSync() {
	useExpansionSync();
	return null;
}

/** Dims item-selection tints while the window is blurred (`body.wf-dom-window-blurred`). */
function WindowBlurredClass() {
	useEffect(() => installWindowBlurredClass(window, document.body), []);
	return null;
}

export function App() {
	return (
		<ErrorBoundary>
			<QueryClientProvider client={queryClient}>
				<TagColorStyles />
				<WindowBlurredClass />
				<ShowCompletedSync />
				<ShowKeyboardShortcutsSync />
				<ExpansionSync />
				<ItemTypePickerHost />
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
