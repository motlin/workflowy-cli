/**
 * Upstream's `AppTagIndex.autocomplete` over cached rows: count the tags in a
 * set of items, keep the ones matching a prefix, and rank them.
 */

import {stripHtmlTags} from "@workflowy/shared/html";
import {nodeContent} from "@workflowy/shared/db";
import {findTags} from "@workflowy/shared/tags";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {eq} from "drizzle-orm";
import type {Database} from "./tree-snapshot.js";
import {changeToken} from "./tree-snapshot.js";

export interface TagCount {
	tag: string;
	count: number;
}

export interface TagRow {
	name: string | null;
	note: string | null;
}

const TEMPLATE_TAG_PREFIX = "#use-template";

/** An item's distinct tags (case-insensitive, first-seen casing), skipping #use-template tags. */
function itemTags({name, note}: TagRow): Map<string, string> {
	const tags = new Map<string, string>();
	for (const {tag} of findTags(`${stripHtmlTags(name)}\n${stripHtmlTags(note)}`)) {
		const lower = tag.toLowerCase();
		if (!tags.has(lower) && !lower.startsWith(TEMPLATE_TAG_PREFIX)) {
			tags.set(lower, tag);
		}
	}
	return tags;
}

/** Each tag's count keyed by its lowercase form: once per item, keeping its first-seen casing. */
type TagCounts = ReadonlyMap<string, TagCount>;

function addItem(counts: Map<string, TagCount>, row: TagRow): void {
	for (const [lower, tag] of itemTags(row)) {
		const entry = counts.get(lower);
		counts.set(lower, entry ? {tag: entry.tag, count: entry.count + 1} : {tag, count: 1});
	}
}

function countTags(rows: Iterable<TagRow>): TagCounts {
	const counts = new Map<string, TagCount>();
	for (const row of rows) {
		addItem(counts, row);
	}
	return counts;
}

/** `counts` with one item's `saved` text swapped for its `live` text. */
export function swapItemText(counts: TagCounts, saved: TagRow, live: TagRow): TagCounts {
	const swapped = new Map(counts);
	for (const lower of itemTags(saved).keys()) {
		const entry = swapped.get(lower);
		if (entry === undefined) {
			continue;
		}
		if (entry.count > 1) {
			swapped.set(lower, {tag: entry.tag, count: entry.count - 1});
		} else {
			swapped.delete(lower);
		}
	}
	addItem(swapped, live);
	return swapped;
}

const wholeTreeCounts = new WeakMap<Database, {token: string; counts: TagCounts}>();

/**
 * The whole live tree's tag counts, recounted only after a write. Autocomplete asks on every
 * keystroke, and a synchronous whole-tree recount each time queued the editor's saves behind it.
 */
export function wholeTreeTagCounts(database: Database): TagCounts {
	const token = changeToken(database);
	const cached = wholeTreeCounts.get(database);
	if (cached?.token === token) {
		return cached.counts;
	}
	const rows = database
		.select({name: nodeContent.name, note: nodeContent.note})
		.from(nodeContent)
		.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
		.all();
	const counts = countTags(rows);
	wholeTreeCounts.set(database, {token, counts});
	return counts;
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

export function rankTags(rows: Iterable<TagRow>, options: {prefix: string; limit: number}): TagCount[] {
	return rankCounts(countTags(rows), options);
}

export function rankCounts(counts: TagCounts, {prefix, limit}: {prefix: string; limit: number}): TagCount[] {
	const prefixLower = prefix.toLowerCase();
	return [...counts.values()]
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
