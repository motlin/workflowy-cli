#!/usr/bin/env node
// Compute the overdue recurring-review items from a fetched review tree.
//
// This is the deterministic half of the daily review's Recurring Review.
// It parses each recurring leaf item's <time> element, finds the ones due on or
// before today, and stages the exact update that advances each item from its section's
// interval. The Phase 0 planner imports the shared date helpers from this module.
//
// Usage:
//   node compute-overdue.mjs [tree.json] [--today YYYY-MM-DD] [--print] [--skip-log path]
//   node compute-overdue.mjs --record <itemId> --outcome <skip|done|lengthen|retire|...>
//
// Default tree path: .llm/gtd/review/tree.json. Default today: the local date.
// Without --print, emits the overdue rows as JSON to stdout.
//
// --record appends one outcome to the skip log so the next run knows how many times in a row an
// item was skipped. Each row then carries `skipStreak` plus a staged `lengthen` op that moves the
// item to the next longer cadence -- repeated skipping usually means the cadence is wrong.
//
// The section -> interval table mirrors plugins/gtd/skills/review-date-updates.md;
// this script is the executable source of truth for it.

import {appendFileSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname} from 'node:path';

const SECTION_INTERVALS = [
	['Daily Review', {amount: 1, unit: 'd'}],
	['Frequently Important', {amount: 1, unit: 'd'}],
	['Low priority daily', {amount: 1, unit: 'd'}],
	['Do goals for today', {amount: 1, unit: 'd'}],
	['Weekly Review', {amount: 7, unit: 'd'}],
	['Monthly Review', {amount: 1, unit: 'm'}],
	['Every 2 months', {amount: 2, unit: 'm'}],
	['Every 6 months', {amount: 6, unit: 'm'}],
	['Annual Review', {amount: 1, unit: 'y'}],
];

const TIME_RE = /<time[^>]*startYear="(\d+)"[^>]*startMonth="(\d+)"[^>]*startDay="(\d+)"[^>]*>.*?<\/time>/;

const pad = (n) => String(n).padStart(2, '0');

export function parseTimeISO(name) {
	const m = String(name).match(TIME_RE);
	return m ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : null;
}

/** Node text as a human reads it: no <time> element, no tags, no other HTML. */
export function stripMarkup(name) {
	return String(name)
		.replace(/<time[^>]*>.*?<\/time>/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function workflowyUrl(shortId) {
	return shortId ? `https://workflowy.com/#/${shortId}` : null;
}

const HREF_RE = /href="([^"]+)"/g;
const BARE_URL_RE = /https?:\/\/[^\s"'<>)]+/g;

/** Every http(s) URL reachable from a node's own text, in the order a reader meets them. */
export function extractLinks(...texts) {
	const urls = [];
	for (const text of texts) {
		if (!text) continue;
		const str = String(text);
		for (const m of str.matchAll(HREF_RE)) urls.push(m[1]);
		for (const m of str.matchAll(BARE_URL_RE)) urls.push(m[0].replace(/[.,;:]+$/, ''));
	}
	return [...new Set(urls.filter((u) => /^https?:\/\//.test(u)))];
}

/**
 * Everything the walk shows the user *before* asking what to do with an item: the note, when it
 * last moved, and the child titles. An item is unanswerable without its subtree -- "Inventory the
 * drives" with 71 children is a different question from the same title with none -- so the working
 * set carries the context rather than making the walk fetch it one item at a time.
 */
export function nodeContext(node) {
	// A recurring item that mirrors a bucket accumulates finished children. Reading those
	// aloud as live candidates is how the walk asks about work that is already done, so
	// completed children are dropped here and childCount reports the open count only.
	const kids = (node.children ?? []).filter((kid) => kid.completedAt == null);
	return {
		note: node.note ?? null,
		modifiedAt: node.modifiedAt ?? null,
		childCount: kids.length,
		children: kids.map((kid) => ({
			title: stripMarkup(kid.name),
			note: kid.note ?? null,
			childCount: (kid.children ?? []).length,
			url: workflowyUrl(kid.shortId),
		})),
		links: extractLinks(node.name, node.note),
	};
}

export function intervalForSection(sectionName) {
	const name = String(sectionName);
	for (const [pattern, interval] of SECTION_INTERVALS) {
		if (name.includes(pattern)) return interval;
	}
	return null; // "Every few years" / unrecognized -> ask the user for the interval
}

function lastDayOfMonth(year, month1) {
	// month1 is 1-based; day 0 of the next month is the last day of this one.
	return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function addInterval(iso, {amount, unit}) {
	const [y, m, d] = iso.split('-').map(Number);
	if (unit === 'd') {
		const dt = new Date(Date.UTC(y, m - 1, d + amount));
		return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
	}
	if (unit === 'm' || unit === 'y') {
		const totalMonths = (unit === 'y' ? amount * 12 : amount) + (m - 1);
		const year = y + Math.floor(totalMonths / 12);
		const month1 = (totalMonths % 12) + 1;
		// Clamp the day so e.g. Jan 31 + 1 month -> Feb 28, never rolling into March.
		const day = Math.min(d, lastDayOfMonth(year, month1));
		return `${year}-${pad(month1)}-${pad(day)}`;
	}
	throw new Error(`bad interval unit: ${unit}`);
}

export function buildTimeElement(iso) {
	const [y, m, d] = iso.split('-').map(Number);
	const label = new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	}).format(new Date(Date.UTC(y, m - 1, d)));
	// Trailing space is required so Workflowy renders the element (see review-date-updates.md).
	return `<time startYear="${y}" startMonth="${m}" startDay="${d}">${label}</time> `;
}

export function swapTimeElement(name, newTimeElement) {
	// Replace the existing element and collapse any duplicated trailing space.
	return String(name).replace(TIME_RE, newTimeElement.trimEnd()).replace(/\s+$/, '') + ' ';
}

// The skip log is an append-only JSONL record of what happened to each item on each run. It is
// append-only on purpose: the walk dispatches its writes as concurrent background jobs, and a
// read-modify-write of a single JSON blob would silently lose outcomes when two land at once.
export const DEFAULT_SKIP_LOG_PATH = '.llm/gtd/review/skip-log.jsonl';

function parseSkipLog(text) {
	const entries = [];
	for (const line of String(text).split('\n')) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line);
			if (entry?.key && entry?.outcome && entry?.date) entries.push(entry);
		} catch {
			// A truncated line from an interrupted run costs one item's history, never the whole log.
		}
	}
	return entries;
}

/**
 * Fold the log into a per-item streak of consecutive runs that ended in `skip`.
 *
 * Outcomes collapse per day so re-running the review cannot inflate a streak, and the last
 * outcome recorded for a day wins so a correction overrides the entry it replaces.
 */
export function foldSkipLog(entries) {
	const byKey = new Map();
	for (const {key, outcome, date} of entries ?? []) {
		if (!byKey.has(key)) byKey.set(key, new Map());
		byKey.get(key).set(date, outcome);
	}

	const streaks = new Map();
	for (const [key, byDate] of byKey) {
		// ISO YYYY-MM-DD keys sort chronologically.
		const dates = [...byDate.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
		let skipStreak = 0;
		let skippedSince = null;
		for (let i = dates.length - 1; i >= 0; i--) {
			if (byDate.get(dates[i]) !== 'skip') break;
			skipStreak++;
			skippedSince = dates[i];
		}
		streaks.set(key, {skipStreak, skippedSince});
	}
	return streaks;
}

export function loadSkipStreaks(path = DEFAULT_SKIP_LOG_PATH) {
	try {
		return foldSkipLog(parseSkipLog(readFileSync(path, 'utf8')));
	} catch {
		return new Map(); // No log yet means no history, which is not an error.
	}
}

export function recordOutcome(key, outcome, {date = localTodayISO(), path = DEFAULT_SKIP_LOG_PATH} = {}) {
	const entry = {key, outcome, date};
	mkdirSync(dirname(path), {recursive: true});
	appendFileSync(path, JSON.stringify(entry) + '\n');
	return entry;
}

const UNIT_DAYS = {d: 1, m: 30, y: 365};

// Only for ordering the cadence ladder -- month and year lengths are approximations, and the real
// date math stays in addInterval.
export function intervalDays(interval) {
	return interval === null ? Infinity : UNIT_DAYS[interval.unit] * interval.amount;
}

/**
 * The next rung up the cadence ladder: the section in this tree whose interval is the shortest one
 * still longer than `interval`. A recurring item's cadence IS its section, so lengthening the
 * cadence means moving the node, not editing a field.
 */
export function nextLongerSection(sections, interval) {
	if (interval === null) return null; // Unknown cadence -- ask the user rather than guessing a rung.
	const current = intervalDays(interval);
	const candidates = (sections ?? [])
		.filter((section) => !String(section.name).includes('🗃️ Routine Archive'))
		.map((section) => ({name: section.name, id: section.id, interval: intervalForSection(section.name)}))
		// A section with no known interval cannot stage a date, so it is not a move target.
		.filter((section) => section.interval !== null && intervalDays(section.interval) > current)
		.sort((a, b) => intervalDays(a.interval) - intervalDays(b.interval));
	return candidates[0] ?? null;
}

function shellSingleQuote(s) {
	return `'${String(s).replaceAll("'", `'"'"'`)}'`;
}

function daysBetween(fromISO, toISO) {
	const a = new Date(fromISO + 'T00:00:00Z');
	const b = new Date(toISO + 'T00:00:00Z');
	return Math.round((b - a) / 86_400_000);
}

/**
 * Stage the "this comes back too often" outcome: advance the date by the NEXT LONGER cadence and
 * move the item into that section. Repeated skipping usually means the cadence is wrong rather
 * than that the item is dead, so this is the alternative to deleting it.
 */
function buildLengthen(target, child, todayISO) {
	if (!target?.id) return null; // Top of the ladder, or a section we cannot address by id.
	const nextDate = addInterval(todayISO, target.interval);
	const newName = swapTimeElement(child.name, buildTimeElement(nextDate));
	return {
		section: target.name,
		sectionId: target.id,
		interval: target.interval,
		nextDate,
		newName,
		applyOp: `./bin/run.js node update --id ${child.id} --name ${shellSingleQuote(newName)} && ./bin/run.js node move --node-id ${child.id} --parent-id ${target.id} -p bottom`,
	};
}

export function computeOverdue(tree, todayISO, {skipStreaks = new Map()} = {}) {
	const sections = tree.children ?? [];
	const rows = [];

	sections.forEach((section, sectionIndex) => {
		if (String(section.name).includes('🗃️ Routine Archive')) return;
		const interval = intervalForSection(section.name);
		// Every item in a section shares its cadence, so the rung above it is resolved once here.
		const lengthenTarget = nextLongerSection(sections, interval);

		const walk = (node) => {
			for (const child of node.children ?? []) {
				// The keyed DAG owns the entire LLM Tasks subtree, so recurring review must not surface it.
				if (String(child.name).includes('LLM Tasks:')) continue;
				// A mirror reflects a node that lives elsewhere -- typically the ⏰/📌 task buckets
				// mirrored under "Set goals for today". Those reflections are one-shot Next Actions,
				// not recurring items, so neither the mirror nor anything beneath it is a row here.
				if (child.mirror?.isMirror) continue;
				// A finished item keeps its old <time>. Asking about it is asking about work
				// that is already done, so completion wins over the date.
				const isCompleted = child.completedAt != null;
				const due = parseTimeISO(child.name);
				if (due && due <= todayISO && !isCompleted) {
					const needsInterval = interval === null;
					const nextDate = needsInterval ? null : addInterval(todayISO, interval);
					let newName = null;
					let applyOp = null;
					if (nextDate) {
						newName = swapTimeElement(child.name, buildTimeElement(nextDate));
						applyOp = `./bin/run.js node update --id ${child.id} --name ${shellSingleQuote(newName)}`;
					}
					const streak = skipStreaks.get(child.id) ?? null;
					rows.push({
						section: section.name,
						sectionIndex,
						priority: section.priority ?? null,
						id: child.id,
						shortId: child.shortId,
						name: child.name,
						due,
						overdueByDays: daysBetween(due, todayISO),
						isLlmTask: /#llm-task/.test(child.name),
						url: workflowyUrl(child.shortId),
						...nodeContext(child),
						interval,
						needsInterval,
						nextDate,
						nextTimeElement: nextDate ? buildTimeElement(nextDate) : null,
						newName,
						applyOp,
						skipStreak: streak?.skipStreak ?? 0,
						skippedSince: streak?.skippedSince ?? null,
						lengthen: buildLengthen(lengthenTarget, child, todayISO),
					});
				}
				if (child.children?.length) walk(child);
			}
		};
		walk(section);
	});

	rows.sort((a, b) => a.sectionIndex - b.sectionIndex || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
	return rows;
}

function localTodayISO() {
	const now = new Date();
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function main(argv) {
	const args = argv.slice(2);
	let treePath = '.llm/gtd/review/tree.json';
	let today = localTodayISO();
	let print = false;
	let skipLogPath = DEFAULT_SKIP_LOG_PATH;
	let recordKey = null;
	let outcome = null;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--today') today = args[++i];
		else if (args[i] === '--print') print = true;
		else if (args[i] === '--skip-log') skipLogPath = args[++i];
		else if (args[i] === '--record') recordKey = args[++i];
		else if (args[i] === '--outcome') outcome = args[++i];
		else if (!args[i].startsWith('--')) treePath = args[i];
	}

	if (recordKey) {
		if (!outcome) throw new Error('--record requires --outcome');
		const entry = recordOutcome(recordKey, outcome, {date: today, path: skipLogPath});
		process.stdout.write(JSON.stringify(entry) + '\n');
		return;
	}

	const tree = JSON.parse(readFileSync(treePath, 'utf8'));
	const rows = computeOverdue(tree, today, {skipStreaks: loadSkipStreaks(skipLogPath)});

	if (!print) {
		process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
		return;
	}

	const bySection = new Map();
	for (const r of rows) {
		if (!bySection.has(r.section)) bySection.set(r.section, []);
		bySection.get(r.section).push(r);
	}
	for (const [section, items] of bySection) {
		process.stdout.write(`\n=== ${section} — ${items.length} overdue ===\n`);
		for (const it of items) {
			const tags = [
				it.isLlmTask ? '[#llm-task]' : '',
				it.childCount ? `(${it.childCount} children)` : '',
				it.skipStreak >= 2
					? `⏭️ skipped ${it.skipStreak}x → offer ${it.lengthen?.section ?? 'a longer cadence'}`
					: '',
				it.needsInterval ? '⚠️ needs interval' : `→ ${it.nextDate}`,
			]
				.filter(Boolean)
				.join(' ');
			const display = it.name.replace(TIME_RE, '⟨time⟩').slice(0, 200);
			process.stdout.write(
				`  [${it.shortId}] due ${it.due} (overdue ${it.overdueByDays}d) ${tags}\n      ${display}\n`,
			);
		}
	}
	process.stdout.write(`\nTOTAL OVERDUE: ${rows.length} (${rows.filter((r) => r.isLlmTask).length} #llm-task)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
