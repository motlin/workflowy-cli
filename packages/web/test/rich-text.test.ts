import {describe, expect, it} from "vite-plus/test";
import {concatHtml, plainLength, splitHtml} from "../src/client/rich-text.js";

describe("splitHtml", () => {
	it("splits plain text at a collapsed caret", () => {
		expect(splitHtml("Bravo text", 5, 5)).toStrictEqual({before: "Bravo", after: " text"});
	});

	it("closes open tags in before and reopens them in after", () => {
		expect(splitHtml("<b>harl</b>ie", 2, 2)).toStrictEqual({before: "<b>ha</b>", after: "<b>rl</b>ie"});
	});

	it("drops the selected text", () => {
		expect(splitHtml("XyCharlie", 1, 3)).toStrictEqual({before: "X", after: "harlie"});
	});

	it("reopens nested tags with their attributes", () => {
		expect(splitHtml('<a href="u"><i>abcd</i></a>', 2, 2)).toStrictEqual({
			before: '<a href="u"><i>ab</i></a>',
			after: '<a href="u"><i>cd</i></a>',
		});
	});

	it("keeps entities intact and counts them as one character", () => {
		expect(splitHtml("a &amp; b", 3, 3)).toStrictEqual({before: "a &amp;", after: " b"});
	});

	it("drops tags left empty at the split edges", () => {
		expect(splitHtml("<b>ab</b>cd", 2, 2)).toStrictEqual({before: "<b>ab</b>", after: "cd"});
		expect(splitHtml("ab<b>cd</b>", 2, 2)).toStrictEqual({before: "ab", after: "<b>cd</b>"});
	});

	it("splits at the ends", () => {
		expect(splitHtml("<b>ab</b>", 0, 0)).toStrictEqual({before: "", after: "<b>ab</b>"});
		expect(splitHtml("<b>ab</b>", 2, 2)).toStrictEqual({before: "<b>ab</b>", after: ""});
	});
});

describe("concatHtml", () => {
	it("merges an identical closing and opening tag at the seam", () => {
		expect(concatHtml("<b>ha</b>", "<b>rl</b>ie")).toBe("<b>harl</b>ie");
	});

	it("concatenates plain text", () => {
		expect(concatHtml("Xy", "Charlie")).toBe("XyCharlie");
	});

	it("does not merge different tags", () => {
		expect(concatHtml("<b>ha</b>", "<i>rl</i>")).toBe("<b>ha</b><i>rl</i>");
	});

	it("does not merge tags with different attributes", () => {
		expect(concatHtml('<a href="x">a</a>', '<a href="y">b</a>')).toBe('<a href="x">a</a><a href="y">b</a>');
	});

	it("round-trips a split", () => {
		const {before, after} = splitHtml('<a href="u"><i>abcd</i></a>', 2, 2);
		expect(concatHtml(before, after)).toBe('<a href="u"><i>abcd</i></a>');
	});
});

describe("plainLength", () => {
	it("counts entities as one character", () => {
		expect(plainLength("a &amp; b")).toBe(5);
	});

	it("ignores tags", () => {
		expect(plainLength("<b>harl</b>ie")).toBe(6);
	});
});
