/** Fold a string for search: strip diacritics (NFD + drop combining marks) and lowercase. */
export function normalizeForSearch(s: string): string {
	return s
		.normalize("NFD")
		.replaceAll(/\p{M}+/gu, "")
		.toLowerCase();
}

export interface NormalizedText {
	text: string;
	/** Original start offset for each normalized code unit. */
	starts: number[];
	/** Original end offset for each normalized code unit (extended over dropped combining marks). */
	ends: number[];
}

/** Normalize `s` while tracking how each normalized code unit maps back to the original string. */
export function normalizeWithOffsets(s: string): NormalizedText {
	let text = "";
	const starts: number[] = [];
	const ends: number[] = [];
	let offset = 0;
	for (const ch of s) {
		const folded = normalizeForSearch(ch);
		const end = offset + ch.length;
		if (folded.length === 0) {
			if (ends.length > 0) {
				ends[ends.length - 1] = end;
			}
		} else {
			for (let i = 0; i < folded.length; i++) {
				starts.push(offset);
				ends.push(end);
			}
			text += folded;
		}
		offset = end;
	}
	return {text, starts, ends};
}
