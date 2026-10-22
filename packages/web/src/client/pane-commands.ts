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

/** What the pane navigation commands read and drive: the outline store's pane slice and the main outline's actions. */
export interface PaneNavDeps {
	getState: () => {
		activePaneId: string;
		sidePane: {zoomedId: string | null} | null;
		zoomSidePane: (zoomedId: string | null) => void;
		sidePaneBack: () => void;
		sidePaneForward: () => void;
	};
	/** Commit the edited text before leaving. */
	commitEdit: () => void;
	/** Navigate the main outline home. */
	goHome: () => void;
	/** Step the main outline's Back/Forward stacks. */
	stepMain: (direction: "back" | "forward") => void;
	/** Open today's calendar page in the side pane when `inSidePane`, else in the main outline. */
	navigateToToday: (inSidePane: boolean) => Promise<void>;
	/** Zoom the side pane (when `inSidePane`) or the main outline to its zoom's sibling `step` places away. */
	jumpToSibling: (step: -1 | 1, inSidePane: boolean) => Promise<void>;
}

/**
 * Home (⌘'), Today (⌃T), Back/Forward and `navigate_to_prev_item` / `navigate_to_next_item` (⇧⌘9 / ⇧⌘0) act on the
 * active pane, as upstream: while the side pane is active they zoom it and step its own history, else they navigate the
 * main outline.
 */
export function paneNavCommands(deps: PaneNavDeps): CommandRegistry {
	const sidePaneActive = (): boolean => {
		const {activePaneId, sidePane} = deps.getState();
		return activePaneId === SIDE_PANE_ID && sidePane !== null;
	};
	const step = (direction: "back" | "forward") => ({
		execute() {
			deps.commitEdit();
			if (!sidePaneActive()) {
				deps.stepMain(direction);
			} else if (direction === "back") {
				deps.getState().sidePaneBack();
			} else {
				deps.getState().sidePaneForward();
			}
		},
	});
	const jump = (offset: -1 | 1) => ({
		execute() {
			void deps.jumpToSibling(offset, sidePaneActive());
		},
	});
	return {
		navigate_home: {
			execute() {
				deps.commitEdit();
				if (sidePaneActive()) {
					deps.getState().zoomSidePane(null);
				} else {
					deps.goHome();
				}
			},
		},
		navigate_backward: step("back"),
		navigate_forward: step("forward"),
		navigate_to_today: {
			execute() {
				void deps.navigateToToday(sidePaneActive());
			},
		},
		navigate_to_prev_item: jump(-1),
		navigate_to_next_item: jump(1),
	};
}
