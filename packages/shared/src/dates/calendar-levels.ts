import {calendarDateId} from "../internal/calendar-day.js";
import type {CalendarLevel} from "../internal/calendar-day.js";

/** Upstream's calendar `dateId` for a local date: `YYYYMMDD` (day), `YYYYMM00` (month) or `YYYY0000` (year). */
export function dateId(level: CalendarLevel, date: Date): number {
	return calendarDateId(level, {year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate()});
}
