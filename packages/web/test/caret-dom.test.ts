import {describe, expect, it} from "vite-plus/test";
import {offsetsFromPath, orderOffsets} from "../src/client/caret-dom.js";

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
