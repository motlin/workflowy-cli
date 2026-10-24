import {formatTimeLabel, parseTimeAttrs, parseTimeAttrsLoose} from "@workflowy/shared";
import {stripHtmlTags} from "@workflowy/shared/html";
import {MENTION_PATTERN, parseMentionAttrs, resolveMentionName} from "./mention-pills.js";
import type {MentionAccount} from "./mention-pills.js";

export type FriendlyPrefix = "Yesterday" | "Today" | "Tomorrow";

const DAY_MS = 24 * 60 * 60 * 1000;

function dayOf(date: Date): number {
	return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Upstream's relative day name for `date` as seen from `now`, or null beyond one day either way. */
export function friendlyPrefix(date: Date, now: Date): FriendlyPrefix | null {
	const offset = Math.round((dayOf(date) - dayOf(now)) / DAY_MS);
	if (offset === -1) {
		return "Yesterday";
	}
	if (offset === 0) {
		return "Today";
	}
	if (offset === 1) {
		return "Tomorrow";
	}
	return null;
}

export interface CrumbLabelOptions {
	now: Date;
	dateFormat?: string;
	dayPrefix?: boolean;
	account?: MentionAccount;
}

const TIME_PATTERN = /<time\b([^>]*)>[\s\S]*?<\/time>/giu;
const SINGLE_TIME_PATTERN = /^\s*<time\b([^>]*)>[\s\S]*?<\/time>\s*$/iu;

/** Plain crumb text: `<time>` pills rendered as formatted dates, other tags stripped, a day name prefixed. */
export function crumbLabel(
	nameHtml: string,
	{now, dateFormat = "YYYY-MM-DD ddd", dayPrefix = true, account = null}: CrumbLabelOptions,
): string {
	const label = stripHtmlTags(
		nameHtml
			.replaceAll(TIME_PATTERN, (_match, attrText: string) =>
				formatTimeLabel(parseTimeAttrsLoose(attrText), {dateFormat, now}),
			)
			.replaceAll(MENTION_PATTERN, (_match, attrText: string) =>
				resolveMentionName(parseMentionAttrs(attrText).id, account),
			),
	);
	const single = dayPrefix ? SINGLE_TIME_PATTERN.exec(nameHtml) : null;
	if (single?.[1] === undefined) {
		return label;
	}
	const loose = parseTimeAttrsLoose(single[1]);
	if (loose.startYear === undefined || loose.startMonth === undefined || loose.startDay === undefined) {
		return label;
	}
	const attrs = parseTimeAttrs(single[1]);
	if (attrs.endYear !== undefined || attrs.startHour !== undefined) {
		return label;
	}
	const prefix = friendlyPrefix(new Date(attrs.startYear, attrs.startMonth - 1, attrs.startDay), now);
	return prefix === null ? label : `${prefix}, ${label}`;
}
