import {stripHtmlTags} from "@workflowy/shared/html";
import {findTags} from "@workflowy/shared/tags";

export interface HelperTags {
	hashTags: string[];
	atTags: string[];
}

const HELPER_TAG_LIMIT = 1000;

interface TagTally {
	/** Casing of the first occurrence. */
	display: string;
	count: number;
}

function rank(tallies: Iterable<TagTally>): string[] {
	return [...tallies]
		.toSorted((a, b) => b.count - a.count || a.display.toLowerCase().localeCompare(b.display.toLowerCase()))
		.slice(0, HELPER_TAG_LIMIT)
		.map((tally) => tally.display);
}

/**
 * Upstream's search helper sections: the `#tag` and `@tag` tokens in the plain-text name and note of every row,
 * counted case-insensitively and ranked by count descending, then case-insensitive alphabetical, keeping the
 * casing of each tag's first occurrence; at most 1000 per list.
 */
export function collectHelperTags(rows: Iterable<{name: string | null; note: string | null}>): HelperTags {
	const hash = new Map<string, TagTally>();
	const at = new Map<string, TagTally>();
	for (const {name, note} of rows) {
		for (const html of [name, note]) {
			for (const {tag} of findTags(stripHtmlTags(html))) {
				const tallies = tag.startsWith("#") ? hash : at;
				const key = tag.toLowerCase();
				const tally = tallies.get(key);
				if (tally === undefined) {
					tallies.set(key, {display: tag, count: 1});
				} else {
					tally.count += 1;
				}
			}
		}
	}
	return {hashTags: rank(hash.values()), atTags: rank(at.values())};
}
