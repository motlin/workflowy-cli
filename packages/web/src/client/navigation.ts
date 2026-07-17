import {useNavigate} from 'react-router-dom';

/**
 * The client route for a node view.
 *
 * Uses the full node UUID, not the 12-char short id: the `/node/:id` route stores
 * its raw `id` param as `zoomedNodeId`, which is compared directly against node
 * `id`s throughout the app (e.g. zoomed sibling navigation). A short id in the URL
 * would never match those full ids, silently breaking that navigation. Every
 * `/node/` link must go through this helper so the form stays consistent.
 */
export function nodeRoute(nodeId: string): string {
	return `/node/${nodeId}`;
}

export function useNodeNavigation() {
	const navigate = useNavigate();

	return {
		navigateToNode: (nodeId: string | null) => {
			void navigate(nodeId === null ? '/' : nodeRoute(nodeId));
		},
		navigateToRoot: () => void navigate('/'),
	};
}
