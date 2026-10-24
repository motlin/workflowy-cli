// Pure equivalent of upstream ButtonMenu's popper setup: placement "bottom" or "bottom-start",
// preventOverflow {padding: 10, rootBoundary: "viewport", altAxis: true, tether: false}, no flip,
// no offset modifier. Popper measures the layout box without CSS margins, so the ButtonMenu
// margin-top gap does not take part in placement; it only shifts the rendered box down.

export type PopperPlacement = "bottom" | "bottom-start";

export interface PlacePopperInput {
	reference: {left: number; top: number; width: number; height: number};
	popper: {width: number; height: number};
	placement: PopperPlacement;
	viewport: {width: number; height: number};
}

export interface PopperPosition {
	x: number;
	y: number;
	placement: PopperPlacement;
}

const PADDING = 10;

// Popper's `within(min, value, max)`: min wins when the popper is larger than the padded boundary.
function within(min: number, value: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

export function placePopper({reference, popper, placement, viewport}: PlacePopperInput): PopperPosition {
	const baseX = placement === "bottom" ? reference.left + reference.width / 2 - popper.width / 2 : reference.left;
	const baseY = reference.top + reference.height;
	return {
		x: within(PADDING, baseX, viewport.width - PADDING - popper.width),
		y: within(PADDING, baseY, viewport.height - PADDING - popper.height),
		placement,
	};
}

/** Popper's `roundOffsets` + `mapToStyles` transform: device-pixel rounding, 2d form at dpr <= 1. */
export function popperTransform(x: number, y: number, dpr: number): string {
	const round = (value: number): number => Math.round(value * dpr) / dpr || 0;
	return dpr <= 1 ? `translate(${round(x)}px, ${round(y)}px)` : `translate3d(${round(x)}px, ${round(y)}px, 0px)`;
}

/** Popper's boundary: the root client box, which excludes a scrollbar (not `innerWidth/innerHeight`). */
export function popperViewport(doc: {documentElement: {clientWidth: number; clientHeight: number}}): {
	width: number;
	height: number;
} {
	return {width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight};
}
