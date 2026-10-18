import dayjs from "dayjs";
import {toTimeMarkup} from "../dates/date-markup.js";

/** The calendar levels below the root, outermost first (weeks are not supported). */
export const CALENDAR_LEVELS = ["year", "month", "day"] as const;
export type CalendarLevel = (typeof CALENDAR_LEVELS)[number];

export interface CalendarDate {
	year: number;
	month: number;
	day: number;
}

/** Upstream's `metadata.calendar` for a level node, in upstream's key order. */
export interface CalendarLevelMetadata {
	level: CalendarLevel;
	value: string;
	timestamp: number;
	dateId: number;
}

/** No `📆 Calendar` root (a node whose cached metadata has `calendar.root`) is in the cache. */
export class CalendarRootMissing extends Error {
	constructor() {
		super("No calendar root is cached (run `cache import-api` to import node metadata)");
		this.name = "CalendarRootMissing";
	}
}

/** A `YYYYMMDD` day id as a date, or undefined when it is not a real calendar day. */
export function parseDateId(dateId: number): CalendarDate | undefined {
	if (!Number.isInteger(dateId) || dateId < 10_000_101 || dateId > 99_991_231) {
		return undefined;
	}
	const year = Math.floor(dateId / 10_000);
	const month = Math.floor(dateId / 100) % 100;
	const day = dateId % 100;
	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
		? {year, month, day}
		: undefined;
}

/** The level's `dateId`: `YYYY0000`, `YYYYMM00` or `YYYYMMDD`. */
export function calendarDateId(level: CalendarLevel, date: CalendarDate): number {
	const month = level === "year" ? 0 : date.month;
	const day = level === "day" ? date.day : 0;
	return date.year * 10_000 + month * 100 + day;
}

/** Upstream's `metadata(date)`: the unpadded value and local midnight of the level's first day. */
export function calendarLevelMetadata(level: CalendarLevel, date: CalendarDate): CalendarLevelMetadata {
	const month = level === "year" ? 1 : date.month;
	const day = level === "day" ? date.day : 1;
	const value = level === "year" ? date.year : level === "month" ? date.month : date.day;
	return {
		level,
		value: String(value),
		timestamp: new Date(date.year, month - 1, day).getTime(),
		dateId: calendarDateId(level, date),
	};
}

/** The token of `dateFormat` (outside `[...]` literals) upstream names a level with (`WX4`/`OX4`). */
function levelToken(level: "year" | "month", dateFormat: string): string {
	const format = dateFormat.replaceAll(/\[[^\]]*\]/gu, "");
	const tokens = level === "year" ? ["YYYY", "YY"] : ["MMMM", "MMM", "MM", "M"];
	return tokens.find((token) => format.includes(token)) ?? (level === "year" ? "YYYY" : "M");
}

/** A level node's name: year and month from the account date format, the day as a `<time>`. */
export function calendarLevelName(level: CalendarLevel, date: CalendarDate, dateFormat: string): string {
	if (level === "day") {
		return toTimeMarkup({startYear: date.year, startMonth: date.month, startDay: date.day});
	}
	const month = level === "year" ? 1 : date.month;
	return dayjs(new Date(date.year, month - 1, 1)).format(levelToken(level, dateFormat));
}

/**
 * Where upstream (`C9`) inserts a new level node: after every non-calendar
 * child and every same-level child with an earlier date, stopping at the first
 * same-level child that is not earlier. Other levels are passed over.
 */
export function calendarInsertIndex(
	children: ({level: string; dateId: number} | undefined)[],
	level: CalendarLevel,
	dateId: number,
): number {
	let index = 0;
	for (const [position, calendar] of children.entries()) {
		if (calendar === undefined) {
			index = position + 1;
		} else if (calendar.level === level) {
			if (calendar.dateId >= dateId) {
				break;
			}
			index = position + 1;
		}
	}
	return index;
}
