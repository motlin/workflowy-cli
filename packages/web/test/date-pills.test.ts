import {describe, expect, it} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {renderDatePills} from "../src/client/date-pills.js";
import {wrapTagsInSpans} from "../src/client/tag-spans.js";

const SETTINGS = {dateFormat: "YYYY-MM-DD ddd", timeFormat: "HH:mm", weekStartDay: 0};
const NOW = new Date(2026, 9, 1);
const BOM = "﻿";
const PILL_OPEN =
	'<time data-monolith="true" contenteditable="false" class="explosive monolith-pill" title="⌥click to search"';

describe("renderDatePills", () => {
	it("renders a stored <time> as upstream's monolith pill", () => {
		expect(
			renderDatePills(
				'dpSingle <time startYear="2026" startMonth="10" startDay="1">Thu, Oct 1, 2026</time> tail',
				SETTINGS,
				NOW,
			),
		).toBe(
			`dpSingle ${PILL_OPEN} startyear="2026" startmonth="10" startday="1">${BOM}<span class="content-wrapper">2026-10-01 Thu</span>${BOM}</time> tail`,
		);
	});

	it("appends an extra U+FEFF after a pill that ends the content", () => {
		expect(
			renderDatePills(
				'end <time startYear="2026" startMonth="10" startDay="1">Thu, Oct 1, 2026</time>',
				SETTINGS,
				NOW,
			),
		).toBe(
			`end ${PILL_OPEN} startyear="2026" startmonth="10" startday="1">${BOM}<span class="content-wrapper">2026-10-01 Thu</span>${BOM}</time>${BOM}`,
		);
	});

	it("keeps the interleaved attribute order of a range", () => {
		expect(
			renderDatePills(
				'r <time startYear="2026" endYear="2026" startMonth="10" endMonth="10" startDay="1" endDay="3">Thu, Oct 1, 2026 - Sat, Oct 3, 2026</time> x',
				SETTINGS,
				NOW,
			),
		).toBe(
			`r ${PILL_OPEN} startyear="2026" endyear="2026" startmonth="10" endmonth="10" startday="1" endday="3">${BOM}<span class="content-wrapper">2026-10-01 Thu - 2026-10-03 Sat</span>${BOM}</time> x`,
		);
	});

	it("leaves text without <time> unchanged", () => {
		expect(renderDatePills("plain #tag text", SETTINGS, NOW)).toBe("plain #tag text");
	});

	it("survives tag wrapping unchanged", () => {
		const pills = renderDatePills(
			'dpSingle <time startYear="2026" startMonth="10" startDay="1">Thu, Oct 1, 2026</time> tail',
			SETTINGS,
			NOW,
		);
		expect(wrapTagsInSpans(pills, {})).toBe(pills);
	});
});

describe("date pill styles", () => {
	const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");
	const normalized = styles
		.replaceAll(/\/\*[\s\S]*?\*\//gu, "")
		.replaceAll(/\s*([{};:>,])\s*/gu, "$1")
		.replaceAll(";}", "}")
		.replaceAll(/([:\s(,])0\.(\d)/gu, "$1.$2");

	it("carries upstream's monolith-pill rules verbatim", () => {
		const rules = [
			".monolith-pill{cursor:pointer;font-size:inherit;position:relative;white-space:nowrap;display:inline;margin-right:1px;margin-left:1px}",
			".monolith-pill .content-wrapper{font-size:.8em;line-height:1.5;display:inline-block;color:var(--wf-text-primary);border-radius:16px;background:var(--wf-background-tertiary);padding:0 var(--wf-space-m)}",
			".monolith-pill:hover .content-wrapper{text-decoration:underline}",
			".notes .monolith-pill .content-wrapper{line-height:15px}",
			".done>.name>.content .monolith-pill .content-wrapper{text-decoration:line-through}",
			".content time{cursor:pointer}",
		];
		expect(rules.filter((rule) => !normalized.includes(rule))).toStrictEqual([]);
	});

	it("drops the old local time badge rule", () => {
		expect(normalized.includes(".innerContentContainer time{")).toBe(false);
	});
});
