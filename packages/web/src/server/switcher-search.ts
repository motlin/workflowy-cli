import {stripHtmlTags} from "@workflowy/shared/html";
import {
	matchField,
	normalizeForSearch,
	normalizeWithOffsets,
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
	/** A node to leave out of the results (the location picker's own item). */
	excludeId?: string;
}

/** Upstream's switcher word-start boundary, as in matchField. */
const START_OF_WORD_CHUNK = String.raw`([^\p{L}\p{N}#@]|^)`;

/** matchField's word-start test for one word (words hold only letters, digits, # and @, so need no escaping). */
function wordStart(word: string): RegExp {
	return new RegExp(`${START_OF_WORD_CHUNK}(${word})`, "iu");
}

interface RowText {
	plainName: string;
	plainNote: string;
	foldedName: string;
	foldedNote: string;
	/** matchField's per-character folding of the plain name, raw name and plain note, filled on first use. */
	fields?: [plainName: string, rawName: string, plainNote: string];
}

interface Placement {
	depth: number;
	underCompleted: boolean;
}

interface RowIndex {
	byId: Map<string, TreeSearchRow>;
	childCount: Map<string, number>;
	placements: Map<string, Placement>;
}

// Snapshot rows are shared across keystrokes, so their stripped and folded text and the tree index are reused.
const textCache = new WeakMap<TreeSearchRow, RowText>();
const indexCache = new WeakMap<readonly TreeSearchRow[], RowIndex>();

function rowText(row: TreeSearchRow): RowText {
	let text = textCache.get(row);
	if (text === undefined) {
		const plainName = stripHtmlTags(row.name ?? "");
		const plainNote = stripHtmlTags(row.note ?? "");
		text = {
			plainName,
			plainNote,
			foldedName: normalizeForSearch(plainName),
			foldedNote: normalizeForSearch(plainNote),
		};
		textCache.set(row, text);
	}
	return text;
}

function rowIndex(rows: readonly TreeSearchRow[]): RowIndex {
	let index = indexCache.get(rows);
	if (index === undefined) {
		const childCount = new Map<string, number>();
		for (const row of rows) {
			if (row.parentId !== null) {
				childCount.set(row.parentId, (childCount.get(row.parentId) ?? 0) + 1);
			}
		}
		index = {byId: new Map(rows.map((row) => [row.id, row])), childCount, placements: new Map()};
		indexCache.set(rows, index);
	}
	return index;
}

function matchFields(row: TreeSearchRow, text: RowText): [string, string, string] {
	text.fields ??= [
		normalizeWithOffsets(text.plainName).text,
		normalizeWithOffsets(row.name ?? "").text,
		normalizeWithOffsets(text.plainNote).text,
	];
	return text.fields;
}

/**
 * Fill every row's text caches, the tree index and each row's placement ahead of the first jump-menu keystroke. Run off the request path
 * after each snapshot refresh: cold, these cost about a second on a large tree, which the first query would pay.
 */
export function warmSwitcher(rows: readonly TreeSearchRow[]): void {
	const index = rowIndex(rows);
	for (const row of rows) {
		matchFields(row, rowText(row));
		placement(row, index);
	}
}

/** A row's cached jump-menu text, or undefined before it is computed, for tests. */
export function peekSwitcherText(row: TreeSearchRow): RowText | undefined {
	return textCache.get(row);
}

/** Depth below Home and whether any ancestor is completed, memoised per tree. */
function placement(row: TreeSearchRow, index: RowIndex): Placement {
	const cached = index.placements.get(row.id);
	if (cached) {
		return cached;
	}
	const parent = row.parentId === null ? undefined : index.byId.get(row.parentId);
	let result: Placement = {depth: 1, underCompleted: false};
	if (parent) {
		const above = placement(parent, index);
		result = {depth: above.depth + 1, underCompleted: above.underCompleted || parent.completedAt !== null};
	}
	index.placements.set(row.id, result);
	return result;
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
	{joinedSec, offset = 0, limit = DEFAULT_LIMIT, excludeId}: RankSwitcherOptions,
): SwitcherResponse {
	const words = splitIntoWords(query);
	if (words.length === 0) {
		return {results: [], hasMore: false};
	}
	const longest = words.toSorted((a, b) => b.length - a.length)[0]?.slice(0, INDEX_WORD_LENGTH) ?? "";
	const starred = new Set(starredIds);
	const index = rowIndex(rows);
	const {byId, childCount} = index;
	// matchField's word-start tests, run on its own folding: a field hits when it holds every word.
	const longestAtWordStart = wordStart(longest);
	const wordRegExps = words.map(wordStart);
	const hitsEvery = (field: string): boolean => wordRegExps.every((regexp) => regexp.test(field));

	function ancestorsOf(row: TreeSearchRow): TreeSearchRow[] {
		const chain: TreeSearchRow[] = [];
		let parent = row.parentId === null ? undefined : byId.get(row.parentId);
		while (parent) {
			chain.push(parent);
			parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
		}
		return chain.toReversed();
	}

	// Scoring needs only depth, completion and hits, so ancestor chains and highlighting run for the page alone.
	const scored: {score: number; row: TreeSearchRow}[] = [];
	for (const row of rows) {
		// Stands in for the SQL LIKE prefilter on the normalised plain text.
		if (row.id === excludeId) {
			continue;
		}
		const text = rowText(row);
		if ((!text.foldedName.includes(longest) && !text.foldedNote.includes(longest)) || row.completedAt !== null) {
			continue;
		}
		const {depth, underCompleted} = placement(row, index);
		if (underCompleted) {
			continue;
		}
		const [plainNameField, rawNameField, noteField] = matchFields(row, text);
		// matchSwitcherRow answers null exactly when no field holds every word.
		if (!hitsEvery(plainNameField) && !hitsEvery(rawNameField) && !hitsEvery(noteField)) {
			continue;
		}
		const nameHit = longestAtWordStart.test(plainNameField);
		const noteHit = longestAtWordStart.test(noteField);
		const score =
			staticScore({
				depth,
				childCount: childCount.get(row.id) ?? 0,
				completed: false,
				lastModifiedSec: toSeconds(row.modifiedAt),
				joinedSec,
				nowSec,
				layoutMode: row.layoutMode,
				starred: starred.has(row.id),
				name: row.name ?? "",
				note: row.note ?? "",
			}) * textFactor(longest, text.plainName, text.plainNote, nameHit, noteHit);
		scored.push({score, row});
	}
	scored.sort((a, b) => b.score - a.score);
	return {
		results: scored.slice(offset, offset + limit).map(({row}) => ({
			id: row.id,
			// matchSwitcherRow's label: the plain name highlighted (the row is known to match).
			labelHtml: matchField(words, rowText(row).plainName).html,
			completed: false,
			starred: starred.has(row.id),
			ancestors: ancestorsOf(row).map((ancestor) => ({
				id: ancestor.id,
				name: stripHtmlTags(ancestor.name ?? ""),
			})),
		})),
		hasMore: scored.length > offset + limit,
	};
}
