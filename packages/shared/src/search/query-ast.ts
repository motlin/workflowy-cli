import {stripHtmlTags} from "../html/strip-tags.js";
import {normalizeForSearch, normalizeWithOffsets} from "./normalize.js";

/** A node as seen by the upstream-style search matcher (port of WF.Search.parseQuery). */
export interface SearchItem {
	id: string;
	nameHtml: string;
	noteHtml: string;
	completedAt: number | null;
	createdAt: number | null;
	modifiedAt: number | null;
	layoutMode: string | null;
	childCount: number;
	isMirror: boolean;
	ancestorCompleted: boolean;
	ancestors?: SearchItem[];
}

export interface MatchResult {
	matches: boolean;
	nameMatches: boolean;
	noteMatches: boolean;
	metaMatches: boolean;
}

export type Range = [number, number];

export interface QueryNode {
	matches(item: SearchItem): MatchResult;
	/** Highlight ranges on plain text: merged, sorted, in original-string offsets. */
	ranges(text: string): Range[];
	revealsCompleted(): boolean;
	isEmpty(): boolean;
	/** Whether the item carries the kind of value this node tests; negation only matches when true. */
	hasSearchTypeValue(item: SearchItem): boolean;
	canMetaMatch(): boolean;
}

export interface ParseQueryOptions {
	now?: number;
	dateFormat?: string;
}

export interface OperatorContext {
	now: number;
	dateFormat: string;
	/** True when this token is the last one and the query has no trailing whitespace. */
	isLast: boolean;
}

/** A search operator (has:, is:, date:, ...). Registered in upstream insertion order by later tasks. */
export interface SearchOperator {
	name: string;
	/** Optionally claim a token longer than a whitespace-delimited word, starting at `start`. Returns its end offset. */
	parseToken?(query: string, start: number): number | null;
	/** Called with the lowercased token (without a leading "-"). */
	matchesToken(token: string): boolean;
	create(token: string, rawToken: string, context: OperatorContext): QueryNode;
}

export const SEARCH_OPERATORS: SearchOperator[] = [];

const NO_MATCH: MatchResult = {matches: false, nameMatches: false, noteMatches: false, metaMatches: false};

const QUOTE_PAIRS: ReadonlyMap<string, string> = new Map([
	['"', '"'],
	["«", "»"],
	["“", "”"],
	["❝", "❞"],
	["〝", "〞"],
]);

const CJK_ONLY = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;
const WORD_CHAR = /[\p{L}\p{Nd}]/u;

interface PreparedText {
	name: string;
	note: string;
}

const preparedCache = new WeakMap<SearchItem, PreparedText>();

function prepare(item: SearchItem): PreparedText {
	let prepared = preparedCache.get(item);
	if (!prepared) {
		prepared = {
			name: normalizeForSearch(stripHtmlTags(item.nameHtml)),
			note: normalizeForSearch(stripHtmlTags(item.noteHtml)),
		};
		preparedCache.set(item, prepared);
	}
	return prepared;
}

function escapeRegExp(s: string): string {
	return s.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function mergeRanges(ranges: Range[]): Range[] {
	const sorted = ranges.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
	const merged: Range[] = [];
	for (const [start, end] of sorted) {
		const last = merged.at(-1);
		if (last && start <= last[1]) {
			last[1] = Math.max(last[1], end);
		} else {
			merged.push([start, end]);
		}
	}
	return merged;
}

/** Matches text against a regexp with the match itself in capture group 2 (group 1 is the leading boundary). */
abstract class TextNode implements QueryNode {
	protected abstract readonly regexp: RegExp;

	matches(item: SearchItem): MatchResult {
		const {name, note} = prepare(item);
		const nameMatches = this.test(name);
		const noteMatches = this.test(note);
		return {matches: nameMatches || noteMatches, nameMatches, noteMatches, metaMatches: false};
	}

	ranges(text: string): Range[] {
		const normalized = normalizeWithOffsets(text);
		const result: Range[] = [];
		for (const match of normalized.text.matchAll(this.regexp)) {
			const start = match.index + (match[1]?.length ?? 0);
			const end = start + (match[2]?.length ?? 0);
			const originalStart = normalized.starts[start];
			const originalEnd = normalized.ends[end - 1];
			if (originalStart !== undefined && originalEnd !== undefined) {
				result.push([originalStart, originalEnd]);
			}
		}
		return mergeRanges(result);
	}

	revealsCompleted(): boolean {
		return false;
	}

	isEmpty(): boolean {
		return false;
	}

	hasSearchTypeValue(): boolean {
		return true;
	}

	canMetaMatch(): boolean {
		return false;
	}

	private test(text: string): boolean {
		this.regexp.lastIndex = 0;
		return this.regexp.test(text);
	}
}

/** A word: must start at a word boundary, and end at one unless it is a prefix (the last token). */
class TermNode extends TextNode {
	protected readonly regexp: RegExp;

	constructor(term: string, prefix: boolean) {
		super();
		const leading = WORD_CHAR.test(term.at(0) ?? "") ? String.raw`(^|[^\p{L}\p{Nd}])` : "()";
		const trailing = !prefix && WORD_CHAR.test(term.at(-1) ?? "") ? String.raw`(?=$|[^\p{L}\p{Nd}])` : "";
		this.regexp = new RegExp(`${leading}(${escapeRegExp(term)})${trailing}`, "gu");
	}
}

/** A literal substring with no word boundaries (quoted phrases, CJK-only terms). */
class SubstringNode extends TextNode {
	protected readonly regexp: RegExp;

	constructor(text: string) {
		super();
		this.regexp = new RegExp(`()(${escapeRegExp(text)})`, "gu");
	}
}

class NotNode implements QueryNode {
	constructor(private readonly child: QueryNode) {}

	matches(item: SearchItem): MatchResult {
		const matches = !this.child.matches(item).matches && this.child.hasSearchTypeValue(item);
		return {matches, nameMatches: false, noteMatches: false, metaMatches: matches && this.child.canMetaMatch()};
	}

	ranges(): Range[] {
		return [];
	}

	revealsCompleted(): boolean {
		return false;
	}

	isEmpty(): boolean {
		return this.child.isEmpty();
	}

	hasSearchTypeValue(): boolean {
		return true;
	}

	canMetaMatch(): boolean {
		return this.child.canMetaMatch();
	}
}

abstract class CompositeNode implements QueryNode {
	constructor(protected readonly children: QueryNode[]) {}

	abstract matches(item: SearchItem): MatchResult;

	ranges(text: string): Range[] {
		return mergeRanges(this.children.flatMap((child) => child.ranges(text)));
	}

	revealsCompleted(): boolean {
		return this.children.some((child) => child.revealsCompleted());
	}

	isEmpty(): boolean {
		return this.children.every((child) => child.isEmpty());
	}

	hasSearchTypeValue(item: SearchItem): boolean {
		return this.children.every((child) => child.hasSearchTypeValue(item));
	}

	canMetaMatch(): boolean {
		return this.children.some((child) => child.canMetaMatch());
	}
}

function orFlags(results: MatchResult[], matches: boolean): MatchResult {
	return {
		matches,
		nameMatches: results.some((r) => r.nameMatches),
		noteMatches: results.some((r) => r.noteMatches),
		metaMatches: results.some((r) => r.metaMatches),
	};
}

class AndNode extends CompositeNode {
	matches(item: SearchItem): MatchResult {
		const results: MatchResult[] = [];
		for (const child of this.children) {
			const result = child.matches(item);
			if (!result.matches) {
				return NO_MATCH;
			}
			results.push(result);
		}
		return orFlags(results, true);
	}
}

class OrNode extends CompositeNode {
	matches(item: SearchItem): MatchResult {
		const results = this.children.map((child) => child.matches(item));
		return orFlags(
			results,
			results.some((r) => r.matches),
		);
	}
}

interface Token {
	/** Token text without the leading "-". */
	text: string;
	negated: boolean;
	/** Inner text of a terminated quoted phrase, else null. */
	phrase: string | null;
}

function isWhitespace(ch: string | undefined): boolean {
	return ch !== undefined && /\s/u.test(ch);
}

function wordEnd(query: string, start: number): number {
	let end = start;
	while (end < query.length && !isWhitespace(query[end])) {
		end++;
	}
	return end;
}

function tokenize(query: string): Token[] {
	const tokens: Token[] = [];
	let pos = 0;
	while (pos < query.length) {
		if (isWhitespace(query[pos])) {
			pos++;
			continue;
		}
		const negated = query[pos] === "-";
		const start = negated ? pos + 1 : pos;
		let end: number | null = null;
		let phrase: string | null = null;
		for (const operator of SEARCH_OPERATORS) {
			end = operator.parseToken?.(query, start) ?? null;
			if (end !== null) {
				break;
			}
		}
		const closer = QUOTE_PAIRS.get(query[start] ?? "");
		if (end === null && closer !== undefined) {
			const close = query.indexOf(closer, start + 1);
			if (close !== -1) {
				end = close + 1;
				phrase = query.slice(start + 1, close);
			}
		}
		end ??= wordEnd(query, start);
		tokens.push({text: query.slice(start, end), negated, phrase});
		pos = end;
	}
	return tokens;
}

function buildToken(token: Token, context: OperatorContext): QueryNode | null {
	if (token.phrase !== null) {
		const phrase = normalizeForSearch(token.phrase);
		return phrase.length === 0 ? null : new SubstringNode(phrase);
	}
	if (token.text.length === 0) {
		return null;
	}
	const lowered = token.text.toLowerCase();
	const operator = SEARCH_OPERATORS.find((op) => op.matchesToken(lowered));
	if (operator) {
		return operator.create(lowered, token.text, context);
	}
	const term = normalizeForSearch(token.text);
	if (term.length === 0) {
		return null;
	}
	return CJK_ONLY.test(term) ? new SubstringNode(term) : new TermNode(term, context.isLast);
}

/** Parse a search query into an AST that matches SearchItems the way upstream Workflowy does. */
export function parseQuery(q: string, opts: ParseQueryOptions = {}): QueryNode {
	const tokens = tokenize(q);
	const prefixLast = !isWhitespace(q.at(-1));
	let current: QueryNode[] = [];
	const groups: QueryNode[][] = [current];
	tokens.forEach((token, index) => {
		if (!token.negated && token.phrase === null && token.text === "OR") {
			current = [];
			groups.push(current);
			return;
		}
		const node = buildToken(token, {
			now: opts.now ?? Date.now(),
			dateFormat: opts.dateFormat ?? "YYYY-MM-DD",
			isLast: prefixLast && index === tokens.length - 1,
		});
		if (node) {
			current.push(token.negated ? new NotNode(node) : node);
		}
	});
	const ands = groups.filter((group) => group.length > 0).map((group) => new AndNode(group));
	const [only, ...rest] = ands;
	return only && rest.length === 0 ? only : new OrNode(ands);
}
