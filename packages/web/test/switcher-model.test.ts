import {describe, expect, it} from "vite-plus/test";
import {createSwitcherSelection} from "../src/client/switcher-model.js";

function withCount(count: number, selected = 0) {
	const selection = createSwitcherSelection();
	selection.setCount(count);
	selection.hover(selected);
	return selection;
}

describe("createSwitcherSelection", () => {
	it("starts empty", () => {
		expect(createSwitcherSelection().getState()).toStrictEqual({selected: 0, filter: "", count: 0});
	});

	it("selectNext wraps from the last row to the first", () => {
		const selection = withCount(8, 7);
		selection.selectNext();
		expect(selection.getState()).toStrictEqual({selected: 0, filter: "", count: 8});
	});

	it("selectNext advances by one", () => {
		const selection = withCount(8, 2);
		selection.selectNext();
		expect(selection.getState()).toStrictEqual({selected: 3, filter: "", count: 8});
	});

	it("selectPrev wraps from the first row to the last", () => {
		const selection = withCount(8, 0);
		selection.selectPrev();
		expect(selection.getState()).toStrictEqual({selected: 7, filter: "", count: 8});
	});

	it("selectPrev moves back by one", () => {
		const selection = withCount(8, 5);
		selection.selectPrev();
		expect(selection.getState()).toStrictEqual({selected: 4, filter: "", count: 8});
	});

	it("selectNext and selectPrev stay at 0 with no rows", () => {
		const selection = createSwitcherSelection();
		selection.selectNext();
		expect(selection.getState()).toStrictEqual({selected: 0, filter: "", count: 0});
		selection.selectPrev();
		expect(selection.getState()).toStrictEqual({selected: 0, filter: "", count: 0});
	});

	it("search sets the filter and resets the selection to 0", () => {
		const selection = withCount(8, 4);
		selection.search("a");
		expect(selection.getState()).toStrictEqual({selected: 0, filter: "a", count: 8});
	});

	it("hover selects the hovered row", () => {
		const selection = withCount(8, 0);
		selection.hover(3);
		expect(selection.getState()).toStrictEqual({selected: 3, filter: "", count: 8});
	});

	it("setCount updates the row count only", () => {
		const selection = withCount(8, 2);
		selection.search("b");
		selection.hover(2);
		selection.setCount(5);
		expect(selection.getState()).toStrictEqual({selected: 2, filter: "b", count: 5});
	});

	it("reset returns to the empty state", () => {
		const selection = withCount(8, 6);
		selection.search("x");
		selection.reset();
		expect(selection.getState()).toStrictEqual({selected: 0, filter: "", count: 0});
	});

	it("getState returns a snapshot that later actions do not mutate", () => {
		const selection = withCount(8, 1);
		const before = selection.getState();
		selection.selectNext();
		expect(before).toStrictEqual({selected: 1, filter: "", count: 8});
	});
});
