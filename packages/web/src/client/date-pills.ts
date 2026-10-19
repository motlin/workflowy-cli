import {canonicalTimeAttributes, formatPillLabel, parseTimeAttrs, toTimeMarkup} from "@workflowy/shared";
import {plainCharAt} from "./rich-text.js";
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
