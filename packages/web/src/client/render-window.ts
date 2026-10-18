/**
 * Chunked child rendering, after upstream `WF.VirtualScrolling.useMaxToRender`: each
 * `.children` container renders at most `maxToRender` rows and grows by one step when a
 * sentinel at its end scrolls into view.
 */
export const initialMaxToRender = 200;

/** The next render limit after the sentinel is reached, clamped to `total`. */
export function nextMaxToRender(current: number, total: number, step = 200): number {
	return Math.min(current + step, total);
}
