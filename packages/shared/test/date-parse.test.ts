import {describe, expect, it} from "vite-plus/test";
import {guessDates, parseWithFormat, presetDate} from "../src/index.js";

const now = new Date(2026, 9, 1, 9, 0);
const isoDay = {dateFormat: "YYYY-MM-DD ddd", now};

describe("guessDates", () => {
	it("parses natural language with chrono", () => {
		expect(guessDates("oct 15", {now})).toStrictEqual([new Date(2026, 9, 15)]);
	});

	it("returns nothing for unparseable text", () => {
		expect(guessDates("xyz", {now})).toStrictEqual([]);
	});

	it("parses the current date format strictly", () => {
		expect(guessDates("2026-10-01 Thu", isoDay)).toStrictEqual([new Date(2026, 9, 1)]);
	});

	it("parses the date half of a timed pill label", () => {
		expect(guessDates("14:30 on 2026-10-02 Fri", isoDay)).toStrictEqual([new Date(2026, 9, 2)]);
	});

	it("returns a range for two dates joined by a dash", () => {
		expect(guessDates("oct 5 - oct 9", {now})).toStrictEqual([new Date(2026, 9, 5), new Date(2026, 9, 9)]);
	});
});

describe("parseWithFormat", () => {
	it("drops the leading weekday from the format", () => {
		expect(parseWithFormat("Oct 15", "ddd, MMM D", now)).toStrictEqual({start: new Date(2026, 9, 15)});
	});

	it("accepts single-digit month and day without a year for a padded numeric format", () => {
		expect(parseWithFormat("3/5", "MM/DD/YYYY", now)).toStrictEqual({start: new Date(2026, 2, 5)});
	});

	it("reads two-digit years as 20xx", () => {
		expect(parseWithFormat("03/05/25", "MM/DD/YYYY", now)).toStrictEqual({start: new Date(2025, 2, 5)});
	});

	it("orders day before month for a day-first format", () => {
		expect(parseWithFormat("3/5", "DD/MM/YYYY", now)).toStrictEqual({start: new Date(2026, 4, 3)});
	});

	it("splits a dashed range", () => {
		expect(parseWithFormat("2026-10-05 - 2026-10-09", "YYYY-MM-DD", now)).toStrictEqual({
			start: new Date(2026, 9, 5),
			end: new Date(2026, 9, 9),
		});
	});

	it("returns undefined when nothing matches", () => {
		expect(parseWithFormat("xyz", "YYYY-MM-DD", now)).toBeUndefined();
	});
});

describe("presetDate", () => {
	it("returns today", () => {
		expect(presetDate("today", {now})).toStrictEqual(new Date(2026, 9, 1));
	});

	it("returns tomorrow", () => {
		expect(presetDate("tomorrow", {now})).toStrictEqual(new Date(2026, 9, 2));
	});

	it("returns the first day of next week starting Sunday by default", () => {
		expect([presetDate("next week", {now}), presetDate("next week", {now, weekStartDay: 0})]).toStrictEqual([
			new Date(2026, 9, 4),
			new Date(2026, 9, 4),
		]);
	});

	it("returns the first day of next week starting Monday", () => {
		expect(presetDate("next week", {now, weekStartDay: 1})).toStrictEqual(new Date(2026, 9, 5));
	});
});
