import {describe, expect, it} from "vite-plus/test";
import {formatMenuTimestamp} from "../src/client/menu-timestamp.js";

function localSeconds(year: number, month: number, day: number, hour: number, minute: number): number {
	return new Date(year, month - 1, day, hour, minute).getTime() / 1000;
}

const now = new Date(2026, 9, 1, 10, 5);

describe("formatMenuTimestamp", () => {
	it("formats the same calendar day as Today at HH:mm", () => {
		expect(formatMenuTimestamp(localSeconds(2026, 10, 1, 9, 13), now)).toBe("Today at 09:13");
	});

	it("formats an earlier day of the same year with weekday, month and day", () => {
		expect(formatMenuTimestamp(localSeconds(2026, 9, 30, 22, 4), now)).toBe("Wed, Sep 30 at 22:04");
	});

	it("adds the year when it differs from now", () => {
		expect(formatMenuTimestamp(localSeconds(2025, 12, 31, 8, 0), now)).toBe("Wed, Dec 31, 2025 at 08:00");
	});

	it("uses 24-hour time for midnight", () => {
		expect(formatMenuTimestamp(localSeconds(2026, 10, 1, 0, 0), now)).toBe("Today at 00:00");
	});
});
