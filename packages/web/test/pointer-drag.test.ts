import {describe, expect, it} from 'vitest';
import {DRAG_THRESHOLD_PX, autoScrollBy, isDragGesture} from '../src/client/pointer-drag.js';

describe('isDragGesture', () => {
	it('ignores the jitter of a tap so a tap never refiles a row', () => {
		expect(isDragGesture({x: 10, y: 10}, {x: 12, y: 13})).toBe(false);
	});

	it('becomes a drag once the finger travels past the threshold', () => {
		expect(isDragGesture({x: 10, y: 10}, {x: 10, y: 10 + DRAG_THRESHOLD_PX + 1})).toBe(true);
	});

	it('measures travel in either direction', () => {
		expect(isDragGesture({x: 100, y: 100}, {x: 100 - DRAG_THRESHOLD_PX - 1, y: 100})).toBe(true);
	});
});

describe('autoScrollBy', () => {
	const viewport = 800;

	it('does not scroll while the pointer is in the middle of the screen', () => {
		expect(autoScrollBy(400, viewport)).toBe(0);
	});

	it('scrolls up near the top edge, so a long tier can be dragged out of', () => {
		expect(autoScrollBy(10, viewport)).toBeLessThan(0);
	});

	it('scrolls down near the bottom edge', () => {
		expect(autoScrollBy(viewport - 10, viewport)).toBeGreaterThan(0);
	});

	it('scrolls faster the closer the pointer gets to the edge', () => {
		expect(Math.abs(autoScrollBy(2, viewport))).toBeGreaterThan(Math.abs(autoScrollBy(60, viewport)));
	});
});
