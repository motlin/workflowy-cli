import type {CommandRegistry} from "./keys/dispatch.js";
import {MAIN_PANE_ID, findPane, paneMoveIndex} from "./pane-ids.js";
import type {OpenPaneOptions} from "./stores/outline.js";

/** The slice of the outline store the pane commands read and drive. */
export interface PaneCommandStore {
	getState: () => {
		panes: readonly {id: string; zoomedId: string | null}[];
		activePaneId: string;
		zoomedNodeId: string | null;
		openPane: (zoomedId: string | null, options?: OpenPaneOptions) => string;
		closePane: (paneId: string) => void;
	};
	/** Close the main pane: the first pane becomes the main outline (its zoom navigates the URL). */
	closeMainPane: () => void;
	/** Move pane `paneId` (`main` for the main pane) to workspace index `index`, navigating when the main pane changes. */
	movePane: (paneId: string, index: number) => void;
}

/**
 * Upstream's `new_pane` (⌃R), `close_pane` (⌃⌘W), and the unbound `move_pane_left` / `move_pane_right` (header kebab). New pane opens a pane on the active pane's zoom after the last
 * pane, from the active pane. Close pane closes the active pane; closing the main pane makes the first pane the main
 * outline. Both combos stay claimed when the command has nothing to do, so ⌃R never reloads the page.
 */
export function paneCommands(store: PaneCommandStore): CommandRegistry {
	return {
		new_pane: {
			execute() {
				const {panes, activePaneId, zoomedNodeId, openPane} = store.getState();
				const active = findPane(panes, activePaneId);
				openPane(active === undefined ? zoomedNodeId : active.zoomedId, {
					sourcePaneId: active === undefined ? MAIN_PANE_ID : active.id,
				});
			},
		},
		close_pane: {
			execute() {
				const {panes, activePaneId, closePane} = store.getState();
				if (panes.length === 0) {
					return;
				}
				if (findPane(panes, activePaneId) === undefined) {
					store.closeMainPane();
				} else {
					closePane(activePaneId);
				}
			},
		},
		move_pane_left: movePaneCommand(store, "left"),
		move_pane_right: movePaneCommand(store, "right"),
	};
}

/** Upstream's `move_pane_left` / `move_pane_right`: move the active pane one place, while `canPlacePane` allows it. */
function movePaneCommand(store: PaneCommandStore, direction: "left" | "right") {
	const target = (): number | null => {
		const state = store.getState();
		return paneMoveIndex(state, state.activePaneId, direction);
	};
	return {
		available: () => target() !== null,
		execute() {
			const index = target();
			if (index !== null) {
				store.movePane(store.getState().activePaneId, index);
			}
		},
	};
}

/** The slice of the outline store Open in Pane drives. */
export interface OpenInPaneState {
	panes: readonly {id: string}[];
	activePaneId: string;
	openPane: (zoomedId: string | null, options?: OpenPaneOptions) => string;
}

/**
 * Upstream's `open_in_pane` (bullet menu, ⌘-click on an internal link): open a new pane on the item right after the
 * source pane (the active pane by default; the link's pane for a ⌘-click) and focus it.
 */
export function openInPane(state: OpenInPaneState, nodeId: string, sourcePaneId = state.activePaneId): void {
	const index = state.panes.findIndex((pane) => pane.id === sourcePaneId);
	state.openPane(nodeId, {
		index: index + 2,
		sourcePaneId: index === -1 ? MAIN_PANE_ID : sourcePaneId,
	});
}

/** What the pane navigation commands read and drive: the outline store's pane slice and the main outline's actions. */
export interface PaneNavDeps {
	getState: () => {
		activePaneId: string;
		panes: readonly {id: string}[];
		zoomPane: (paneId: string, zoomedId: string | null) => void;
		paneBack: (paneId: string) => void;
		paneForward: (paneId: string) => void;
	};
	/** Commit the edited text before leaving. */
	commitEdit: () => void;
	/** Navigate the main outline home. */
	goHome: () => void;
	/** Step the main outline's Back/Forward stacks. */
	stepMain: (direction: "back" | "forward") => void;
	/** Open today's calendar page in pane `paneId`, or in the main outline for null. */
	navigateToToday: (paneId: string | null) => Promise<void>;
	/** Zoom pane `paneId` (the main outline for null) to its zoom's sibling `step` places away. */
	jumpToSibling: (step: -1 | 1, paneId: string | null) => Promise<void>;
}

/**
 * Home (⌘'), Today (⌃T), Back/Forward and `navigate_to_prev_item` / `navigate_to_next_item` (⇧⌘9 / ⇧⌘0) act on the
 * active pane, as upstream: while an open pane is active they zoom it and step its own history, else they navigate the
 * main outline.
 */
export function paneNavCommands(deps: PaneNavDeps): CommandRegistry {
	const activePane = (): string | null => {
		const {activePaneId, panes} = deps.getState();
		return findPane(panes, activePaneId)?.id ?? null;
	};
	const step = (direction: "back" | "forward") => ({
		execute() {
			deps.commitEdit();
			const paneId = activePane();
			if (paneId === null) {
				deps.stepMain(direction);
			} else if (direction === "back") {
				deps.getState().paneBack(paneId);
			} else {
				deps.getState().paneForward(paneId);
			}
		},
	});
	const jump = (offset: -1 | 1) => ({
		execute() {
			void deps.jumpToSibling(offset, activePane());
		},
	});
	return {
		navigate_home: {
			execute() {
				deps.commitEdit();
				const paneId = activePane();
				if (paneId === null) {
					deps.goHome();
				} else {
					deps.getState().zoomPane(paneId, null);
				}
			},
		},
		navigate_backward: step("back"),
		navigate_forward: step("forward"),
		navigate_to_today: {
			execute() {
				void deps.navigateToToday(activePane());
			},
		},
		navigate_to_prev_item: jump(-1),
		navigate_to_next_item: jump(1),
	};
}
