import {describe, expect, it} from "vite-plus/test";
import {childFlagsFromRows} from "../src/server/backlinks.js";

describe("childFlagsFromRows", () => {
	it("flags a parent with only completed children as having children but no uncompleted children", () => {
		expect(
			childFlagsFromRows([
				{parentId: "p", completedAt: new Date(1000)},
				{parentId: "p", completedAt: new Date(2000)},
				{parentId: "q", completedAt: new Date(1000)},
				{parentId: "q", completedAt: null},
				{parentId: "r", completedAt: null},
				{parentId: null, completedAt: null},
			]),
		).toStrictEqual({
			withChildren: new Set(["p", "q", "r"]),
			withUncompletedChildren: new Set(["q", "r"]),
		});
	});
});
