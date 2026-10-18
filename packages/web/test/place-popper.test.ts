import {describe, expect, it} from "vite-plus/test";
import {placePopper} from "../src/client/components/flyout/place-popper.js";

describe("placePopper", () => {
	it("centers a bottom popper under the breadcrumb reference", () => {
		expect(
			placePopper({
				reference: {left: 526.37, top: 12, width: 24, height: 24},
				popper: {width: 252, height: 60.28},
				placement: "bottom",
				viewport: {width: 1680, height: 860},
			}),
		).toStrictEqual({x: 412.37, y: 36, placement: "bottom"});
	});

	it("clamps x to 10px from the right viewport edge", () => {
		expect(
			placePopper({
				reference: {left: 1240, top: 12, width: 24, height: 24},
				popper: {width: 183.66, height: 40},
				placement: "bottom",
				viewport: {width: 1272, height: 860},
			}),
		).toStrictEqual({x: 1272 - 10 - 183.66, y: 36, placement: "bottom"});
	});

	it("clamps x to 10px from the left viewport edge", () => {
		expect(
			placePopper({
				reference: {left: 0, top: 100, width: 20, height: 20},
				popper: {width: 200, height: 40},
				placement: "bottom",
				viewport: {width: 1000, height: 800},
			}),
		).toStrictEqual({x: 10, y: 120, placement: "bottom"});
	});

	it("aligns left edges for bottom-start", () => {
		expect(
			placePopper({
				reference: {left: 300, top: 100, width: 24, height: 28},
				popper: {width: 260, height: 200},
				placement: "bottom-start",
				viewport: {width: 1000, height: 800},
			}),
		).toStrictEqual({x: 300, y: 128, placement: "bottom-start"});
	});

	// Measured read-only on workflowy.com (2026-10-18) in a 386x697 window: the bullet "..." menu
	// (bottom-start, margin-top 4px) rendered translate3d(37px, 28px) with visual top 32 for both a row
	// near the bottom and a row near the top. 28 = 697 - 10 - 659: popper ignores the CSS margin.
	it("pins the upstream bullet menu opened from a row near the bottom of the window", () => {
		expect(
			placePopper({
				reference: {left: 37, top: 602.1875, width: 24, height: 28},
				popper: {width: 263.4140625, height: 659},
				placement: "bottom-start",
				viewport: {width: 386, height: 697},
			}),
		).toStrictEqual({x: 37, y: 28, placement: "bottom-start"});
	});

	it("pins the upstream bullet menu opened from a row near the top of the window", () => {
		expect(
			placePopper({
				reference: {left: 37, top: 154, width: 24, height: 28},
				popper: {width: 255.1953125, height: 659},
				placement: "bottom-start",
				viewport: {width: 386, height: 697},
			}),
		).toStrictEqual({x: 37, y: 28, placement: "bottom-start"});
	});

	it("pins to the top padding when the popper is taller than the padded viewport", () => {
		expect(
			placePopper({
				reference: {left: 37, top: 400, width: 24, height: 28},
				popper: {width: 250, height: 900},
				placement: "bottom-start",
				viewport: {width: 1000, height: 800},
			}),
		).toStrictEqual({x: 37, y: 10, placement: "bottom-start"});
	});

	it("pushes the popper down to the top padding when the reference is scrolled above the viewport", () => {
		expect(
			placePopper({
				reference: {left: 37, top: -100, width: 24, height: 28},
				popper: {width: 250, height: 100},
				placement: "bottom-start",
				viewport: {width: 1000, height: 800},
			}),
		).toStrictEqual({x: 37, y: 10, placement: "bottom-start"});
	});
});
