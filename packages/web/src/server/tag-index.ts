/**
 * Upstream's `AppTagIndex.autocomplete` over cached rows: count the tags in a
 * set of items, keep the ones matching a prefix, and rank them.
 */

import {stripHtmlTags} from "@workflowy/shared/html";
import {findTags} from "@workflowy/shared/tags";

export interface TagCount {
	tag: string;
	count: number;
}

export interface TagRow {
	name: string | null;
	note: string | null;
}

const TEMPLATE_TAG_PREFIX = "#use-template";

/** Count each tag once per item, case-insensitively, keeping its first-seen casing. */
function countTags(rows: Iterable<TagRow>): TagCount[] {
	const counts = new Map<string, TagCount>();
	for (const {name, note} of rows) {
		const text = `${stripHtmlTags(name)}\n${stripHtmlTags(note)}`;
		const seen = new Set<string>();
		for (const {tag} of findTags(text)) {
			const lower = tag.toLowerCase();
			if (seen.has(lower) || lower.startsWith(TEMPLATE_TAG_PREFIX)) {
				continue;
			}
			seen.add(lower);
			const entry = counts.get(lower);
			if (entry) {
				entry.count++;
			} else {
				counts.set(lower, {tag, count: 1});
			}
		}
	}
	return [...counts.values()];
}

function startsWithDigit(tag: string): boolean {
	return /^\d$/u.test(tag.charAt(1));
}

/** Count desc; on a tie a tag with a digit at index 1 goes last; else plain `<` on the tag. */
function compareTags(a: TagCount, b: TagCount): number {
	if (a.count !== b.count) {
		return b.count - a.count;
	}
	const digitOrder = Number(startsWithDigit(a.tag)) - Number(startsWithDigit(b.tag));
	if (digitOrder !== 0) {
		return digitOrder;
	}
	if (a.tag === b.tag) {
		return 0;
	}
	return a.tag < b.tag ? -1 : 1;
}

export function rankTags(rows: Iterable<TagRow>, {prefix, limit}: {prefix: string; limit: number}): TagCount[] {
	const prefixLower = prefix.toLowerCase();
	return countTags(rows)
		.filter(({tag}) => tag.toLowerCase().startsWith(prefixLower))
		.toSorted(compareTags)
		.slice(0, limit);
}

/** Fill `primary` up to `limit` from `fallback`, skipping tags already listed. */
export function mergeFallback(primary: TagCount[], fallback: TagCount[], limit: number): TagCount[] {
	const listed = new Set(primary.map(({tag}) => tag.toLowerCase()));
	const extra = fallback.filter(({tag}) => !listed.has(tag.toLowerCase()));
	return [...primary, ...extra].slice(0, limit);
}
