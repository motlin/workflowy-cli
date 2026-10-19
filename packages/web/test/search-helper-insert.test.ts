import {describe, expect, it} from "vite-plus/test";
import {insertHelperValue} from "../src/client/search/helper-insert.js";

describe("insertHelperValue", () => {
	it("inserts, toggles, and replaces group members like upstream's search helper", () => {
		expect([
			insertHelperValue("", 0, "today"),
			insertHelperValue("today ", 6, "tomorrow"),
			insertHelperValue("tomorrow ", 9, "tomorrow"),
			insertHelperValue("@soPerson ", 10, "changed:"),
			insertHelperValue("next week ", 10, "today"),
			insertHelperValue("apple ", 6, "changed-by:me"),
			insertHelperValue("apple changed-by:me ", 20, "changed-by:others"),
		]).toStrictEqual([
			{query: "today ", caret: 6},
			{query: "tomorrow ", caret: 9},
			{query: "", caret: 0},
			{query: "@soPerson changed:", caret: 18},
			{query: "today ", caret: 6},
			{query: "apple changed-by:me ", caret: 20},
			{query: "apple changed-by:others ", caret: 24},
		]);
	});

	it("replaces the word under the caret and treats regex characters literally", () => {
		expect([
			insertHelperValue("foo ba", 6, "#tag"),
			insertHelperValue("a+b ", 4, "a+b"),
			insertHelperValue("CHANGED:1H x ", 13, "changed:1h"),
		]).toStrictEqual([
			{query: "foo #tag ", caret: 9},
			{query: "", caret: 0},
			{query: "x ", caret: 2},
		]);
	});
});
