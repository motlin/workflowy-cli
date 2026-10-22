/**
 * Upstream's pane workspace width maths (`W2.paneWidth`, `rebalanceWidths`, `resizeToAvailableWidth`,
 * `resizePaneFromLeft`, `paneWidthPercent`, `paneWidthFromPercent`). Widths are listed in workspace order, the main pane
 * first; each pane renders as `flex: <width> 1 0px` with a 350px minimum, so widths act as shares of the workspace and
 * the workspace scrolls sideways once the minimums outgrow it.
 */

/** Upstream `Zn`: no pane gets narrower than this. */
export const MIN_PANE_WIDTH = 350;
/** Upstream `Au1`: the width of a pane with no usable width, and the window width before there is a window. */
export const DEFAULT_PANE_WIDTH = 380;

/** Upstream `paneWidth`: a finite width floored at the minimum, else `fallback` floored at the minimum. */
export function paneWidth(width: unknown, fallback = DEFAULT_PANE_WIDTH): number {
	return typeof width === "number" && Number.isFinite(width)
		? Math.max(MIN_PANE_WIDTH, width)
		: Math.max(MIN_PANE_WIDTH, fallback);
}

/** Upstream `availableWidth`: the window width beside the left bar, never under one pane's minimum. */
export function availablePaneWidth(windowWidth: number | undefined, leftOffset: number): number {
	return Math.max(MIN_PANE_WIDTH, (windowWidth ?? DEFAULT_PANE_WIDTH) - leftOffset);
}

/** Upstream `rebalanceWidths`: every one of `count` panes gets an equal floored share of `available`. */
export function rebalancedWidths(count: number, available: number): number[] {
	const width = Math.max(MIN_PANE_WIDTH, Math.floor(available / count));
	return Array.from({length: count}, () => width);
}

function total(widths: readonly number[]): number {
	return paneWidth(
		widths.reduce((sum, width) => sum + paneWidth(width), 0),
		MIN_PANE_WIDTH,
	);
}

/** Upstream `resizeToAvailableWidth` (window resize): every pane keeps its share of the new available width. */
export function scaledWidths(widths: readonly number[], available: number): number[] {
	const sum = total(widths);
	const target = paneWidth(available, MIN_PANE_WIDTH);
	return widths.map((width) => paneWidth(Math.round((target * paneWidth(width)) / sum)));
}

/** The two widths either side of a divider when its drag began (upstream `leftResizeSnapshot`). */
export interface LeftResizeStart {
	previousWidth: number;
	paneWidth: number;
}

/**
 * Upstream `resizePaneFromLeft`: dragging the divider on pane `index`'s left edge by `delta` pixels trades width with
 * its left neighbour, measured from the widths at the drag's start, each side stopping at the minimum. Null for the
 * main pane, which has no divider on its left.
 */
export function resizedFromLeft(
	widths: readonly number[],
	index: number,
	start: LeftResizeStart,
	delta: number,
): number[] | null {
	if (index <= 0 || index >= widths.length) {
		return null;
	}
	const moved = Math.max(MIN_PANE_WIDTH - start.previousWidth, Math.min(start.paneWidth - MIN_PANE_WIDTH, delta));
	const next = [...widths];
	next[index - 1] = Math.max(MIN_PANE_WIDTH, start.previousWidth + moved);
	next[index] = Math.max(MIN_PANE_WIDTH, start.paneWidth - moved);
	return next;
}

/** Upstream `paneWidthPercent`: each pane's share of the total, as `pane-workspace-runtime:v1` stores it. */
export function widthPercents(widths: readonly number[]): number[] {
	const sum = total(widths);
	return widths.map((width) => Number(((paneWidth(width) / sum) * 100).toFixed(4)));
}

/** Upstream `paneWidthFromPercent`: a stored share of `available`, or the fallback width for an unusable share. */
export function widthFromPercent(percent: unknown, available: number): number {
	if (typeof percent !== "number" || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
		return paneWidth(DEFAULT_PANE_WIDTH);
	}
	return paneWidth(Math.floor((available * percent) / 100));
}
