import {canonicalTimeAttributes, formatPillLabel, parseTimeAttrs, toTimeMarkup} from "@workflowy/shared";
import type {TimeAttrs} from "@workflowy/shared";
import {plainCharAt, plainLength, splitHtml} from "./rich-text.js";
import type {DateSettings} from "./date-settings.js";

const BOM = "﻿";
const PILL_ATTRS =
	'data-monolith="true" contenteditable="false" class="explosive monolith-pill" title="⌥click to search"';
// <time> elements never nest, so a lazy match up to the first close tag is exact.
const TIME_PATTERN = /<time\b([^>]*)>[\s\S]*?<\/time>/giu;

function lowercaseAttrNames(attrText: string): string {
	return attrText.replaceAll(/([A-Za-z-]+)(?=\s*=)/gu, (name) => name.toLowerCase());
}

/** Display-mode HTML: each stored `<time>` becomes upstream's non-editable monolith pill. */
export function renderDatePills(html: string, settings: DateSettings, now: Date = new Date()): string {
	return html.replaceAll(TIME_PATTERN, (match, attrText: string, offset: number) => {
		const label = formatPillLabel(parseTimeAttrs(attrText), {
			dateFormat: settings.dateFormat,
			timeFormat: settings.timeFormat,
			now,
		});
		const attrs = lowercaseAttrNames(attrText.trim());
		const trailer = offset + match.length === html.length ? BOM : "";
		return `<time ${PILL_ATTRS} ${attrs}>${BOM}<span class="content-wrapper">${label}</span>${BOM}</time>${trailer}`;
	});
}

/**
 * Stored HTML from editor HTML: each `<time>` (a rendered pill or a raw element) becomes
 * canonical camelCase markup with markup-format inner text, and the pills' U+FEFF caret
 * guards are dropped. A `<time>` without a full start date keeps its text, attributes camelCased.
 */
export function serializeDatePills(html: string): string {
	return html
		.replaceAll(TIME_PATTERN, (match, attrText: string) => {
			try {
				return toTimeMarkup(parseTimeAttrs(attrText));
			} catch {
				return canonicalTimeAttributes(match);
			}
		})
		.replaceAll(BOM, "");
}

function deletePillAt(html: string, index: number): string | null {
	const char = index < 0 ? null : plainCharAt(html, index);
	return char !== null && /^<time\b/iu.test(char.raw) ? char.without : null;
}

/** Backspace right after a pill (at plain-text `offset`, a pill counting one) deletes the whole pill, else null. */
export function deletePillBeforeCaret(html: string, offset: number): string | null {
	return deletePillAt(html, offset - 1);
}

/** Delete right before a pill (at plain-text `offset`, a pill counting one) deletes the whole pill, else null. */
export function deletePillAfterCaret(html: string, offset: number): string | null {
	return deletePillAt(html, offset);
}

const BANG = /^[!！]$/u;
const EDGE = /^\s$/u;

/**
 * Upstream's `symbol.spaced` `!!` trigger: the two characters before `caret` in plain `text`
 * are `!` or `！`, preceded by whitespace or the start and followed by whitespace or the end.
 */
export function shouldTriggerDatePopup(text: string, caret: number): boolean {
	const before = text[caret - 3];
	const after = text[caret];
	return (
		caret >= 2 &&
		BANG.test(text[caret - 1] ?? "") &&
		BANG.test(text[caret - 2] ?? "") &&
		(before === undefined || EDGE.test(before)) &&
		(after === undefined || EDGE.test(after))
	);
}

/** `<time>` attributes for a picked day, or for a range sorted start to end (months 1-based). */
export function timeAttrsFromDates(dates: Date[]): TimeAttrs {
	const [start, end] = dates.toSorted((a, b) => a.getTime() - b.getTime());
	if (start === undefined) {
		throw new Error("timeAttrsFromDates needs at least one date");
	}
	const attrs: TimeAttrs = {
		startYear: start.getFullYear(),
		startMonth: start.getMonth() + 1,
		startDay: start.getDate(),
	};
	if (end !== undefined) {
		attrs.endYear = end.getFullYear();
		attrs.endMonth = end.getMonth() + 1;
		attrs.endDay = end.getDate();
	}
	return attrs;
}

/**
 * Stored HTML after inserting a date pill at plain-text `caretOffset` (a pill counting one),
 * plus one space only when nothing follows, and the caret offset right after it all.
 */
export function planDateInsertion(
	html: string,
	caretOffset: number,
	attrs: TimeAttrs,
): {html: string; caretOffset: number} {
	const {before, after} = splitHtml(html, caretOffset, caretOffset);
	const space = plainLength(after) === 0 ? " " : "";
	return {
		html: `${before}${toTimeMarkup(attrs)}${space}${after}`,
		caretOffset: plainLength(before) + 1 + space.length,
	};
}

/**
 * Stored HTML with the `pillIndex`-th `<time>` replaced by markup for `attrs` (dropping any
 * hours and minutes the old pill had, as upstream does), or removed when `attrs` is null.
 * Surrounding text, including the space before the pill, is kept and no space is added.
 */
export function replacePill(html: string, pillIndex: number, attrs: TimeAttrs | null): string {
	let index = 0;
	return html.replaceAll(TIME_PATTERN, (match) => {
		const current = index;
		index += 1;
		if (current !== pillIndex) {
			return match;
		}
		return attrs === null ? "" : toTimeMarkup(attrs);
	});
}
