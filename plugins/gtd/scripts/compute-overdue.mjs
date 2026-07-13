#!/usr/bin/env node
// Compute the overdue recurring-review items from a fetched review tree.
//
// This is the deterministic half of the daily review's Recurring Review.
// It parses each recurring leaf item's <time> element, finds the ones due on or
// before today, and stages the exact update that advances each item from its section's
// interval. The Phase 0 planner imports the shared date helpers from this module.
//
// Usage:
//   node compute-overdue.mjs [tree.json] [--today YYYY-MM-DD] [--print]
//
// Default tree path: .llm/gtd/review/tree.json. Default today: the local date.
// Without --print, emits the overdue rows as JSON to stdout.
//
// The section -> interval table mirrors plugins/gtd/skills/review-date-updates.md;
// this script is the executable source of truth for it.

import {readFileSync} from 'node:fs';

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

function shellSingleQuote(s) {
	return `'${String(s).replaceAll("'", `'"'"'`)}'`;
}

function daysBetween(fromISO, toISO) {
	const a = new Date(fromISO + 'T00:00:00Z');
	const b = new Date(toISO + 'T00:00:00Z');
	return Math.round((b - a) / 86_400_000);
}

export function computeOverdue(tree, todayISO) {
	const sections = tree.children ?? [];
	const rows = [];

	sections.forEach((section, sectionIndex) => {
		if (String(section.name).includes('🗃️ Routine Archive')) return;
		const interval = intervalForSection(section.name);

		const walk = (node) => {
			for (const child of node.children ?? []) {
				// The keyed DAG owns the entire LLM Tasks subtree, so recurring review must not surface it.
				if (String(child.name).includes('LLM Tasks:')) continue;
				const due = parseTimeISO(child.name);
				if (due && due <= todayISO) {
					const needsInterval = interval === null;
					const nextDate = needsInterval ? null : addInterval(todayISO, interval);
					let newName = null;
					let applyOp = null;
					if (nextDate) {
						newName = swapTimeElement(child.name, buildTimeElement(nextDate));
						applyOp = `./bin/run.js node update --id ${child.id} --name ${shellSingleQuote(newName)}`;
					}
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
						hasKids: (child.children ?? []).length > 0,
						interval,
						needsInterval,
						nextDate,
						nextTimeElement: nextDate ? buildTimeElement(nextDate) : null,
						newName,
						applyOp,
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
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--today') today = args[++i];
		else if (args[i] === '--print') print = true;
		else if (!args[i].startsWith('--')) treePath = args[i];
	}

	const tree = JSON.parse(readFileSync(treePath, 'utf8'));
	const rows = computeOverdue(tree, today);

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
				it.hasKids ? '(has kids)' : '',
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
