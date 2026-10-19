import {describe, expect, it} from "vite-plus/test";
import {DRAG_THRESHOLD_PX, autoScrollBy, edgeAutoscrollSpeed, isDragGesture} from "../src/client/pointer-drag.js";

describe("isDragGesture", () => {
	it("ignores the jitter of a tap so a tap never refiles a row", () => {
		expect(isDragGesture({x: 10, y: 10}, {x: 12, y: 13})).toBe(false);
	});

	it("becomes a drag once the finger travels past the threshold", () => {
		expect(isDragGesture({x: 10, y: 10}, {x: 10, y: 10 + DRAG_THRESHOLD_PX + 1})).toBe(true);
	});

	it("measures travel in either direction", () => {
		expect(isDragGesture({x: 100, y: 100}, {x: 100 - DRAG_THRESHOLD_PX - 1, y: 100})).toBe(true);
	});
});

describe("autoScrollBy", () => {
	const viewport = 800;

	it("does not scroll while the pointer is in the middle of the screen", () => {
		expect(autoScrollBy(400, viewport)).toBe(0);
	});

	it("scrolls up near the top edge, so a long tier can be dragged out of", () => {
		expect(autoScrollBy(10, viewport)).toBeLessThan(0);
	});

	it("scrolls down near the bottom edge", () => {
		expect(autoScrollBy(viewport - 10, viewport)).toBeGreaterThan(0);
	});

	it("scrolls faster the closer the pointer gets to the edge", () => {
		expect(Math.abs(autoScrollBy(2, viewport))).toBeGreaterThan(Math.abs(autoScrollBy(60, viewport)));
	});
});

describe("edgeAutoscrollSpeed", () => {
	const base = {scrollerTop: 0, scrollerHeight: 1000, startY: 500, haveScrolled: false, mobile: false};

	it("follows upstream's quadratic curve inside the 15% edge zones", () => {
		const speeds = [
			edgeAutoscrollSpeed({...base, pointerY: 0}),
			edgeAutoscrollSpeed({...base, pointerY: 75}),
			edgeAutoscrollSpeed({...base, pointerY: 100, startY: 50}),
			edgeAutoscrollSpeed({...base, pointerY: 100, startY: 50, haveScrolled: true}),
			edgeAutoscrollSpeed({...base, pointerY: 925}),
			edgeAutoscrollSpeed({...base, pointerY: 500}),
			edgeAutoscrollSpeed({...base, pointerY: 0, mobile: true}),
		];
		expect(speeds).toStrictEqual([-1250, -313, 0, -139, 313, 0, -1000]);
	});

	it("measures the pointer relative to the scroller's top", () => {
		expect(edgeAutoscrollSpeed({...base, scrollerTop: 200, pointerY: 275})).toBe(-313);
	});

	it("ignores the bottom zone while the drag started below the pointer and nothing has scrolled", () => {
		expect(edgeAutoscrollSpeed({...base, pointerY: 925, startY: 950})).toBe(0);
	});
});
