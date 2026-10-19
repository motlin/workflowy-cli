import * as chrono from "chrono-node";
import dayjs from "dayjs";
import type {Dayjs} from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import {DATE_FORMATS_SHORT} from "./date-markup.js";
import type {TimeAttrs} from "./date-markup.js";

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

export interface DatePhrase {
	/** Offset in the searched text where the date phrase starts. */
	start: number;
	/** Offset where the phrase (or a trailing range separator, or the caret past it) ends. */
	end: number;
	attrs: TimeAttrs;
}

/** Upstream's autocomplete chrono (`Rr`): no casual-time parser, and phrases of 3 chars or fewer (but "now") or ending `)` dropped. */
const phraseChrono = (() => {
	const parser = chrono.casual.clone();
	parser.parsers = parser.parsers.filter((each) => !each.constructor.name.includes("CasualTime"));
	parser.refiners.push({
		refine: (_context, results) =>
			results.filter(
				(result) =>
					!(result.text.length <= 3 && result.text.toLowerCase() !== "now") && !result.text.endsWith(")"),
			),
	});
	return parser;
})();

function escapeRegExp(text: string): string {
	return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function componentParts(component: chrono.ParsedComponents): {
	year: number;
	month: number;
	day: number;
	hour?: number;
	minute?: number;
} {
	const date = component.date();
	const parts = {year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate()};
	return component.isCertain("hour") ? {...parts, hour: date.getHours(), minute: date.getMinutes()} : parts;
}

function startAttrs(component: chrono.ParsedComponents): TimeAttrs {
	const {year, month, day, hour, minute} = componentParts(component);
	const attrs: TimeAttrs = {startYear: year, startMonth: month, startDay: day};
	return hour === undefined ? attrs : {...attrs, startHour: hour, startMinute: minute};
}

function endAttrs(component: chrono.ParsedComponents): Partial<TimeAttrs> {
	const {year, month, day, hour, minute} = componentParts(component);
	const attrs: Partial<TimeAttrs> = {endYear: year, endMonth: month, endDay: day};
	return hour === undefined ? attrs : {...attrs, endHour: hour, endMinute: minute};
}

function datePhraseIn(text: string, caret: number, now: Date): DatePhrase | undefined {
	for (const result of phraseChrono.parse(text, now, {forwardDate: true})) {
		const phrase = result.text.trim();
		const index = result.index + result.text.length - result.text.trimStart().length;
		const phraseEnd = index + phrase.length;
		const caretInPhrase = caret >= index && caret <= phraseEnd;
		const end = Math.max(caret, phraseEnd);
		const tail = text.slice(index, end);
		const start = startAttrs(result.start);
		if (result.end) {
			if (caretInPhrase && /\s?-\s?|\sto\s/u.test(tail)) {
				return {start: index, end, attrs: {...start, ...endAttrs(result.end)}};
			}
			continue;
		}
		if (new RegExp(String.raw`^${escapeRegExp(phrase)}(?:\sto\s|\s?-)\s?$`, "u").test(tail)) {
			const next = result.start.date();
			next.setDate(next.getDate() + 1);
			return {
				start: index,
				end,
				attrs: {...start, endYear: next.getFullYear(), endMonth: next.getMonth() + 1, endDay: next.getDate()},
			};
		}
		if (caretInPhrase) {
			return {start: index, end, attrs: start};
		}
	}
	return undefined;
}

/**
 * Upstream's date autocomplete (`z42`): the chrono date phrase in `text` that the collapsed
 * `caret` sits in or at the end of, trying the whole text and then the text up to the caret.
 * A range needs an explicit `-` or ` to `; a single date followed by a trailing `-` or ` to `
 * becomes a range ending one day later, its end then covering the separator.
 */
export function findDatePhrase(text: string, caret: number, now: Date = new Date()): DatePhrase | undefined {
	return datePhraseIn(text, caret, now) ?? datePhraseIn(text.slice(0, caret), caret, now);
}
