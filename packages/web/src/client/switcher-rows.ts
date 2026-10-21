// Upstream's switcher row list: an empty filter lists the starred locations (`useMostRecentStarred`);
// a filter lists the starred entries that match it, then the server's results without their duplicates.

import {label} from "@workflowy/shared";
import {stripHtmlTags} from "@workflowy/shared/html";
import type {Star} from "@workflowy/shared";
import {matchSwitcherRow} from "@workflowy/shared/search";
import type {SwitcherAncestor, SwitcherResult} from "../server/switcher-search.js";

/** A starred location with its node's text; callers pass these in `mostRecent` order. */
export interface StarredEntry {
	star: Star;
	/** The node's raw name HTML ("" for Home). */
	name: string;
	note: string;
	completed: boolean;
	/** Root-first, without Home and without the node itself. */
	ancestors: SwitcherAncestor[];
}

/**
 * Each starred node id once, in first-seen order, without Home. A node can be starred both bare and with a query, and
 * `useQueries` warns about duplicate keys when the ancestor queries repeat one.
 */
export function starredNodeIds(stars: readonly Star[]): string[] {
	return [...new Set(stars.flatMap((star) => (star.nodeId === null ? [] : [star.nodeId])))];
}

/**
 * `idle` until the first request of this opening answers; `pending` once that request is slow enough to say so.
 * Later requests keep the previous results.
 */
export type SwitcherSearchStatus = "idle" | "pending" | "done" | "error";

export interface SwitcherServerResults {
	status: SwitcherSearchStatus;
	results: readonly SwitcherResult[];
}

export interface SwitcherRow extends SwitcherResult {
	/** The location key (a page's key is its node id), unique among the rows. */
	key: string;
	nodeId: string | null;
	/** Set for a starred search, which shows the magnifier. */
	query: string | null;
}

export interface SwitcherRows {
	rows: SwitcherRow[];
	/** Plain text shown after the list, or null for none. */
	emptyText: string | null;
	/** Show the spinner beside the indexing message. */
	indexing: boolean;
}

const STARRED_HINT = "Your starred pages will appear here.";
const NO_MATCHES = "No matches found. Try adjusting your search.";
const INDEXING = "Indexing your data! One sec …";
const SEARCH_UNAVAILABLE = "Search is unavailable right now.";

function starredRow(entry: StarredEntry, filter: string): SwitcherRow | null {
	const {star} = entry;
	const starLabel = label(star, () => entry.name);
	const match = matchSwitcherRow({name: entry.name, note: entry.note, starLabel}, filter);
	if (match === null) {
		return null;
	}
	const isSearch = star.query !== null && star.query !== "";
	const self = star.nodeId === null ? [] : [{id: star.nodeId, name: stripHtmlTags(entry.name)}];
	return {
		key: star.key,
		id: star.nodeId ?? "",
		nodeId: star.nodeId,
		query: isSearch ? star.query : null,
		labelHtml: isSearch || star.nodeId === null ? (match.searchHtml ?? starLabel) : match.labelHtml,
		completed: entry.completed,
		starred: true,
		// A starred search's crumbs end in the page it searches.
		ancestors: isSearch ? [...entry.ancestors, ...self] : entry.ancestors,
	};
}

function emptyState(filter: string, rows: readonly SwitcherRow[], status: SwitcherSearchStatus) {
	if (filter === "") {
		return {emptyText: rows.length === 0 ? STARRED_HINT : null, indexing: false};
	}
	if (status === "error") {
		return {emptyText: SEARCH_UNAVAILABLE, indexing: false};
	}
	if (status === "idle") {
		return {emptyText: null, indexing: false};
	}
	if (status === "pending") {
		return {emptyText: INDEXING, indexing: true};
	}
	return {emptyText: rows.length === 0 ? NO_MATCHES : null, indexing: false};
}

export function buildSwitcherRows(
	starred: readonly StarredEntry[],
	server: SwitcherServerResults,
	filter: string,
): SwitcherRows {
	const trimmed = filter.trim();
	const starredRows = starred.flatMap((entry) => starredRow(entry, trimmed) ?? []);
	const listed = new Set(starredRows.map((row) => row.key));
	const serverRows: SwitcherRow[] =
		trimmed === ""
			? []
			: server.results
					.filter((result) => !listed.has(result.id))
					.map((result) => ({...result, key: result.id, nodeId: result.id, query: null}));
	const rows = [...starredRows, ...serverRows];
	return {rows, ...emptyState(trimmed, rows, server.status)};
}
