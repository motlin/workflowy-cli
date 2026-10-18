import {describe, expect, it} from "vite-plus/test";
import {
	adjacentVisibleNode,
	backspaceDeleteTarget,
	editingAfterRemoval,
	isCaretOnBoundaryLine,
	navigableIds,
} from "../src/client/caret-navigation.js";

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

describe("backspaceDeleteTarget", () => {
	const visible = ["a", "b", "c"];

	it("deletes an empty childless node and edits the previous visible node", () => {
		expect(backspaceDeleteTarget(visible, "b", {text: "", hasChildren: false})).toBe("a");
	});

	it("keeps a node that still has text", () => {
		expect(backspaceDeleteTarget(visible, "b", {text: "x", hasChildren: false})).toBeNull();
	});

	it("keeps an empty node that has children", () => {
		expect(backspaceDeleteTarget(visible, "b", {text: "", hasChildren: true})).toBeNull();
	});

	it("keeps the first visible node, which has nowhere to move the caret", () => {
		expect(backspaceDeleteTarget(visible, "a", {text: "", hasChildren: false})).toBeNull();
	});
});

describe("editingAfterRemoval", () => {
	it("continues at the end of the previous visible node", () => {
		expect(editingAfterRemoval(["a", "b", "c"], "b")).toStrictEqual({
			nodeId: "a",
			caretOffset: Number.MAX_SAFE_INTEGER,
		});
	});

	it("continues at the start of the next visible node when the removed node was first", () => {
		expect(editingAfterRemoval(["a", "b", "c"], "a")).toStrictEqual({nodeId: "b", caretOffset: 0});
	});

	it("stops editing when no other node is visible", () => {
		expect(editingAfterRemoval(["a"], "a")).toBeNull();
	});
});

describe("navigableIds", () => {
	it("prepends the zoom root's title when zoomed", () => {
		expect(navigableIds("z", ["a", "b"])).toStrictEqual(["z", "a", "b"]);
	});

	it("returns the visible rows unchanged at the main-tree root", () => {
		expect(navigableIds(null, ["a"])).toStrictEqual(["a"]);
	});

	it("moves Up from the first child into the zoom title", () => {
		expect(adjacentVisibleNode(navigableIds("z", ["a", "b"]), "a", "up")).toBe("z");
	});

	it("moves Down from the zoom title into the first child", () => {
		expect(adjacentVisibleNode(navigableIds("z", ["a", "b"]), "z", "down")).toBe("a");
	});

	it("continues editing at the end of the zoom title when its only child leaves the view", () => {
		expect(editingAfterRemoval(navigableIds("z", ["a"]), "a")).toStrictEqual({
			nodeId: "z",
			caretOffset: Number.MAX_SAFE_INTEGER,
		});
	});
});
