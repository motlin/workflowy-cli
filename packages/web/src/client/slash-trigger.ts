/**
 * Pure planners for the slash menu trigger, ported from upstream's `qU4` slash input hook and
 * the `/` symbol predicates (`first`, `standalone`, `propping`).
 */

export const SLASH_CHIP_CLASS = "slash-input bg-tertiary py-2xs pr-xs pl-xs rounded-s leading-none";

export interface SlashRange {
	readonly start: number;
	readonly end: number;
}

const REARM_SCAN_LENGTH = 10;

/** Upstream `propping`: any character other than space, `\n`, `\r` or `\t`; a missing neighbor is not propping. */
function isPropping(ch: string | undefined): boolean {
	return ch !== undefined && !/[ \n\r\t]/u.test(ch);
}

/**
 * Chip range for a `/` just typed at `slashIndex` of `text`, or null when it does not trigger.
 * Triggers when the slash is `first` (offset 0) or `standalone`; a trailing slash after other text
 * also wraps the preceding character (the space).
 */
export function planSlashOpen(text: string, slashIndex: number): SlashRange | null {
	const first = slashIndex === 0;
	const standalone = !isPropping(text[slashIndex - 1]) && !isPropping(text[slashIndex + 1]);
	if (!first && !standalone) {
		return null;
	}
	const last = slashIndex === text.length - 1;
	const start = last && !first ? slashIndex - 1 : slashIndex;
	return {start, end: slashIndex + 1};
}

/**
 * Range to re-wrap as a chip after a deleting input, scanning back up to 10 characters from the caret
 * for a `/`. The caller must still require a non-empty `resolveSlash` for the text after the slash.
 */
export function planSlashRearm(text: string, caret: number): SlashRange | null {
	const before = text.slice(0, caret);
	for (let o = caret; o > caret - REARM_SCAN_LENGTH && o >= 0; o--) {
		if (before[o] !== "/") {
			continue;
		}
		if ((before[o - 1] !== " " && o !== 0) || before[o + 1] === " ") {
			return null;
		}
		return {start: before[o - 1] === " " ? o - 1 : o, end: caret};
	}
	return null;
}

const SLASH_CHIP_PATTERN = new RegExp(`<span class="${SLASH_CHIP_CLASS}">([^<]*)</span>`, "gu");

/** Unwraps any slash chip span to its plain text so a live chip is never persisted. */
export function stripSlashChip(html: string): string {
	return html.replace(SLASH_CHIP_PATTERN, "$1");
}
