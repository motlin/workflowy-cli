import {describe, expect, it} from "vite-plus/test";
import {parseQuery} from "../src/search/index.js";
import {searchItem, SO_ROWS} from "./helpers/search-so-fixture.js";

const NOW = new Date(2026, 9, 1, 12).getTime();

function names(query: string, dateFormat?: string): string[] {
	const node = parseQuery(query, dateFormat === undefined ? {now: NOW} : {now: NOW, dateFormat});
	return SO_ROWS.filter((row) => node.matches(row).matches).map((row) => row.nameHtml.split(" ")[0] ?? "");
}

describe("explicit date operators", () => {
	it("date:past and date:future compare row starts to today's start and now", () => {
		expect([names("date:past"), names("date:future"), names("has:date")]).toStrictEqual([
			["Past"],
			["Future"],
			["Meeting", "Past", "Future"],
		]);
	});

	it("date:, date-before: and date-after: strictly parse the default YYYY-MM-DD format", () => {
		expect([
			names("date:2026-10-01"),
			names("date:2026-10-1"),
			names("date:26-10-01"),
			names("date-before:2026-10-01"),
			names("date-after:2026-10-01"),
			names("date:10/1/2026"),
			names("date:garbage"),
		]).toStrictEqual([["Meeting"], ["Meeting"], ["Meeting"], ["Past"], ["Future"], [], []]);
	});

	it("date: honours a custom date format and an @HH:mm time", () => {
		const timed = searchItem(
			'Timed <time startYear="2026" startMonth="10" startDay="1" startHour="9" startMinute="30">Oct 1 9:30</time>',
		);
		expect([
			names("date:10/1/2026", "MM/DD/YYYY"),
			parseQuery("date:2026-10-01@09:30", {now: NOW}).matches(timed),
			parseQuery("date:2026-10-01", {now: NOW}).matches(timed).matches,
		]).toStrictEqual([
			["Meeting"],
			{matches: true, nameMatches: false, noteMatches: false, metaMatches: true},
			false,
		]);
	});

	it("date: matches a range end at midnight", () => {
		const range = searchItem(
			'Trip <time startYear="2026" startMonth="10" startDay="5" endYear="2026" endMonth="10" endDay="9">Oct 5 - 9</time>',
		);
		expect([
			parseQuery("date:2026-10-09", {now: NOW}).matches(range).matches,
			parseQuery("date:2026-10-07", {now: NOW}).matches(range).matches,
		]).toStrictEqual([true, false]);
	});

	it("day-of-week: takes full lowercase English day names only", () => {
		expect([names("day-of-week:thursday"), names("day-of-week:friday"), names("day-of-week:thu")]).toStrictEqual([
			["Meeting"],
			["Future"],
			[],
		]);
	});

	it("negating a date operator requires the row to contain a date", () => {
		expect([names("-date:past"), names("-date:garbage")]).toStrictEqual([
			["Meeting", "Future"],
			["Meeting", "Past", "Future"],
		]);
	});
	it("bare natural-language dates match rows sharing a known date component", () => {
		expect(
			[
				"today",
				"oct 1",
				"this month",
				"Thursday",
				"last month",
				"sep 15",
				"tomorrow",
				"next week",
				"yesterday",
			].map((query) => names(query)),
		).toStrictEqual([["Meeting"], ["Meeting"], ["Meeting"], ["Meeting"], ["Past"], ["Past"], [], [], []]);
	});

	it("a bare date claims a multi-word span, combines with terms, and negation requires a date", () => {
		expect([names("oct 1 meeting"), names("next week -alpha"), names("-today"), names("#today")]).toStrictEqual([
			["Meeting"],
			[],
			["Past", "Future"],
			[],
		]);
	});
});
