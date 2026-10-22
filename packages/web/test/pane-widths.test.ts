import {describe, expect, it} from "vite-plus/test";
import {
	DEFAULT_PANE_WIDTH,
	MIN_PANE_WIDTH,
	availablePaneWidth,
	paneWidth,
	rebalancedWidths,
	resizedFromLeft,
	scaledWidths,
	widthFromPercent,
	widthPercents,
} from "../src/client/pane-widths.js";

describe("pane width constants", () => {
	it("uses upstream's 350px pane minimum and 380px fallback width", () => {
		expect({min: MIN_PANE_WIDTH, fallback: DEFAULT_PANE_WIDTH}).toStrictEqual({min: 350, fallback: 380});
	});
});

describe("availablePaneWidth", () => {
	it("is the window width beside the left bar, never under one pane's minimum", () => {
		expect([
			availablePaneWidth(1272, 0),
			availablePaneWidth(1272, 296),
			availablePaneWidth(500, 296),
			availablePaneWidth(undefined, 0),
		]).toStrictEqual([1272, 976, 350, 380]);
	});
});

describe("paneWidth", () => {
	it("floors finite widths at the minimum and falls back for anything else", () => {
		expect([
			paneWidth(500),
			paneWidth(100),
			paneWidth(Number.NaN),
			paneWidth(undefined),
			paneWidth(null, 600),
		]).toStrictEqual([500, 350, 380, 380, 600]);
	});
});

describe("rebalancedWidths", () => {
	it("gives every pane an equal floored share of the available width, like upstream's rebalanceWidths", () => {
		expect([rebalancedWidths(2, 1272), rebalancedWidths(3, 1000), rebalancedWidths(4, 976)]).toStrictEqual([
			[636, 636],
			[350, 350, 350],
			[350, 350, 350, 350],
		]);
	});
});

describe("scaledWidths", () => {
	it("scales every pane in proportion to a new available width, like upstream's resizeToAvailableWidth", () => {
		expect([
			scaledWidths([400, 800], 600),
			scaledWidths([636, 636], 2000),
			scaledWidths([700, 350], 1050),
		]).toStrictEqual([
			[350, 400],
			[1000, 1000],
			[700, 350],
		]);
	});
});

describe("resizedFromLeft", () => {
	it("moves the divider on a pane's left edge, trading width with its left neighbour", () => {
		expect(resizedFromLeft([500, 500, 400], 1, {previousWidth: 500, paneWidth: 500}, -100)).toStrictEqual([
			400, 600, 400,
		]);
	});

	it("stops each side at the 350px minimum", () => {
		expect({
			left: resizedFromLeft([500, 500], 1, {previousWidth: 500, paneWidth: 500}, -400),
			right: resizedFromLeft([500, 500], 1, {previousWidth: 500, paneWidth: 500}, 400),
		}).toStrictEqual({left: [350, 650], right: [650, 350]});
	});

	it("measures from the widths at the drag's start, not the current ones", () => {
		expect(resizedFromLeft([450, 550], 1, {previousWidth: 500, paneWidth: 500}, 20)).toStrictEqual([520, 480]);
	});

	it("has no divider to move for the main pane", () => {
		expect(resizedFromLeft([500, 500], 0, {previousWidth: 500, paneWidth: 500}, 20)).toBeNull();
	});
});

describe("widthPercents", () => {
	it("persists each pane's share of the total, rounded like upstream's paneWidthPercent", () => {
		expect([widthPercents([636, 636]), widthPercents([400, 600]), widthPercents([350, 350, 350])]).toStrictEqual([
			[50, 50],
			[40, 60],
			[33.3333, 33.3333, 33.3333],
		]);
	});
});

describe("widthFromPercent", () => {
	it("restores a stored share of the available width, falling back for out-of-range shares", () => {
		expect([
			widthFromPercent(40, 1000),
			widthFromPercent(10, 1000),
			widthFromPercent(0, 1000),
			widthFromPercent(120, 1000),
			widthFromPercent(Number.NaN, 1000),
			widthFromPercent(undefined, 1000),
		]).toStrictEqual([400, 350, 380, 380, 380, 380]);
	});
});
