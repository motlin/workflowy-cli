/** Whether a row shows its children, and whether a search decides that. */
export interface RowExpansion {
	expanded: boolean;
	searching: boolean;
}

/**
 * The `.children` slide for a row whose expansion changed: down on expand, up on collapse. Entering or leaving a
 * search swaps the whole outline's expansion at once and does not slide, since a slide-up keeps every collapsed
 * row's children mounted and re-rendered, which froze the tab on Back out of a broad search.
 */
export function expansionSlide(previous: RowExpansion, next: RowExpansion): "down" | "up" | null {
	if (previous.searching !== next.searching || previous.expanded === next.expanded) {
		return null;
	}
	return next.expanded ? "down" : "up";
}
