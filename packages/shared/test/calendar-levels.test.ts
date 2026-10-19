import {describe, expect, it} from "vite-plus/test";
import {dateId} from "../src/dates/calendar-levels.js";

describe("dateId", () => {
	it("keys a local date as YYYYMMDD, YYYYMM00 or YYYY0000 by calendar level", () => {
		const date = new Date(2026, 8, 30);

		expect([dateId("day", date), dateId("month", date), dateId("year", date)]).toStrictEqual([
			20_260_930, 20_260_900, 20_260_000,
		]);
	});
});
