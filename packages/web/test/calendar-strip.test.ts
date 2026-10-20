import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vite-plus/test";
import {
	attachDragScroll,
	calendarPageDate,
	monthCellTarget,
	scrollDelta,
	stripNav,
} from "../src/client/calendar-strip-model.js";
import {CalendarStripView} from "../src/client/components/calendar-strip-view.js";
import type {CalendarStripViewProps} from "../src/client/components/calendar-strip-view.js";

const NOW = new Date(2026, 9, 2, 10, 0);
const SEPARATOR = '<div class="h-[22px] border-l border-solid border-secondary"></div>';

function render(props: Partial<CalendarStripViewProps> = {}): string {
	return renderToStaticMarkup(
		createElement(CalendarStripView, {
			level: "day",
			date: new Date(2026, 8, 30),
			now: NOW,
			weekStartDay: 0,
			dots: new Set<number>(),
			onNavigate: () => {},
			...props,
		}),
	);
}

/** Each `[data-ts]` cell: its timestamp, label text, card class tokens and card text. */
function cells(html: string) {
	return [
		...html.matchAll(
			/<div data-ts="(\d+)" class="[^"]*"><div class="h-\[18px\] flex items-start justify-center">(?:<span class="text-2xs uppercase">([^<]*)<\/span>)?<\/div><div class="([^"]*)">(.*?)<\/div><\/div>(?=<div data-ts|<div class="flex-shrink-0"|<div><div|<\/div><\/div><\/div>$)/gu,
		),
	].map((m) => ({
		ts: Number(m[1]),
		label: m.at(2) ?? null,
		card: m[3].split(/\s+/u).filter(Boolean),
		text: m[4].replaceAll(/<[^>]*>/gu, ""),
		dot: /opacity-1/u.test(m[4]),
	}));
}

describe("CalendarStripView", () => {
	it("renders upstream's day page strip: 31 day cells from the zoomed date, a separator, then 12 month cells", () => {
		const html = render({dots: new Set([20_260_930, 20_261_005])});
		const all = cells(html);
		const days = all.slice(0, 31);
		const months = all.slice(31);

		expect({
			outer: html.startsWith(
				'<div class="flex items-center pb-l"><div class="desktop:-ml-[1px] mobile:-ml-[7px] mr-s">',
			),
			count: all.length,
			first: days[0],
			second: {label: days[1]?.label, text: days[1]?.text},
			today: days[2]?.card,
			dotted: days.filter((day) => day.dot).map((day) => day.text),
			lastDay: days[30]?.text,
			separator: html.includes(SEPARATOR),
			months: months.map((month) => [month.label, month.text]),
			monthCard: months[0]?.card,
			icons: [...html.matchAll(/data-icon="([^"]*)"/gu)].map((m) => m[1]).slice(0, 3),
		}).toStrictEqual({
			outer: true,
			count: 43,
			first: {
				ts: new Date(2026, 8, 30).getTime(),
				label: "Sep",
				card: [
					"!bg-secondary",
					"hover:!bg-tertiary",
					"w-[28px]",
					"mobile:w-[32px]",
					"h-[38px]",
					"mobile:h-[44px]",
					"py-2xs",
					"box-border",
					"rounded-s",
					"flex",
					"flex-col",
					"justify-center",
					"items-center",
					"cursor-pointer",
					"transition-transform",
				],
				text: "We30",
				dot: true,
			},
			second: {label: "Oct", text: "Th1"},
			today: [
				"bg-tertiary",
				"hover:bg-quaternary",
				"w-[28px]",
				"mobile:w-[32px]",
				"h-[38px]",
				"mobile:h-[44px]",
				"py-2xs",
				"box-border",
				"rounded-s",
				"flex",
				"flex-col",
				"justify-center",
				"items-center",
				"cursor-pointer",
				"transition-transform",
			],
			dotted: ["We30", "Mo5"],
			lastDay: "Fr30",
			separator: true,
			months: [
				["2026", "Oct"],
				[null, "Nov"],
				[null, "Dec"],
				["2027", "Jan"],
				[null, "Feb"],
				[null, "Mar"],
				[null, "Apr"],
				[null, "May"],
				[null, "Jun"],
				[null, "Jul"],
				[null, "Aug"],
				[null, "Sep"],
			],
			monthCard: [
				"bg-primary",
				"hover:bg-secondary",
				"box-border",
				"rounded-s",
				"px-s",
				"min-w-[28px]",
				"mobile:min-w-[32px]",
				"h-[38px]",
				"mobile:h-[44px]",
				"flex",
				"justify-center",
				"items-center",
				"cursor-pointer",
				"transition-transform",
			],
			icons: ["chevron-left", "calendar-days", "chevron-right"],
		});
	});

	it("prepends a Today card and its separator when the strip starts after today", () => {
		const html = render({date: new Date(2026, 9, 10), todayDot: true});
		const [today, first] = cells(html);

		expect({
			today,
			first: first.ts,
			separatorAfterToday: html.includes(
				`</div></div></div><div class="flex-shrink-0"><div class="h-[18px] flex items-center"></div><div class="h-[38px] mobile:h-[44px] flex justify-center items-center">${SEPARATOR}`,
			),
		}).toStrictEqual({
			today: {
				ts: new Date(2026, 9, 2).getTime(),
				label: "Today",
				card: [
					"bg-tertiary",
					"hover:bg-quaternary",
					"w-[28px]",
					"mobile:w-[32px]",
					"h-[38px]",
					"mobile:h-[44px]",
					"py-2xs",
					"box-border",
					"rounded-s",
					"flex",
					"flex-col",
					"justify-center",
					"items-center",
					"cursor-pointer",
					"transition-transform",
				],
				text: "Fr2",
				dot: true,
			},
			first: new Date(2026, 9, 10).getTime(),
			separatorAfterToday: true,
		});
	});

	it("shows only the year's twelve months, without a separator, on a year page", () => {
		const html = render({level: "year", date: new Date(2026, 0, 1)});

		expect({
			months: cells(html).map((cell) => [cell.label, cell.text]),
			separator: html.includes(SEPARATOR),
		}).toStrictEqual({
			months: [
				["2026", "Jan"],
				[null, "Feb"],
				[null, "Mar"],
				[null, "Apr"],
				[null, "May"],
				[null, "Jun"],
				[null, "Jul"],
				[null, "Aug"],
				[null, "Sep"],
				[null, "Oct"],
				[null, "Nov"],
				[null, "Dec"],
			],
			separator: false,
		});
	});
});

describe("calendar strip navigation", () => {
	it("gives the arrows upstream's tooltips and the adjacent page at the zoomed level", () => {
		expect([
			stripNav("day", new Date(2026, 8, 30), NOW, 0),
			stripNav("day", new Date(2026, 9, 1), NOW, 0),
			stripNav("month", new Date(2026, 9, 1), NOW, 0),
		]).toStrictEqual([
			{
				prev: {tooltip: "Previous day", target: {date: new Date(2026, 8, 29), level: "day"}},
				next: {tooltip: "Next day", target: {date: new Date(2026, 9, 1), level: "day"}},
			},
			{
				prev: {tooltip: "Previous day", target: {date: new Date(2026, 8, 30), level: "day"}},
				next: {tooltip: "Today", target: {date: new Date(2026, 9, 2), level: "day"}},
			},
			{
				prev: {tooltip: "Previous month", target: {date: new Date(2026, 8, 1), level: "month"}},
				next: {tooltip: "Next month", target: {date: new Date(2026, 10, 1), level: "month"}},
			},
		]);
	});

	it("sends a month cell to that month node on month and year pages, else to its first day", () => {
		const nov = new Date(2026, 10, 1);
		expect([
			monthCellTarget("day", nov),
			monthCellTarget("month", nov),
			monthCellTarget("year", nov),
		]).toStrictEqual([
			{date: nov},
			{date: nov, level: "month", createChild: false},
			{date: nov, level: "month", createChild: false},
		]);
	});

	it("reads a page's date from its day, month or year dateId", () => {
		expect([
			calendarPageDate(20_260_930),
			calendarPageDate(20_261_000),
			calendarPageDate(20_260_000),
		]).toStrictEqual([new Date(2026, 8, 30), new Date(2026, 9, 1), new Date(2026, 0, 1)]);
	});

	it("scrolls by the offset of the cell from the scroller's left edge", () => {
		const cell = {getBoundingClientRect: () => ({left: 340})};
		const scroller = {
			getBoundingClientRect: () => ({left: 100}),
			querySelector: (selector: string) => (selector === '[data-ts="5"]' ? cell : null),
		};
		expect([scrollDelta(scroller, 5), scrollDelta(scroller, 6)]).toStrictEqual([240, null]);
	});
});

class FakeScroller extends EventTarget {
	scrollLeft = 50;
	style = {cursor: ""};
}

function mouse(type: string, clientX: number, button = 0): Event {
	return Object.assign(new Event(type, {cancelable: true}), {clientX, button});
}

describe("attachDragScroll", () => {
	it("scrolls with a left-button drag past 4px, shows grabbing, and swallows the one click that follows", () => {
		const scroller = new FakeScroller();
		const doc = new EventTarget();
		attachDragScroll(scroller, doc);

		scroller.dispatchEvent(mouse("mousedown", 100));
		doc.dispatchEvent(mouse("mousemove", 97));
		const small = {scrollLeft: scroller.scrollLeft, cursor: scroller.style.cursor};
		doc.dispatchEvent(mouse("mousemove", 90));
		const dragging = {scrollLeft: scroller.scrollLeft, cursor: scroller.style.cursor};
		doc.dispatchEvent(mouse("mouseup", 90));
		const swallowed = mouse("click", 90);
		scroller.dispatchEvent(swallowed);
		const next = mouse("click", 90);
		scroller.dispatchEvent(next);

		expect({
			small,
			dragging,
			cursorAfter: scroller.style.cursor,
			swallowed: swallowed.defaultPrevented,
			next: next.defaultPrevented,
		}).toStrictEqual({
			small: {scrollLeft: 50, cursor: ""},
			dragging: {scrollLeft: 60, cursor: "grabbing"},
			cursorAfter: "",
			swallowed: true,
			next: false,
		});
	});

	it("leaves plain clicks and other buttons alone, and detaches on cleanup", () => {
		const scroller = new FakeScroller();
		const doc = new EventTarget();
		const detach = attachDragScroll(scroller, doc);

		scroller.dispatchEvent(mouse("mousedown", 100));
		doc.dispatchEvent(mouse("mouseup", 100));
		const plain = mouse("click", 100);
		scroller.dispatchEvent(plain);
		scroller.dispatchEvent(mouse("mousedown", 100, 2));
		doc.dispatchEvent(mouse("mousemove", 50));
		const rightDrag = scroller.scrollLeft;
		doc.dispatchEvent(mouse("mouseup", 50));
		detach();
		scroller.dispatchEvent(mouse("mousedown", 100));
		doc.dispatchEvent(mouse("mousemove", 50));

		expect({plain: plain.defaultPrevented, rightDrag, detached: scroller.scrollLeft}).toStrictEqual({
			plain: false,
			rightDrag: 50,
			detached: 50,
		});
	});
});
