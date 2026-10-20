/**
 * Upstream's `AppTagIndex.autocomplete` over cached rows: count the tags in a
 * set of items, keep the ones matching a prefix, and rank them.
 */

import {stripHtmlTags} from "@workflowy/shared/html";
import {nodeContent} from "@workflowy/shared/db";
import {findTags} from "@workflowy/shared/tags";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {and, eq, inArray, sql} from "drizzle-orm";
import {changedContentIds, changesSince, latestSystemTime, readConsistently} from "./system-changes.js";
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

/** Above this many changed items, a patch would cost about as much as recounting the whole tree. */
const PATCH_LIMIT = 1000;

interface TagHolder {
	/** The item row's rowid: a recount reads rows in rowid order, so the lowest one's casing is first seen. */
	rowid: number;
	tag: string;
}

interface WholeTreeCounts {
	token: string;
	/** The newest system time counted, from which the next patch looks for changes. */
	latest: string;
	build: "full" | "patch";
	counts: TagCounts;
	/** Each counted item's tags (lowercase), so a patch can take them back out. Items without tags are left out. */
	tagsById: Map<string, string[]>;
	/** Each tag's items, keyed by lowercase tag then item id, to recompute its count and first-seen casing. */
	holders: Map<string, Map<string, TagHolder>>;
}

const wholeTreeCounts = new WeakMap<Database, WholeTreeCounts>();

/** Live items in rowid order, all of them or only `ids`. */
function liveTagRows(database: Database, ids?: Set<string>) {
	const live = eq(nodeContent.systemTo, FAR_FUTURE_DATE);
	const rowid = sql<number>`rowid`;
	return database
		.select({rowid, id: nodeContent.id, name: nodeContent.name, note: nodeContent.note})
		.from(nodeContent)
		.where(ids === undefined ? live : and(live, inArray(nodeContent.id, [...ids])))
		.orderBy(rowid)
		.all();
}

function holdTags(cache: WholeTreeCounts, row: TagRow & {id: string; rowid: number}): Set<string> {
	const tags = itemTags(row);
	if (tags.size > 0) {
		cache.tagsById.set(row.id, [...tags.keys()]);
	}
	for (const [lower, tag] of tags) {
		const holders = cache.holders.get(lower);
		if (holders) {
			holders.set(row.id, {rowid: row.rowid, tag});
		} else {
			cache.holders.set(lower, new Map([[row.id, {rowid: row.rowid, tag}]]));
		}
	}
	return new Set(tags.keys());
}

/** Set `lower`'s count and first-seen casing from its holders. */
function settleTag(cache: WholeTreeCounts, counts: Map<string, TagCount>, lower: string): void {
	const holders = cache.holders.get(lower);
	if (holders === undefined || holders.size === 0) {
		cache.holders.delete(lower);
		counts.delete(lower);
		return;
	}
	let first: TagHolder | undefined;
	for (const holder of holders.values()) {
		if (first === undefined || holder.rowid < first.rowid) {
			first = holder;
		}
	}
	counts.set(lower, {tag: first?.tag ?? lower, count: holders.size});
}

function recount(database: Database, token: string): WholeTreeCounts {
	return readConsistently(database, () => {
		const counts = new Map<string, TagCount>();
		const cache: WholeTreeCounts = {
			token,
			latest: latestSystemTime(database),
			build: "full",
			counts,
			tagsById: new Map(),
			holders: new Map(),
		};
		for (const row of liveTagRows(database)) {
			holdTags(cache, row);
		}
		for (const lower of cache.holders.keys()) {
			settleTag(cache, counts, lower);
		}
		return cache;
	});
}

/** Patch `cached` in place with the items that changed since it was counted, or null when too many did. */
function patchCounts(database: Database, cached: WholeTreeCounts, token: string): WholeTreeCounts | null {
	return readConsistently(database, () => {
		const latest = latestSystemTime(database);
		const changed = changedContentIds(database, changesSince(cached.latest), PATCH_LIMIT);
		if (changed === undefined) {
			return null;
		}
		const touched = new Set<string>();
		for (const id of changed) {
			for (const lower of cached.tagsById.get(id) ?? []) {
				cached.holders.get(lower)?.delete(id);
				touched.add(lower);
			}
			cached.tagsById.delete(id);
		}
		for (const row of changed.size > 0 ? liveTagRows(database, changed) : []) {
			for (const lower of holdTags(cached, row)) {
				touched.add(lower);
			}
		}
		const counts = new Map(cached.counts);
		for (const lower of touched) {
			settleTag(cached, counts, lower);
		}
		return {
			...cached,
			token,
			latest: latest > cached.latest ? latest : cached.latest,
			build: "patch",
			counts,
		};
	});
}

/**
 * The whole live tree's tag counts, patched with the items changed by each write. Autocomplete asks on every
 * keystroke, and a synchronous whole-tree recount each time queued the editor's saves behind it.
 */
export function wholeTreeTagCounts(database: Database): TagCounts {
	const token = changeToken(database);
	const cached = wholeTreeCounts.get(database);
	if (cached?.token === token) {
		return cached.counts;
	}
	const next = (cached === undefined ? null : patchCounts(database, cached, token)) ?? recount(database, token);
	wholeTreeCounts.set(database, next);
	return next.counts;
}

/** Whether the cached whole-tree counts were last recounted or patched, for tests. */
export function peekWholeTreeTagCountsBuild(database: Database): WholeTreeCounts["build"] | undefined {
	return wholeTreeCounts.get(database)?.build;
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
