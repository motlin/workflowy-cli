import {QueryClient, QueryClientProvider, timeoutManager} from "@tanstack/react-query";
import {memo, useCallback, useEffect} from "react";
import {BrowserRouter, Navigate, Route, Routes, useParams} from "react-router-dom";

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
import {MainPane, SidePanes} from "./components/side-pane.js";
import {sidePaneWidth} from "./components/pane-context.js";
import {TopBar} from "./components/top-bar.js";
import {useExpansionSync} from "./hooks/use-expansion-sync.js";
import {useCommandRegistry} from "./hooks/use-command-registry.js";
import {StableNavigateProvider} from "./hooks/use-stable-navigate.js";
import {activeCommandRegistry, useGlobalKeymap} from "./hooks/use-global-keymap.js";
import {usePaneUrlSync} from "./hooks/use-pane-url-sync.js";
import {fetchResolvedId, useHashLocationZoom} from "./hooks/use-hash-location-zoom.js";
import {useContentLinkClicks} from "./hooks/use-content-link-clicks.js";
import {useSearchEscape} from "./hooks/use-search-escape.js";
import {useTagColors} from "./hooks/use-tag-colors.js";
import {useShowKeyboardShortcutsSync} from "./hooks/use-right-bar-sync.js";
import {useShowCompletedSync} from "./hooks/use-show-completed-toggle.js";
import {installWindowBlurredClass} from "./window-blurred.js";
import {createCoalescingTimeoutProvider} from "./coalescing-timers.js";
import {nodeUrl, useEmptyDayCleanup} from "./navigation.js";
import {buildTagColorCss} from "./tag-color-styles.js";
import {useOutlineViewState} from "./hooks/use-outline-view-state.js";
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

// Before any query exists: a navigation mounts hundreds of observers, each arming a stale timer.
timeoutManager.setTimeoutProvider(createCoalescingTimeoutProvider());

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

/**
 * Registers the keyboard shortcuts. The command registry follows the edited and zoomed nodes, so it lives in this
 * empty leaf: its re-renders on every edit and save stay here instead of re-rendering the whole page.
 */
function GlobalCommands() {
	useGlobalKeymap(useCommandRegistry());
	useSearchEscape();
	return null;
}

/** The page shell. Memoized, so a URL change re-renders it only through the store fields it selects. */
export const OutlineView = memo(function OutlineView() {
	const {zoomedNodeId, relatedNodesPanelOpen, searchQuery, paneCount, leftBarOffset} = useOutlineViewState();
	const onUndo = useCallback(() => {
		activeCommandRegistry().undo?.execute({items: [], zoomedId: zoomedNodeId});
	}, [zoomedNodeId]);
	const onRedo = useCallback(() => {
		activeCommandRegistry().redo?.execute({items: [], zoomedId: zoomedNodeId});
	}, [zoomedNodeId]);

	const containerClasses = [
		"outline-container",
		relatedNodesPanelOpen && "with-related-panel",
		paneCount > 0 && "with-side-pane",
	]
		.filter(Boolean)
		.join(" ");
	// Upstream's rebalanceWidths: every pane, the main one included, gets an equal share of the width beside the left
	// bar, at least 350px; the open panes together take `--side-panes-width` from the main outline.
	const paneStyle =
		paneCount > 0
			? {
					["--side-pane-width" as string]: sidePaneWidth(leftBarOffset, paneCount),
					["--side-panes-width" as string]: `calc(var(--side-pane-width) * ${paneCount})`,
				}
			: undefined;

	return (
		<div className={containerClasses} style={paneStyle}>
			<OfflineBanner />
			<MainPane>
				<TopBar onRedo={onRedo} onUndo={onUndo} />
				<LeftBar />
				<div className={outlineViewClassName(searchQuery)}>
					<OutlineTree parentId={zoomedNodeId} />
					<SearchCountIndicator />
				</div>
			</MainPane>
			<SidePanes onRedo={onRedo} onUndo={onUndo} />
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
			{/* Last, so its window keydown listeners register after every other pane's, as when the page shell held them. */}
			<GlobalCommands />
		</div>
	);
});

/** The `/` route: the outline zoomed to the node the `#/<id>?q=` hash names (see `useHashLocationZoom`). */
function HashLocationRoute() {
	useHashLocationZoom();
	useEmptyDayCleanup();
	usePaneUrlSync(fetchResolvedId);
	useContentLinkClicks(fetchResolvedId);
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
				{/* Location updates render synchronously, in the same commit as the zoom a navigation sets in the store. */}
				<BrowserRouter useTransitions={false}>
					<StableNavigateProvider>
						<div className="app">
							<Routes>
								<Route element={<HashLocationRoute />} path="/" />
								<Route element={<ChangesView />} path="/changes" />
								<Route element={<LadderView />} path="/ladder" />
								<Route element={<NodeRedirect />} path="/node/:id" />
							</Routes>
						</div>
					</StableNavigateProvider>
				</BrowserRouter>
			</QueryClientProvider>
		</ErrorBoundary>
	);
}
