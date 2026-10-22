import {useShallow} from "zustand/react/shallow";
import {useOutlineStore} from "../stores/outline.js";

/**
 * The outline store fields the page shell (OutlineView) lays itself out by. Selected shallowly, so editing, expansion
 * and the other per-row state never re-render the whole page.
 */
export function useOutlineViewState() {
	return useOutlineStore(
		useShallow((state) => ({
			zoomedNodeId: state.zoomedNodeId,
			relatedNodesPanelOpen: state.relatedNodesPanelOpen,
			searchQuery: state.searchQuery,
			paneCount: state.panes.length,
			leftBarOffset: state.leftBarOffset(),
		})),
	);
}
