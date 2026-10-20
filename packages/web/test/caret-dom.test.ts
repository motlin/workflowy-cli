import {describe, expect, it} from "vite-plus/test";
import {caretAnchor, offsetsFromPath, orderOffsets} from "../src/client/caret-dom.js";

describe("offsetsFromPath", () => {
	it("counts the lengths of the text nodes before the target node", () => {
		expect(offsetsFromPath([6, 5, 10], 1, 0)).toBe(6);
	});

	it("adds the offset inside the target node", () => {
		expect(offsetsFromPath([6, 5, 10], 1, 2)).toBe(8);
	});

	it("is the offset itself in the first node", () => {
		expect(offsetsFromPath([6, 5, 10], 0, 3)).toBe(3);
	});
});

describe("orderOffsets", () => {
	it("normalizes a reversed selection", () => {
		expect(orderOffsets(11, 6)).toStrictEqual({start: 6, end: 11});
	});

	it("keeps a forward selection", () => {
		expect(orderOffsets(2, 9)).toStrictEqual({start: 2, end: 9});
	});
});

describe("caretAnchor", () => {
	const fallback = {left: 40, bottom: 60, top: 40, right: 200, width: 160, height: 20};
	const empty = {left: 0, bottom: 0, top: 0, right: 0, width: 0, height: 0};

	it("anchors at the caret box's bottom-left", () => {
		expect(caretAnchor([{left: 10, bottom: 20, top: 2, right: 11, width: 1, height: 18}], fallback)).toStrictEqual({
			x: 10,
			y: 20,
		});
	});

	it("uses the first non-empty candidate, as upstream's text-offset range then focus-node box", () => {
		expect(
			caretAnchor(
				[
					empty,
					null,
					{left: 15, bottom: 30, top: 12, right: 15, width: 0, height: 18},
					{...fallback, left: 99},
				],
				fallback,
			),
		).toStrictEqual({x: 15, y: 30});
	});

	it("falls back to the row's name box when every candidate is all zeros", () => {
		expect(caretAnchor([empty, empty], fallback)).toStrictEqual({x: 40, y: 60});
	});

	it("falls back when there is no caret box", () => {
		expect(caretAnchor([], fallback)).toStrictEqual({x: 40, y: 60});
	});
});
