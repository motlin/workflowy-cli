/**
 * Drag maths shared by mouse and touch.
 *
 * The page started out on HTML5 drag-and-drop, which never fires from a touch
 * screen -- on a phone the gesture fell through to the browser's own handling
 * and selected the row's text instead of moving it. Pointer events cover both
 * inputs, at the cost of having to decide for ourselves when a press has become
 * a drag and when to scroll the page.
 */

export interface Point {
	x: number;
	y: number;
}

/** Below this, a press is a tap. A fingertip wobbles more than a mouse does. */
export const DRAG_THRESHOLD_PX = 6;

export function isDragGesture(from: Point, to: Point): boolean {
	return Math.hypot(to.x - from.x, to.y - from.y) > DRAG_THRESHOLD_PX;
}

/** How close to an edge the pointer has to get before the page starts moving. */
const EDGE_PX = 80;
const MAX_SPEED_PX = 18;

/**
 * Pixels to scroll this frame, given where the pointer is. Without this a tier
 * holding a hundred rows cannot be dragged out of on a phone: the destination
 * is always off screen and a finger that is holding a row cannot also scroll.
 */
export function autoScrollBy(pointerY: number, viewportHeight: number): number {
	if (pointerY < EDGE_PX) {
		return -Math.round(MAX_SPEED_PX * ((EDGE_PX - pointerY) / EDGE_PX));
	}
	const fromBottom = viewportHeight - pointerY;
	if (fromBottom < EDGE_PX) {
		return Math.round(MAX_SPEED_PX * ((EDGE_PX - fromBottom) / EDGE_PX));
	}
	return 0;
}

export interface EdgeAutoscrollInput {
	pointerY: number;
	scrollerTop: number;
	scrollerHeight: number;
	/** Where the drag began, relative to the scroller's top. */
	startY: number;
	haveScrolled: boolean;
	mobile: boolean;
}

const EDGE_ZONE_FRACTION = 0.15;
const DESKTOP_MAX_SPEED_PX_PER_S = 1250;
const MOBILE_MAX_SPEED_PX_PER_S = 1000;

/**
 * Upstream's outline autoscroll, in px/s. Each edge zone is 15% of the scroller
 * and speed rises quadratically toward the edge. A zone only arms once the
 * pointer has moved toward it from the drag start (or once anything has
 * scrolled), so grabbing a row that already sits in a zone does not lurch.
 */
export function edgeAutoscrollSpeed(input: EdgeAutoscrollInput): number {
	const {pointerY, scrollerTop, scrollerHeight, startY, haveScrolled, mobile} = input;
	const zone = EDGE_ZONE_FRACTION * scrollerHeight;
	const maxSpeed = mobile ? MOBILE_MAX_SPEED_PX_PER_S : DESKTOP_MAX_SPEED_PX_PER_S;
	const offset = pointerY - scrollerTop;
	const speedAt = (distance: number): number => Math.round(maxSpeed * (1 - distance / zone) ** 2);
	if (offset < zone && (haveScrolled || offset < startY)) {
		return -speedAt(Math.max(0, offset));
	}
	const fromBottom = scrollerHeight - offset;
	if (fromBottom < zone && (haveScrolled || offset > startY)) {
		return speedAt(Math.max(0, fromBottom));
	}
	return 0;
}

export interface DropTarget {
	tier: string;
	beforeNodeId: string;
}

export function dropAtPoint(x: number, y: number, moving: Set<string>): DropTarget | undefined {
	const element = document.elementFromPoint(x, y);
	const target = element?.closest<HTMLElement>("[data-tier]");
	if (!target?.dataset.tier) {
		return undefined;
	}
	const zone = target.classList.contains("ladder-zone") ? target : target.nextElementSibling;
	const rows = [...(zone?.querySelectorAll<HTMLElement>("[data-node-id]") ?? [])];
	const before = rows.find((row) => {
		if (row.dataset.nodeId === undefined || moving.has(row.dataset.nodeId)) {
			return false;
		}
		const bounds = row.getBoundingClientRect();
		return y < bounds.top + bounds.height / 2;
	});
	return {tier: target.dataset.tier, beforeNodeId: before?.dataset.nodeId ?? ""};
}
