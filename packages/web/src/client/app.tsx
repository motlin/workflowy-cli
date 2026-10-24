import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {memo, useEffect} from "react";
import {BrowserRouter, Navigate, Route, Routes, useParams} from "react-router-dom";

import {MenusHost} from "./components/menus-host.js";
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
import {MainPane, PaneWorkspace, SidePanes} from "./components/side-pane.js";
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
import {installCoalescingTimeoutProvider} from "./coalescing-timers.js";
import {nodeUrl, useEmptyDayCleanup} from "./navigation.js";
import {buildTagColorCss} from "./tag-color-styles.js";
import {useOutlineViewState} from "./hooks/use-outline-view-state.js";
import {useOutlineStore} from "./stores/outline.js";
import {outlineViewClassName} from "./search-classes.js";
import {installSaveTracking} from "./hooks/use-saving.js";
import {queryClientDefaults} from "./query-retry.js";
import "./reset.css";
import "./wf-tailwind.css";
import "./styles.css";

// Before any query exists: a navigation mounts hundreds of observers, each arming a stale timer.
installCoalescingTimeoutProvider();

const queryClient = new QueryClient({defaultOptions: queryClientDefaults});
installSaveTracking(queryClient, window);

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
/** The main pane's outline under its zoom, styled by its search: the part of the page a zoom or search re-renders. */
function MainOutline() {
	const zoomedNodeId = useOutlineStore((state) => state.zoomedNodeId);
	const searchQuery = useOutlineStore((state) => state.searchQuery);
	// With a pane open the main outline scrolls itself, like each pane, instead of the document.
	const panesOpen = useOutlineStore((state) => state.panes.length > 0);
	return (
		<div className={`${outlineViewClassName(searchQuery)}${panesOpen ? " vertical-scrollable-container" : ""}`}>
			<OutlineTree parentId={zoomedNodeId} />
			<SearchCountIndicator />
		</div>
	);
}

/** Undo and redo from the header, for the main outline's zoom when pressed. */
function undoFromHeader(): void {
	activeCommandRegistry().undo?.execute({items: [], zoomedId: useOutlineStore.getState().zoomedNodeId});
}

function redoFromHeader(): void {
	activeCommandRegistry().redo?.execute({items: [], zoomedId: useOutlineStore.getState().zoomedNodeId});
}

export const OutlineView = memo(function OutlineView() {
	const {relatedNodesPanelOpen, paneCount} = useOutlineViewState();

	const containerClasses = [
		"outline-container",
		relatedNodesPanelOpen && "with-related-panel",
		paneCount > 0 && "with-side-pane",
	]
		.filter(Boolean)
		.join(" ");
	return (
		<div className={containerClasses}>
			<OfflineBanner />
			<PaneWorkspace>
				<MainPane>
					<TopBar onRedo={redoFromHeader} onUndo={undoFromHeader} />
					<LeftBar />
					<MainOutline />
				</MainPane>
				<SidePanes onRedo={redoFromHeader} onUndo={undoFromHeader} />
			</PaneWorkspace>
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
				<MenusHost />
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
