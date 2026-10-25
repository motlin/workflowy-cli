import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {memo, useEffect, useState} from "react";
import {createPortal} from "react-dom";
import {BrowserRouter, Navigate, Route, Routes, useParams} from "react-router-dom";

import {ItemColorPopupHost} from "./components/item-color-popup-host.js";
import {MenusHost} from "./components/menus-host.js";
import {AppMessages} from "./components/app-message.js";
import {GuiBanner} from "./components/gui-banner.js";
import {ChangesView} from "./components/changes-view.js";
import {ErrorBoundary} from "./components/error-boundary.js";
import {ErrorNotifications} from "./components/error-notification.js";
import {ExportDialog} from "./components/export-dialog.js";
import {MirrorsDialogHost} from "./components/mirrors-dialog.js";
import {AlertDialog} from "./components/alert-dialog.js";
import {setTableCellProbe} from "./item-type-select.js";
import {cachedTableRole} from "./table-cache.js";
import {JumpMenu} from "./components/jump-menu.js";
import {LadderView} from "./components/ladder-view.js";
import {LeftBar} from "./components/left-sidebar.js";
import {LinkPopupHost} from "./components/link-popup-host.js";
import {LocationPickerHost} from "./components/location-picker-host.js";
import {SelectionMenu} from "./components/selection-menu.js";
import {OfflineBanner} from "./components/offline-banner.js";
import {OutlineTree} from "./components/outline-tree.js";
import {PresentationMode} from "./components/presentation-mode.js";
import {RelatedNodesPanel} from "./components/related-nodes-panel.js";
import {RightBar} from "./components/right-bar.js";
import {SearchCountIndicator} from "./components/search-count-indicator.js";
import {Settings} from "./components/settings.js";
import {
	DocumentEnd,
	MainPane,
	PANE_SCROLLER_CLASS,
	PANE_SCROLLER_STYLE,
	PaneWorkspace,
	SidePanes,
} from "./components/side-pane.js";
import {TopBar} from "./components/top-bar.js";
import {useExpansionSync} from "./hooks/use-expansion-sync.js";
import {useCommandRegistry} from "./hooks/use-command-registry.js";
import {StableNavigateProvider} from "./hooks/use-stable-navigate.js";
import {useCopyCut} from "./hooks/use-copy-cut.js";
import {activeCommandRegistry, useGlobalKeymap} from "./hooks/use-global-keymap.js";
import {usePaneUrlSync} from "./hooks/use-pane-url-sync.js";
import {fetchResolvedId, useHashLocationZoom} from "./hooks/use-hash-location-zoom.js";
import {installContentLinkContextMenu} from "./content-link-click.js";
import {useContentLinkClicks} from "./hooks/use-content-link-clicks.js";
import {useSearchEscape} from "./hooks/use-search-escape.js";
import {usePreferences} from "./hooks/use-preferences.js";
import {useTagColors} from "./hooks/use-tag-colors.js";
import {useShowKeyboardShortcutsSync} from "./hooks/use-right-bar-sync.js";
import {useShowCompletedSync} from "./hooks/use-show-completed-toggle.js";
import {installWindowBlurredClass} from "./window-blurred.js";
import {installCoalescingTimeoutProvider} from "./coalescing-timers.js";
import {nodeUrl, useEmptyDayCleanup} from "./navigation.js";
import {installLinkStatusBar} from "./link-status-bar.js";
import {linkColorCss} from "./link-color-style.js";
import {buildTagColorCss} from "./tag-color-styles.js";
import {useOutlineViewState} from "./hooks/use-outline-view-state.js";
import {useOutlineStore} from "./stores/outline.js";
import {outlineViewClassName} from "./search-classes.js";
import {pageClassName, pageContainerClassName, pageStyle} from "./page-style.js";
import {shouldClearSelectionOnPageMouseDown} from "./page-mousedown.js";
import {useRowHoverController} from "./hooks/use-row-hover.js";
import {installSaveTracking} from "./hooks/use-saving.js";
import {queryClientDefaults} from "./query-retry.js";
import "./reset.css";
import "./wf-tailwind.css";
import "./styles.css";

// Before any query exists: a navigation mounts hundreds of observers, each arming a stale timer.
installCoalescingTimeoutProvider();

const queryClient = new QueryClient({defaultOptions: queryClientDefaults});
setTableCellProbe((nodeId) => cachedTableRole(queryClient, nodeId) === "cell");
installSaveTracking(queryClient, window);

/**
 * Registers the keyboard shortcuts. The command registry follows the edited and zoomed nodes, so it lives in this
 * empty leaf: its re-renders on every edit and save stay here instead of re-rendering the whole page.
 */
function GlobalCommands() {
	useGlobalKeymap(useCommandRegistry());
	useCopyCut();
	useSearchEscape();
	useRowHoverController();
	return null;
}

/** The page shell. Memoized, so a URL change re-renders it only through the store fields it selects. */
/** `window.innerWidth`, tracked on resize: upstream feeds it to the page padding. */
function useInnerWidth(): number {
	const [width, setWidth] = useState(() => window.innerWidth);
	useEffect(() => {
		const onResize = () => {
			setWidth(window.innerWidth);
		};
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("resize", onResize);
		};
	}, []);
	return width;
}

function clearSelectionOnPageMouseDown(event: React.MouseEvent<HTMLDivElement>): void {
	const target = event.target instanceof Element ? event.target : null;
	const {itemSelection, clearItemSelection} = useOutlineStore.getState();
	const bullet = target?.closest(".bullet");
	const bulletRow = bullet?.closest(".project");
	if (
		shouldClearSelectionOnPageMouseDown({
			selectionActive: itemSelection.entries.length > 0,
			button: event.button,
			meta: event.metaKey,
			alt: event.altKey,
			ctrl: event.ctrlKey,
			shift: event.shiftKey,
			onSelectedBullet: bulletRow?.classList.contains("addedToSelection") === true,
		})
	) {
		clearItemSelection();
	}
}

export interface PageShellProps {
	zoomedNodeId: string | null;
	fullWidth: boolean;
	/** `window.innerWidth`. */
	width: number;
	searching: boolean;
	showCompleted: boolean;
}

/** Upstream's `.pageContainer > .page` around the main outline (no pane open). Hook-free, so it adds no fiber. */
export function pageShell({zoomedNodeId, fullWidth, width, searching, showCompleted}: PageShellProps) {
	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- upstream clears the item selection on any plain press in the container
		<div className={pageContainerClassName()} onMouseDown={clearSelectionOnPageMouseDown}>
			<div className={pageClassName({searching, showCompleted})} style={pageStyle({fullWidth, width, searching})}>
				<OutlineTree parentId={zoomedNodeId} shell="page" />
				<SearchCountIndicator />
			</div>
		</div>
	);
}

/** The main pane's outline under its zoom, styled by its search: the part of the page a zoom or search re-renders. */
function MainOutline() {
	const zoomedNodeId = useOutlineStore((state) => state.zoomedNodeId);
	const searchQuery = useOutlineStore((state) => state.searchQuery);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const width = useInnerWidth();
	// With a pane open the main outline scrolls itself, like each pane, instead of the document.
	const panesOpen = useOutlineStore((state) => state.panes.length > 0);
	if (!panesOpen) {
		return pageShell({zoomedNodeId, fullWidth: true, width, searching: searchQuery !== "", showCompleted});
	}
	return (
		<div className="relative flex flex-1 min-h-0 flex-col">
			<div
				className={`${outlineViewClassName(searchQuery)} ${PANE_SCROLLER_CLASS}`}
				data-full-width-boundary="true"
				style={PANE_SCROLLER_STYLE}
			>
				<OutlineTree parentId={zoomedNodeId} />
				<SearchCountIndicator />
				<DocumentEnd />
			</div>
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
			<AlertDialog />
			<LinkPopupHost />
			<LocationPickerHost />
			<SelectionMenu />
			<ExportDialog />
			<MirrorsDialogHost />
			<Settings />
			<PresentationMode />
			<ErrorNotifications />
			<AppMessages />
			<GuiBanner />
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
	return createPortal(<style id="tags-None">{buildTagColorCss(useTagColors())}</style>, document.head);
}

/** Upstream's injected `.contentLink` color sheet, rebuilt from the account's External link style setting. */
function LinkColorStyles() {
	const {preferences} = usePreferences();
	return createPortal(<style id="link-colors">{linkColorCss(preferences.sameColorForLinks)}</style>, document.head);
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
	useEffect(() => installContentLinkContextMenu(document), []);
	useEffect(() => installLinkStatusBar(document), []);
	return null;
}

export function App() {
	return (
		<ErrorBoundary>
			<QueryClientProvider client={queryClient}>
				<TagColorStyles />
				<LinkColorStyles />
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
						<ItemColorPopupHost />
					</StableNavigateProvider>
				</BrowserRouter>
			</QueryClientProvider>
		</ErrorBoundary>
	);
}
