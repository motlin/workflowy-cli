import * as chrono from "chrono-node";
import dayjs from "dayjs";
import type {Dayjs} from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import {DATE_FORMATS_SHORT} from "./date-markup.js";

dayjs.extend(customParseFormat);

const DEFAULT_DATE_FORMAT: string = DATE_FORMATS_SHORT[0];

export interface ParsedDate {
	start: Date;
	end?: Date;
}

export interface GuessDatesOptions {
	dateFormat?: string;
	now?: Date;
}

export interface PresetDateOptions {
	/** 0 = Sunday (default), 1 = Monday. */
	weekStartDay?: number;
	now?: Date;
}

export type DatePreset = "today" | "tomorrow" | "next week";

/** Upstream's `jd4`: true when the format puts the day before the month. */
function isDayFirst(format: string): boolean {
	const core = format.replace(/^d+[,\s]*/u, "");
	const day = core.indexOf("D");
	const month = core.indexOf("M");
	if (day === -1) {
		return false;
	}
	if (month === -1) {
		return true;
	}
	return day < month;
}

const PADDED_MONTH = /\bMM(?!M)\b/u;
const PADDED_DAY = /\bDD(?!D)\b/u;

/**
 * Port of upstream's `vi1` (`WF.Date.parse`): a strict dayjs parse with the current date
 * format, then the same fallback chain — strip a leading weekday, keep only the D/M/Y
 * core, allow two-digit and missing years, single-digit month/day, bare `d/m` or `m/d`
 * per the format's order, and a ` - ` split for ranges. Formats without a year take
 * `now`'s year.
 */
export function parseWithFormat(
	term: string,
	dateFormat: string = DEFAULT_DATE_FORMAT,
	now = new Date(),
): ParsedDate | undefined {
	const parsed = parseDayjs(term, dateFormat, now);
	if (!parsed) {
		return undefined;
	}
	return parsed.end ? {start: parsed.start.toDate(), end: parsed.end.toDate()} : {start: parsed.start.toDate()};
}

function twoDigitYear(result: Dayjs): Dayjs {
	return result.isValid() && result.year() < 100 ? result.add(2000, "year") : result;
}

function parseDayjs(input: string, dateFormat: string, now: Date): {start: Dayjs; end?: Dayjs} | undefined {
	const term = input.trim();
	const strict = (text: string, format: string): Dayjs => {
		const result = dayjs(text, format, true);
		return result.isValid() && !/Y/u.test(format) ? result.year(now.getFullYear()) : result;
	};
	const relaxedPadding = (text: string, format: string): Dayjs => {
		let result = strict(text, format);
		if (!result.isValid()) {
			result = strict(text, format.replace(PADDED_MONTH, "M"));
		}
		if (!result.isValid()) {
			result = strict(text, format.replace(PADDED_DAY, "D"));
		}
		if (!result.isValid()) {
			result = strict(text, format.replace(PADDED_MONTH, "M").replace(PADDED_DAY, "D"));
		}
		return result;
	};

	let format = dateFormat;
	let result = strict(term, format);
	if (!result.isValid() && format.startsWith("dd ")) {
		format = format.slice(3).trim();
		result = strict(term, format);
	}
	if (!result.isValid() && format.startsWith("ddd ")) {
		format = format.slice(4).trim();
		result = strict(term, format);
	}
	if (!result.isValid() && format.startsWith("ddd,")) {
		format = format.slice(4).trim();
		result = strict(term, format);
		if (!result.isValid()) {
			result = strict(term.slice(4).trim(), format);
		}
	}
	if (!result.isValid()) {
		const core = format
			.replaceAll(/\[.*?\]/gu, (literal) => "_".repeat(literal.length))
			.match(/[DMY].*[DMY]|[DMY]/u);
		if (core?.index !== undefined) {
			const coreFormat = format.slice(core.index, core.index + core[0].length);
			if (coreFormat !== format) {
				format = coreFormat;
				result = strict(term, format);
			}
		}
	}
	if (!result.isValid() && format.endsWith("YYYY")) {
		result = strict(term, format.slice(0, -2));
	}
	if (!result.isValid()) {
		if (format.endsWith("YYYY")) {
			format = format.slice(0, -3);
		}
		result = twoDigitYear(relaxedPadding(term, format));
	}
	if (!result.isValid()) {
		const yearless = dateFormat.replaceAll(/[./-]?Y{1,4}[./-]?/gu, "").trim();
		if (yearless) {
			result = relaxedPadding(term, yearless);
		}
	}
	if (!result.isValid()) {
		const numeric = term.match(/^(\d{1,2})([/.])(\d{1,2})(?:\2\d{2,4})?$/u);
		if (numeric) {
			const separator = numeric[2] ?? "/";
			const [first, second] = isDayFirst(dateFormat) ? ["D", "M"] : ["M", "D"];
			const short = `${first}${separator}${second}`;
			const padded = `${first.repeat(2)}${separator}${second.repeat(2)}`;
			result = strict(term, `${short}${separator}Y`);
			if (!result.isValid()) {
				result = strict(term, short);
			}
			if (!result.isValid()) {
				result = strict(term, `${padded}${separator}Y`);
			}
			if (!result.isValid()) {
				result = strict(term, padded);
			}
			result = twoDigitYear(result);
		}
	}
	if (result.isValid()) {
		return {start: result};
	}
	if (term.includes(" - ")) {
		const [first, second, ...rest] = term.split(" - ");
		if (first !== undefined && second !== undefined && rest.length === 0) {
			const start = parseDayjs(first, dateFormat, now);
			const end = parseDayjs(second, dateFormat, now);
			if (start && end) {
				return {start: start.start, end: end.start};
			}
		}
	}
	return undefined;
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Guess the date (or `[start, end]` range) a picker input means, as local midnights:
 * `parseWithFormat` first, also on the date half of a `<time> on <date>` pill label,
 * then chrono, accepted only when it finds exactly one result. `[]` when nothing parses.
 */
export function guessDates(term: string, options: GuessDatesOptions = {}): Date[] {
	const {dateFormat = DEFAULT_DATE_FORMAT, now = new Date()} = options;
	const timed = term.trim().match(/^\S+ on (.+)$/u);
	const parsed =
		parseWithFormat(term, dateFormat, now) ?? (timed?.[1] ? parseWithFormat(timed[1], dateFormat, now) : undefined);
	if (parsed) {
		return parsed.end ? [parsed.start, parsed.end] : [parsed.start];
	}

	const results = chrono.parse(term, now, {forwardDate: true});
	const [result, ...others] = results;
	if (!result || others.length > 0) {
		return [];
	}
	const start = startOfDay(result.start.date());
	return result.end ? [start, startOfDay(result.end.date())] : [start];
}

/** The date a picker preset applies; "next week" is the first day of next week per `weekStartDay`. */
export function presetDate(preset: DatePreset, options: PresetDateOptions = {}): Date {
	const {weekStartDay = 0, now = new Date()} = options;
	const today = startOfDay(now);
	if (preset === "today") {
		return today;
	}
	if (preset === "tomorrow") {
		return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
	}
	const daysIntoWeek = (today.getDay() - weekStartDay + 7) % 7;
	return new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysIntoWeek + 7);
}
