import {paneWidth, resizedFromLeft} from "./pane-widths.js";

interface ResizePointerEvent {
	clientX: number;
	pointerId: number;
	preventDefault: () => void;
	currentTarget: {
		setPointerCapture: (pointerId: number) => void;
		releasePointerCapture: (pointerId: number) => void;
	};
}

export interface PaneResizeDeps {
	/** Every pane's rendered width in workspace order, main first. */
	measure: () => number[];
	/** Store every pane's width in workspace order, main first. */
	setWidths: (widths: number[]) => void;
}

/**
 * The pointer handlers for the resize handle on the left edge of the pane at workspace `index`. Like upstream's
 * `leftResizeSnapshot`, pointerdown pins every pane to its rendered width; each move then trades width between the pane
 * and its left neighbour, measured from those widths, until pointerup.
 */
export function paneResizeHandlers(
	index: number,
	deps: PaneResizeDeps,
): {
	onPointerDown: (event: ResizePointerEvent) => void;
	onPointerMove: (event: ResizePointerEvent) => void;
	onPointerUp: (event: ResizePointerEvent) => void;
} {
	let drag: {widths: number[]; startX: number} | null = null;
	return {
		onPointerDown: (event) => {
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			const widths = deps.measure().map((width) => paneWidth(width));
			deps.setWidths(widths);
			drag = {widths, startX: event.clientX};
		},
		onPointerMove: (event) => {
			if (drag === null) {
				return;
			}
			const {widths, startX} = drag;
			const next = resizedFromLeft(
				widths,
				index,
				{previousWidth: widths[index - 1] ?? 0, paneWidth: widths[index] ?? 0},
				event.clientX - startX,
			);
			if (next !== null) {
				deps.setWidths(next);
			}
		},
		onPointerUp: (event) => {
			if (drag !== null) {
				drag = null;
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
		},
	};
}
