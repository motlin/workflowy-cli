import {getEndingTagText} from "@workflowy/shared/tags";

/**
 * Pure tag-autocomplete rules, mirroring upstream's tagging controller and `autocompleteTagText`.
 */

const SEGMENT = String.raw`[^(),.!?;:/[\]\s]`;

/** `[#@]` followed by `seg(:seg?)*`; the body may be empty so a bare `#` keeps the popup attached. */
const QUERY_PATTERN = new RegExp(String.raw`^[#@](?:${SEGMENT}+(?::${SEGMENT}*)*)?$`, "iu");

export interface AutocompleteResult {
	tag: string;
}

export interface AcceptedText {
	text: string;
	caret: number;
}

export function attach(textBeforeCaret: string): {start: number} | null {
	const ending = getEndingTagText(textBeforeCaret);
	return ending === undefined ? null : {start: textBeforeCaret.length - ending.length};
}

export function currentQuery(plain: string, start: number, caret: number): string | null {
	if (caret <= start) {
		return null;
	}
	const query = plain.slice(start, caret);
	return QUERY_PATTERN.test(query) ? query : null;
}

export function shouldShow(results: readonly AutocompleteResult[], query: string): boolean {
	if (results.length === 0) {
		return false;
	}
	return !(results.length === 1 && results[0]?.tag === query);
}

export function applyAccept(plain: string, start: number, caret: number, chosen: string): AcceptedText {
	let end = start;
	while (end < caret && plain[end]?.toLowerCase() === chosen[end - start]?.toLowerCase()) {
		end++;
	}
	const next = plain[end];
	const needsSpace = (next === undefined || !/\s/u.test(next)) && !chosen.endsWith(":");
	const inserted = needsSpace ? `${chosen} ` : chosen;
	return {text: plain.slice(0, start) + inserted + plain.slice(end), caret: start + inserted.length};
}
