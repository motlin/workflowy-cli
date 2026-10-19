import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {DatePickerPopup} from "../src/client/components/date-picker-popup.js";
import type {DatePickerPopupProps} from "../src/client/components/date-picker-popup.js";

function render(props: Partial<DatePickerPopupProps> = {}): string {
	return renderToStaticMarkup(createElement(DatePickerPopup, {selected: [], ...props}));
}

/** Each day button's label and its `.date-picker-day-cell` class tokens. */
function dayCells(html: string): {label: string; cell: string[]}[] {
	return [
		...html.matchAll(
			/<button[^>]*data-date-picker-day-button="true"[^>]*><div class="(date-picker-day-cell[^"]*)"><div[^>]*><div[^>]*>(\d+)<\/div>/gu,
		),
	].map((m) => ({label: m[2], cell: m[1].split(/\s+/u).filter(Boolean)}));
}

function hasTokens(tokens: string[], wanted: string[]): boolean {
	return wanted.every((token) => tokens.includes(token));
}

function weekdayLabels(html: string): string[] {
	const row = /<div class="grid grid-cols-7 justify-items-center text-tertiary[^"]*">(.*?)<\/div><\/header>/u.exec(
		html,
	);
	return [...(row?.[1] ?? "").matchAll(/<div class="text-center">([^<]*)<\/div>/gu)].map((m) => m[1]);
}

function headerButtons(html: string): string[] {
	return [...html.matchAll(/<button data-date-picker-header-button="true"[^>]*>([^<]*)<\/button>/gu)].map(
		(m) => m[1],
	);
}

/** The visible text of each `a.menuItem` row, in order. */
function menuRows(html: string): string[] {
	return [...html.matchAll(/<a [^>]*class="[^"]*menuItem[^"]*"[^>]*>(.*?)<\/a>/gsu)].map((m) =>
		m[1].replaceAll(/<[^>]*>/gu, ""),
	);
}

describe("DatePickerPopup", () => {
	beforeEach(() => {
		vi.useFakeTimers({toFake: ["Date"]});
		vi.setSystemTime(new Date(2026, 9, 1, 10, 0));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders the static 42-day October 2026 grid with today outlined", () => {
		const html = render();
		const cells = dayCells(html);
		expect({
			count: cells.length,
			first: cells[0]?.label,
			last: cells.at(-1)?.label,
			today: cells.filter((c) => hasTokens(c.cell, ["font-bold", "border-tint"])).map((c) => c.label),
			selected: cells.filter((c) => c.cell.includes("!bg-tint")).map((c) => c.label),
			weekdays: weekdayLabels(html),
			headers: headerButtons(html),
			rows: menuRows(html),
		}).toStrictEqual({
			count: 42,
			first: "27",
			last: "7",
			today: ["1"],
			selected: [],
			weekdays: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
			headers: ["Oct", "2026"],
			rows: ["Today", "Tomorrow", "Next week", "Range", "Format"],
		});
	});

	it("copies upstream's shell, input row and today cell markup", () => {
		const html = render();
		expect({
			shell: html.startsWith(
				'<div class="wf-menu flex flex-col\n      border border-solid border-primary font-normal text-xs\n      rounded-md bg-primary shadow-md\n      overflow-x-hidden\n      [transition:200ms_opacity]\n      print:hidden absolute flyout menu [&amp;.menu]:py-0" style="pointer-events:auto;z-index:300;min-width:0;max-width:240px;margin-top:4px">',
			),
			input: html.includes(
				'<div class="flex items-center px-l py-m bg-secondary"><input type="text" autofocus="" placeholder="Type date" class="date-popup-input bg-inherit w-full border-0 text-primary placeholder:text-tertiary" value=""/></div>',
			),
			calendar: html.includes('<div data-keyboard-focus-scope="true" class="flex flex-col w-[220px]"><section>'),
			icons: [...html.matchAll(/data-icon="([^"]*)"/gu)]
				.map((m) => m[1])
				.filter((icon, i, all) => all.indexOf(icon) === i),
			activeButtons: [...html.matchAll(/data-date-picker-active-button="true"/gu)].length,
			enterFromAfter: [...html.matchAll(/data-keyboard-focus-enter-from-after="true"/gu)].length,
		}).toStrictEqual({
			shell: true,
			input: true,
			calendar: true,
			icons: ["sun-bright", "moon", "calendar-week", "chevron-left", "chevron-right", "circle-small", "gear"],
			activeButtons: 1,
			enterFromAfter: 1,
		});
	});

	it("starts the week on Monday when weekStartDay is 1", () => {
		const html = render({weekStartDay: 1});
		const cells = dayCells(html);
		expect({weekdays: weekdayLabels(html), first: cells[0]?.label, last: cells.at(-1)?.label}).toStrictEqual({
			weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
			first: "28",
			last: "8",
		});
	});

	it("fills the selected day with the tint color", () => {
		const html = render({selected: [new Date(2026, 9, 15)]});
		const selected = dayCells(html).filter((c) => hasTokens(c.cell, ["!text-on-color", "!bg-tint"]));
		expect(selected.map((c) => c.label)).toStrictEqual(["15"]);
	});

	it("drops the event dots and turns the Range toggle on in range mode", () => {
		const html = render({isRange: true});
		expect({
			dots: html.includes("circle-small"),
			toggle: /<label class="(toggle \w+)/u.exec(html)?.[1],
			track: html.includes('bg-tint"><div class="w-[10px] h-[10px] rounded-circle bg-white'),
			knob: html.includes("translate-x-[10px] mobile:translate-x-[22px]"),
		}).toStrictEqual({dots: false, toggle: "toggle on", track: true, knob: true});
	});

	it("shows the Range toggle off in single mode", () => {
		expect(/<label class="(toggle \w+)/u.exec(render())?.[1]).toBe("toggle off");
	});

	it("adds Remove date as the last row when opened from a pill", () => {
		expect(menuRows(render({showNoDate: true})).at(-1)).toBe("Remove date");
	});

	it("labels the YEAR view with its decade window", () => {
		const html = render({initialView: "YEAR"});
		expect({
			header: /<strong class="flex-1 text-left[^"]*">([^<]*)<\/strong>/u.exec(html)?.[1],
			years: [...html.matchAll(/data-date-picker-grid-button="true"[^>]*>(\d{4})<\/button>/gu)].map((m) => m[1]),
		}).toStrictEqual({
			header: "2019 - 2030",
			years: ["2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026", "2027", "2028", "2029", "2030"],
		});
	});

	it("lists the twelve short month names in the MONTH view", () => {
		const html = render({initialView: "MONTH"});
		expect({
			header: /<strong>(\d{4})<\/strong>/u.exec(html)?.[1],
			months: [...html.matchAll(/data-date-picker-grid-button="true"[^>]*>([A-Za-z]+)<\/button>/gu)].map(
				(m) => m[1],
			),
		}).toStrictEqual({
			header: "2026",
			months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
		});
	});
});
