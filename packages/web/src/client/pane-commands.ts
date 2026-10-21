import type {CommandRegistry} from "./keys/dispatch.js";
import {SIDE_PANE_ID} from "./pane-ids.js";

/** The slice of the outline store the pane commands read and drive. */
export interface PaneCommandStore {
	getState: () => {
		sidePane: {zoomedId: string | null} | null;
		openSidePane: (zoomedId: string | null) => void;
		closeSidePane: () => void;
	};
}

/**
 * Upstream's `new_pane` (⌃R) and `close_pane` (⌃⌘W). New pane opens a pane on the active pane's zoom; locally that is
 * the main outline's, and only while no pane is open since the first slice supports one side pane. Close pane closes
 * it. Both combos stay claimed when the command has nothing to do, so ⌃R never reloads the page.
 */
export function paneCommands(store: PaneCommandStore): CommandRegistry {
	return {
		new_pane: {
			execute(ctx) {
				const {sidePane, openSidePane} = store.getState();
				if (sidePane === null) {
					openSidePane(ctx.zoomedId);
				}
			},
		},
		close_pane: {
			execute() {
				const {sidePane, closeSidePane} = store.getState();
				if (sidePane !== null) {
					closeSidePane();
				}
			},
		},
	};
}

/** The slice of the outline store Open in Pane drives. */
export interface OpenInPaneState {
	sidePane: {zoomedId: string | null} | null;
	openSidePane: (zoomedId: string | null) => void;
	zoomSidePane: (zoomedId: string | null) => void;
	setActivePane: (paneId: string) => void;
}

/**
 * Upstream's `open_in_pane` (bullet menu, ⌘-click on an internal link): open a pane on the item next to the source pane
 * and focus it. The first slice supports one side pane, so an open pane is zoomed to the item and focused instead.
 */
export function openInPane(state: OpenInPaneState, nodeId: string): void {
	if (state.sidePane === null) {
		state.openSidePane(nodeId);
		return;
	}
	state.zoomSidePane(nodeId);
	state.setActivePane(SIDE_PANE_ID);
}
