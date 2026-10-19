import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import {DATE_FORMATS_SHORT, parseTimeAttrs} from "../../dates/date-markup.js";
import type {TimeAttrs} from "../../dates/date-markup.js";
import type {SearchItem, SearchOperator} from "../query-nodes.js";
import {MetaNode} from "./meta.js";

dayjs.extend(customParseFormat);

const TIME_TAG = /<time\b([^>]*)>/giu;
const TIME_FORMAT = "HH:mm";

function rowDates(item: SearchItem): TimeAttrs[] {
	return [item.nameHtml, item.noteHtml].flatMap((html) =>
		[...html.matchAll(TIME_TAG)].flatMap((match) => {
			try {
				return [parseTimeAttrs(match[1] ?? "")];
			} catch {
				return [];
			}
		}),
	);
}

/** Port of upstream's date-attribute matcher: the start (hour defaulting to 0) or the end at 00:00. */
function rowTimestamps(attrs: TimeAttrs): number[] {
	const start = new Date(
		attrs.startYear,
		attrs.startMonth - 1,
		attrs.startDay,
		attrs.startHour ?? 0,
		attrs.startMinute ?? 0,
	).getTime();
	if (attrs.endYear === undefined || attrs.endMonth === undefined || attrs.endDay === undefined) {
		return [start];
	}
	return [start, new Date(attrs.endYear, attrs.endMonth - 1, attrs.endDay).getTime()];
}

const hasDate = (item: SearchItem): boolean => /<time\b/iu.test(item.nameHtml) || /<time\b/iu.test(item.noteHtml);

function dateNode(test: ((timestamp: number) => boolean) | null): MetaNode {
	return new MetaNode((item) => test !== null && rowDates(item).some((attrs) => rowTimestamps(attrs).some(test)), {
		hasSearchTypeValue: hasDate,
	});
}

const predefined = (candidate: string): boolean => (DATE_FORMATS_SHORT as readonly string[]).includes(candidate);

/** Upstream's `normalizeFormat`: a predefined format without spaces, else a numeric fallback in D/M order. */
function normalizeFormat(format: string): string {
	if (predefined(format) && !format.includes(" ")) {
		return format;
	}
	const found = format.split(" ").find(predefined);
	if (found !== undefined) {
		return found;
	}
	const day = format.search(/\bD[Do]?\b/u);
	const month = format.search(/\bM{1,4}\b/u);
	return day >= 0 && month >= 0 && day < month ? "DD/MM/YYYY" : "MM/DD/YYYY";
}

function product(lists: (string | null)[][]): (string | null)[][] {
	return lists.reduce<(string | null)[][]>(
		(acc, list) => acc.flatMap((prefix) => list.map((v) => [...prefix, v])),
		[[]],
	);
}

const SEGMENT_OPTIONS: Record<string, (string | null)[]> = {Y: [null, "YY", "YYYY"], M: ["M", "MM"], D: ["D", "DD"]};

/**
 * Port of upstream's strict `date:` value parse: every Y/YY/YYYY x M/MM x D/DD variant of the account format,
 * each with and without `@HH:mm`. Returns null when no variant parses.
 */
export function parseStrictDate(value: string, dateFormat: string): number | null {
	const format = normalizeFormat(dateFormat);
	const separator = [".", "/", "-"].find((sep) => format.includes(sep));
	if (separator === undefined) {
		return null;
	}
	const segments = format.split(separator).map((part) => SEGMENT_OPTIONS[part[0] ?? ""] ?? [part]);
	const dateFormats = product(segments).map((parts) => parts.filter((part) => part !== null).join(separator));
	for (const candidate of dateFormats.flatMap((date) => [date, `${date}@${TIME_FORMAT}`])) {
		const parsed = dayjs(value, candidate, true);
		if (parsed.isValid()) {
			return parsed.valueOf();
		}
	}
	return null;
}

export const past: SearchOperator = {
	name: "date:past",
	matchesToken: (token) => token === "date:past",
	create(_token, _rawToken, context) {
		const today = new Date(context.now);
		today.setHours(0, 0, 0, 0);
		return dateNode((timestamp) => timestamp < today.getTime());
	},
};

export const future: SearchOperator = {
	name: "date:future",
	matchesToken: (token) => token === "date:future",
	create: (_token, _rawToken, context) => dateNode((timestamp) => timestamp > context.now),
};

function strict(prefix: string, compare: (timestamp: number, target: number) => boolean): SearchOperator {
	return {
		name: prefix,
		matchesToken: (token) => token.startsWith(prefix),
		create(token, _rawToken, context) {
			const target = parseStrictDate(token.slice(prefix.length), context.dateFormat);
			return dateNode(target === null ? null : (timestamp) => compare(timestamp, target));
		},
	};
}

export const on = strict("date:", (timestamp, target) => timestamp === target);
export const before = strict("date-before:", (timestamp, target) => timestamp < target);
export const after = strict("date-after:", (timestamp, target) => timestamp > target);

const DAY_OF_WEEK = "day-of-week:";
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export const dayOfWeek: SearchOperator = {
	name: DAY_OF_WEEK,
	matchesToken: (token) =>
		token.startsWith(DAY_OF_WEEK) && DAY_NAMES.includes(token.slice(DAY_OF_WEEK.length).trim()),
	create(token) {
		const day = DAY_NAMES.indexOf(token.slice(DAY_OF_WEEK.length).trim());
		return dateNode((timestamp) => new Date(timestamp).getDay() === day);
	},
};
