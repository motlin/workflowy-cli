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

export interface DropTarget {
	tier: string;
	beforeNodeId: string;
}

export function dropAtPoint(x: number, y: number, moving: Set<string>): DropTarget | undefined {
	const element = document.elementFromPoint(x, y);
	const target = element?.closest<HTMLElement>('[data-tier]');
	if (!target?.dataset.tier) return;
	const zone = target.classList.contains('ladder-zone') ? target : target.nextElementSibling;
	const rows = Array.from(zone?.querySelectorAll<HTMLElement>('[data-node-id]') ?? []);
	const before = rows.find((row) => {
		if (moving.has(row.dataset.nodeId!)) return false;
		const bounds = row.getBoundingClientRect();
		return y < bounds.top + bounds.height / 2;
	});
	return {tier: target.dataset.tier, beforeNodeId: before?.dataset.nodeId ?? ''};
}
