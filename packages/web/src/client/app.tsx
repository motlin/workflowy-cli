import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useEffect} from 'react';
import {BrowserRouter, Route, Routes, useParams} from 'react-router-dom';

import {ChangesView} from './components/changes-view.js';
import {ErrorBoundary} from './components/error-boundary.js';
import {ErrorNotifications} from './components/error-notification.js';
import {ExportDialog} from './components/export-dialog.js';
import {JumpMenu} from './components/jump-menu.js';
import {LeftSidebar} from './components/left-sidebar.js';
import {LinkInsertModal} from './components/link-insert-modal.js';
import {LoadingOverlay} from './components/loading-spinner.js';
import {MoveAssistant} from './components/move-assistant.js';
import {OfflineBanner} from './components/offline-banner.js';
import {OutlineTree} from './components/outline-tree.js';
import {PresentationMode} from './components/presentation-mode.js';
import {RelatedNodesPanel} from './components/related-nodes-panel.js';
import {RightSidebar} from './components/right-sidebar.js';
import {SearchPanel} from './components/search-panel.js';
import {Settings} from './components/settings.js';
import {TopBar} from './components/top-bar.js';
import {useKeyboardShortcuts} from './hooks/use-keyboard-shortcuts.js';
import {useOutlineStore} from './stores/outline.js';
import './styles.css';

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
	const statusMatch = error.message.match(/(\d{3})/);
	if (statusMatch) {
		const status = Number.parseInt(statusMatch[1], 10);
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
	const {zoomedNodeId, leftSidebarOpen, rightSidebarOpen, relatedNodesPanelOpen, isMutating} = useOutlineStore();

	// Register keyboard shortcuts
	useKeyboardShortcuts();

	const containerClasses = [
		'outline-container',
		leftSidebarOpen && 'with-sidebar',
		rightSidebarOpen && 'with-right-sidebar',
		relatedNodesPanelOpen && 'with-related-panel',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<div className={containerClasses}>
			<OfflineBanner />
			<TopBar />
			<LeftSidebar />
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

function RootRoute() {
	const zoom = useOutlineStore((state) => state.zoom);

	useEffect(() => {
		zoom(null);
	}, [zoom]);

	return <OutlineView />;
}

function NodeRoute() {
	const {id} = useParams<{id: string}>();
	const zoom = useOutlineStore((state) => state.zoom);

	useEffect(() => {
		if (id) {
			zoom(id);
		}
	}, [id, zoom]);

	return <OutlineView />;
}

/**
 * Hook for navigating between nodes.
 * Uses react-router's navigate() which updates the URL and triggers browser history.
 * The RootRoute and NodeRoute components sync URL changes to the zoom store state.
 */

export function App() {
	return (
		<ErrorBoundary>
			<QueryClientProvider client={queryClient}>
				<BrowserRouter>
					<div className="app">
						<Routes>
							<Route
								element={<RootRoute />}
								path="/"
							/>
							<Route
								element={<ChangesView />}
								path="/changes"
							/>
							<Route
								element={<NodeRoute />}
								path="/node/:id"
							/>
						</Routes>
					</div>
				</BrowserRouter>
			</QueryClientProvider>
		</ErrorBoundary>
	);
}
