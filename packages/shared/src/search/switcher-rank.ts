/** Upstream's jump-menu ranking (`wf-search-index.worker.js`): a static per-node score times a text factor. */

const DAY_SEC = 86_400;
const RECENCY_WINDOW_DAYS = 360;
const RECENCY_LO = 0.1;
const RECENCY_HI = 10;
const STARRED_FACTOR = 20;

export interface StaticScoreInput {
	depth: number;
	childCount: number;
	completed: boolean;
	/** Absolute epoch seconds of the last edit, or null when never modified. */
	lastModifiedSec: number | null;
	joinedSec: number;
	nowSec: number;
	layoutMode: string | null;
	starred: boolean;
	name: string;
	note: string;
}

/**
 * Upstream `_b`. Upstream stores `lm` relative to the join date, so the absolute
 * `lastModifiedSec` is shifted by `joinedSec` before comparing against the window.
 */
function recencyFactor(lastModifiedSec: number | null, joinedSec: number, nowSec: number): number {
	if (lastModifiedSec === null || lastModifiedSec === 0) {
		return RECENCY_LO;
	}
	const lm = lastModifiedSec - joinedSec;
	const age = Math.floor(nowSec - joinedSec);
	const windowStart = age - RECENCY_WINDOW_DAYS * DAY_SEC;
	if (lm < windowStart) {
		return RECENCY_LO;
	}
	const progress = (lm - windowStart) / ((age - windowStart) / 100);
	return RECENCY_LO + ((RECENCY_HI - RECENCY_LO) / 100) * progress;
}

/** Upstream `Ne`: a `#tag` or `@tag` doubles the score. */
function tagFactor(text: string): number {
	return /#[\d\w]+/u.test(text) || /@[\d\w]+/u.test(text) ? 2 : 1;
}

/** Upstream `De`: bold, underline or italic markup doubles the score. */
function markupFactor(text: string): number {
	return /<b>.*<\/b>/u.test(text) || /<u>.*<\/u>/u.test(text) || /<i>.*<\/i>/u.test(text) ? 2 : 1;
}

/** Product of upstream's ranking criteria plus the name and note tag/markup boosts. */
export function staticScore(input: StaticScoreInput): number {
	const depthFactor = 1 / (1 + input.depth / 10);
	const childFactor = input.childCount === 0 ? 0.1 : input.childCount > 5 ? 2 : 1;
	const completedFactor = input.completed ? 1 : 2;
	const recency = recencyFactor(input.lastModifiedSec, input.joinedSec, input.nowSec);
	const layoutFactor = input.layoutMode === "h1" || input.layoutMode === "h2" ? 2 : 1;
	const starredFactor = input.starred ? STARRED_FACTOR : 1;
	const nameFactor = tagFactor(input.name) * markupFactor(input.name);
	const noteFactor = tagFactor(input.note) * markupFactor(input.note);
	return (
		depthFactor * childFactor * completedFactor * recency * layoutFactor * starredFactor * nameFactor * noteFactor
	);
}

/** Upstream `y0`. */
function nameTextFactor(query: string, name: string): number {
	return name.length === 0 ? 0 : (query.length / name.length) * 10;
}

/** Upstream `Le`. */
function noteTextFactor(query: string, note: string): number {
	return note.length === 0 ? 0 : (query.length / note.length) * 0.1;
}

/**
 * Query-dependent factor: name hits weigh 100x note hits, and a hit in both multiplies the two.
 * Callers score Home as Infinity so it always ranks first.
 */
export function textFactor(query: string, name: string, note: string, nameHit: boolean, noteHit: boolean): number {
	if (nameHit && noteHit) {
		return nameTextFactor(query, name) * noteTextFactor(query, note);
	}
	if (nameHit) {
		return nameTextFactor(query, name);
	}
	return noteHit ? noteTextFactor(query, note) : 0;
}

export interface ResolveJoinedSecInput {
	/** The `/api/v1/account` answer, or null when the internal API is not configured (503). */
	account: {joinedAt: string} | null;
	earliestCreatedSec: number;
}

/** The account join date in epoch seconds, falling back to the earliest cached `created_at`. */
export function resolveJoinedSec({account, earliestCreatedSec}: ResolveJoinedSecInput): number {
	return account ? Math.floor(Date.parse(account.joinedAt) / 1000) : earliestCreatedSec;
}
