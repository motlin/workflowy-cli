import {createContext, useContext} from "react";
import {MAIN_PANE_ID, SIDE_PANE_ID, paneExpandedIds} from "../pane-ids.js";
import {useOutlineStore} from "../stores/outline.js";

/** The pane an outline renders in; bullet zooms inside a side pane zoom that pane instead of the main outline. */
export interface PaneContextValue {
	id: string;
	zoom: (zoomedId: string | null) => void;
}

/** Upstream's pane header bottom border, tinted while its pane is active. */
export const PANE_HEADER_ACTIVE_BORDER = "group-data-[pane-active=true]/pane:border-b-tint";

/** Null for the main outline, which zooms by navigating the URL. */
export const PaneContext = createContext<PaneContextValue | null>(null);

/** The id of the pane the caller renders in. */
export function usePaneId(): string {
	return useContext(PaneContext)?.id ?? MAIN_PANE_ID;
}

/** The expanded rows of the pane the caller renders in; each pane expands apart, like upstream's temporary mirror root. */
export function usePaneExpandedIds(): Set<string> {
	const paneId = usePaneId();
	return useOutlineStore((state) => paneExpandedIds(state, paneId));
}

/**
 * Whether the calling row renders in the active pane. Editing, the item selection and caret restoration show only
 * there, so a row visible in both panes edits in one.
 */
export function useInActivePane(): boolean {
	const paneId = usePaneId();
	return useOutlineStore((state) => state.activePaneId === paneId);
}

/** Upstream's pane focus tracking: a pointerdown or focusin anywhere in the pane makes it the active pane. */
export function paneActivation(
	paneId: string,
	setActivePane: (paneId: string) => void,
): {onPointerDown: () => void; onFocus: () => void} {
	const activate = () => {
		setActivePane(paneId);
	};
	return {onPointerDown: activate, onFocus: activate};
}

/** The side pane's CSS width: half the window beside the left bar, never under upstream's 350px pane minimum. */
export function sidePaneWidth(leftOffset: number): string {
	return `max(350px, calc((100vw - ${leftOffset}px) / 2))`;
}

/** The side pane scrolls its own outline, so its zooms scroll that scroller rather than the window. */
export function scrollSidePaneToTop(): void {
	document.querySelector(`[data-pane-id="${SIDE_PANE_ID}"] .side-pane-scroller`)?.scrollTo(0, 0);
}
