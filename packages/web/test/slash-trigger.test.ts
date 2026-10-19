import {describe, expect, it} from "vite-plus/test";
import {planSlashOpen, planSlashRearm, SLASH_CHIP_CLASS, stripSlashChip} from "../src/client/slash-trigger.js";

describe("planSlashOpen", () => {
	it.each([
		["Slash Alpha /", 12, {start: 11, end: 13}],
		["/", 0, {start: 0, end: 1}],
		["Betax/", 5, null],
		["a / b", 2, {start: 2, end: 3}],
		["a /b", 2, null],
		["/b", 0, {start: 0, end: 1}],
		["a\t/", 2, {start: 1, end: 3}],
	] as const)("planSlashOpen(%j, %i)", (text, slashIndex, expected) => {
		expect(planSlashOpen(text, slashIndex)).toStrictEqual(expected);
	});
});

describe("planSlashRearm", () => {
	it.each([
		["Slash Alpha /mo", 15, {start: 11, end: 15}],
		["x/mo", 4, null],
		["a / mo", 6, null],
		["/mo", 3, {start: 0, end: 3}],
		["a /mo", 4, {start: 1, end: 4}],
		["a /abcdefghij", 13, null],
		["a /abcdefgh", 11, {start: 1, end: 11}],
		["plain", 5, null],
	] as const)("planSlashRearm(%j, %i)", (text, caret, expected) => {
		expect(planSlashRearm(text, caret)).toStrictEqual(expected);
	});
});

describe("stripSlashChip", () => {
	it("unwraps the chip span to its text", () => {
		expect(
			stripSlashChip(
				'Slash Alpha<span class="slash-input bg-tertiary py-2xs pr-xs pl-xs rounded-s leading-none"> /mo</span>',
			),
		).toBe("Slash Alpha /mo");
	});

	it("returns HTML without a chip unchanged", () => {
		const html = 'a <b>bold</b> <span class="colored c-red">red</span> /x';
		expect(stripSlashChip(html)).toBe(html);
	});

	it("exports the upstream chip class", () => {
		expect(SLASH_CHIP_CLASS).toBe("slash-input bg-tertiary py-2xs pr-xs pl-xs rounded-s leading-none");
	});
});
