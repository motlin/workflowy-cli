import {describe, expect, it} from "vite-plus/test";
import {adjacentVisibleNode, isCaretOnBoundaryLine} from "../src/client/caret-navigation.js";

describe("isCaretOnBoundaryLine", () => {
	// A three-line node: lines at 100-116, 120-136, 140-156 (16px caret, 20px line pitch).
	const content = {top: 98, bottom: 158};
	const firstLine = {top: 100, bottom: 116};
	const middleLine = {top: 120, bottom: 136};
	const lastLine = {top: 140, bottom: 156};

	it("treats the first line as the up boundary only", () => {
		expect([
			isCaretOnBoundaryLine("up", firstLine, content),
			isCaretOnBoundaryLine("down", firstLine, content),
		]).toStrictEqual([true, false]);
	});

	it("treats the last line as the down boundary only", () => {
		expect([
			isCaretOnBoundaryLine("up", lastLine, content),
			isCaretOnBoundaryLine("down", lastLine, content),
		]).toStrictEqual([false, true]);
	});

	it("keeps in-text movement on a middle line", () => {
		expect([
			isCaretOnBoundaryLine("up", middleLine, content),
			isCaretOnBoundaryLine("down", middleLine, content),
		]).toStrictEqual([false, false]);
	});

	it("treats a single-line node as both boundaries", () => {
		const single = {top: 100, bottom: 116};
		expect([
			isCaretOnBoundaryLine("up", single, {top: 98, bottom: 118}),
			isCaretOnBoundaryLine("down", single, {top: 98, bottom: 118}),
		]).toStrictEqual([true, true]);
	});

	it("treats an unmeasurable caret (empty node) as both boundaries", () => {
		expect([
			isCaretOnBoundaryLine("up", null, content),
			isCaretOnBoundaryLine("down", null, content),
		]).toStrictEqual([true, true]);
	});
});

describe("adjacentVisibleNode", () => {
	const visible = ["a", "b", "c"];

	it("returns the previous node for up", () => {
		expect(adjacentVisibleNode(visible, "b", "up")).toBe("a");
	});

	it("returns the next node for down", () => {
		expect(adjacentVisibleNode(visible, "b", "down")).toBe("c");
	});

	it("does nothing at the first node going up", () => {
		expect(adjacentVisibleNode(visible, "a", "up")).toBeNull();
	});

	it("does nothing at the last node going down", () => {
		expect(adjacentVisibleNode(visible, "c", "down")).toBeNull();
	});

	it("does nothing when the edited node is not visible", () => {
		expect(adjacentVisibleNode(visible, "z", "down")).toBeNull();
	});
});
