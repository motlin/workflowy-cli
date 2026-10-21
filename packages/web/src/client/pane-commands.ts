import type {CommandRegistry} from "./keys/dispatch.js";

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
