import {formatPillLabel, parseTimeAttrs} from "@workflowy/shared";

export interface DateSettings {
	dateFormat: string;
	timeFormat: string;
	weekStartDay: number;
}

/** Upstream's default date settings until user preferences are wired in. */
export const DEFAULT_DATE_SETTINGS: DateSettings = {dateFormat: "YYYY-MM-DD ddd", timeFormat: "HH:mm", weekStartDay: 0};

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
