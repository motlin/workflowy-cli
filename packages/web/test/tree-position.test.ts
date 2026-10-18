import {describe, expect, it} from "vite-plus/test";
import {priorityAtIndex, sortByPriority} from "../src/client/tree-position.js";

const siblings = [
	{id: "a", priority: 0},
	{id: "b", priority: 100},
	{id: "c", priority: 200},
];

describe("sortByPriority", () => {
	it("sorts ascending without mutating the input", () => {
		const input = [
			{id: "c", priority: 200},
			{id: "a", priority: 0},
			{id: "b", priority: 100},
		];
		const sorted = sortByPriority(input);
		expect(sorted.map((s) => s.id)).toStrictEqual(["a", "b", "c"]);
		expect(input[0].id).toBe("c"); // original untouched
	});
});

describe("priorityAtIndex", () => {
	const unsorted = [siblings[2], siblings[0], siblings[1]];

	it("sits between the neighbors around the slot", () => {
		expect([priorityAtIndex(unsorted, 1), priorityAtIndex(unsorted, 2)]).toStrictEqual([50, 150]);
	});

	it("sits above the first sibling at index 0", () => {
		expect(priorityAtIndex(unsorted, 0)).toBe(-1);
	});

	it("sits below the last sibling past the end or with no index", () => {
		expect([
			priorityAtIndex(unsorted, 3),
			priorityAtIndex(unsorted, 9),
			priorityAtIndex(unsorted, undefined),
		]).toStrictEqual([201, 201, 201]);
	});

	it("is 0 among no siblings", () => {
		expect(priorityAtIndex([], 0)).toBe(0);
	});
});
