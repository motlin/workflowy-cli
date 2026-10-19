import {stripHtmlTags} from "@workflowy/shared/html";
import {
	matchField,
	matchSwitcherRow,
	normalizeForSearch,
	splitIntoWords,
	staticScore,
	textFactor,
} from "@workflowy/shared/search";
import type {TreeSearchRow} from "./tree-search.js";

/** Upstream's index keys words by their first 16 characters. */
const INDEX_WORD_LENGTH = 16;
const DEFAULT_LIMIT = 20;

export interface SwitcherAncestor {
	id: string;
	name: string;
}

export interface SwitcherResult {
	id: string;
	labelHtml: string;
	completed: boolean;
	starred: boolean;
	/** Root-first, without Home; names are whole (the client slices them). */
	ancestors: SwitcherAncestor[];
}

export interface SwitcherResponse {
	results: SwitcherResult[];
	hasMore: boolean;
}

export interface RankSwitcherOptions {
	joinedSec: number;
	offset?: number;
	limit?: number;
}

function toSeconds(millis: number | null): number | null {
	return millis === null ? null : Math.floor(millis / 1000);
}

/**
 * Upstream's jump-menu search over the live tree: candidates hold the longest query word (first 16 chars)
 * somewhere in their name or note, `matchSwitcherRow` keeps word-start matches only, completed nodes and
 * nodes under a completed ancestor are dropped, and the rest sort by `staticScore x textFactor` descending.
 */
export function rankSwitcher(
	rows: readonly TreeSearchRow[],
	query: string,
	starredIds: readonly string[],
	nowSec: number,
	{joinedSec, offset = 0, limit = DEFAULT_LIMIT}: RankSwitcherOptions,
): SwitcherResponse {
	const words = splitIntoWords(query);
	if (words.length === 0) {
		return {results: [], hasMore: false};
	}
	const longest = words.toSorted((a, b) => b.length - a.length)[0]?.slice(0, INDEX_WORD_LENGTH) ?? "";
	const starred = new Set(starredIds);
	const byId = new Map(rows.map((row) => [row.id, row]));
	const childCount = new Map<string, number>();
	for (const row of rows) {
		if (row.parentId !== null) {
			childCount.set(row.parentId, (childCount.get(row.parentId) ?? 0) + 1);
		}
	}

	function ancestorsOf(row: TreeSearchRow): TreeSearchRow[] {
		const chain: TreeSearchRow[] = [];
		let parent = row.parentId === null ? undefined : byId.get(row.parentId);
		while (parent) {
			chain.unshift(parent);
			parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
		}
		return chain;
	}

	const scored: {score: number; result: SwitcherResult}[] = [];
	for (const row of rows) {
		const name = row.name ?? "";
		const note = row.note ?? "";
		const plainName = stripHtmlTags(name);
		const plainNote = stripHtmlTags(note);
		// Stands in for the SQL LIKE prefilter on the normalised plain text.
		if (!normalizeForSearch(plainName).includes(longest) && !normalizeForSearch(plainNote).includes(longest)) {
			continue;
		}
		const match = matchSwitcherRow({name, note, starLabel: null}, query);
		if (match === null || row.completedAt !== null) {
			continue;
		}
		const ancestors = ancestorsOf(row);
		if (ancestors.some((ancestor) => ancestor.completedAt !== null)) {
			continue;
		}
		const isStarred = starred.has(row.id);
		const nameHit = matchField([longest], plainName).score > 0;
		const noteHit = matchField([longest], plainNote).score > 0;
		const score =
			staticScore({
				depth: ancestors.length + 1,
				childCount: childCount.get(row.id) ?? 0,
				completed: false,
				lastModifiedSec: toSeconds(row.modifiedAt),
				joinedSec,
				nowSec,
				layoutMode: row.layoutMode,
				starred: isStarred,
				name,
				note,
			}) * textFactor(longest, plainName, plainNote, nameHit, noteHit);
		scored.push({
			score,
			result: {
				id: row.id,
				labelHtml: match.labelHtml,
				completed: false,
				starred: isStarred,
				ancestors: ancestors.map((ancestor) => ({id: ancestor.id, name: stripHtmlTags(ancestor.name ?? "")})),
			},
		});
	}
	scored.sort((a, b) => b.score - a.score);
	return {
		results: scored.slice(offset, offset + limit).map(({result}) => result),
		hasMore: scored.length > offset + limit,
	};
}
