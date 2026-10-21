import {createContext} from "react";

/** The pane an outline renders in; bullet zooms inside a side pane zoom that pane instead of the main outline. */
export interface PaneContextValue {
	zoom: (zoomedId: string | null) => void;
}

/** Null for the main outline, which zooms by navigating the URL. */
export const PaneContext = createContext<PaneContextValue | null>(null);

/** The side pane's CSS width: half the window beside the left bar, never under upstream's 350px pane minimum. */
export function sidePaneWidth(leftOffset: number): string {
	return `max(350px, calc((100vw - ${leftOffset}px) / 2))`;
}
