import {describe, expect, it} from "vite-plus/test";
import {calendarDaysUrl, eventDayPredicate} from "../src/client/hooks/use-calendar-event-days.js";

describe("eventDayPredicate", () => {
	it("marks only the listed days of the fetched month", () => {
		const hasEvent = eventDayPredicate({year: 2026, month: 9}, [28, 29]);

		expect(
			[new Date(2026, 8, 27), new Date(2026, 8, 28), new Date(2026, 8, 29), new Date(2026, 9, 28)].map(hasEvent),
		).toStrictEqual([false, true, true, false]);
	});

	it("marks nothing before the month's days load", () => {
		expect(eventDayPredicate({year: 2026, month: 9}, undefined)(new Date(2026, 8, 28))).toBe(false);
	});
});

describe("calendarDaysUrl", () => {
	it("asks the server for one month", () => {
		expect(calendarDaysUrl({year: 2026, month: 9})).toBe("/api/v1/calendar/days?year=2026&month=9");
	});

	it("also asks for Found Dates days for the strip's picker", () => {
		expect(calendarDaysUrl({year: 2026, month: 9}, {found: true})).toBe(
			"/api/v1/calendar/days?year=2026&month=9&found=1",
		);
	});
});
