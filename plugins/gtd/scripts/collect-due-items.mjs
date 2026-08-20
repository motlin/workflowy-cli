#!/usr/bin/env node
// Merge every dated task the daily review is responsible for into one ordered working set.
//
// This is the deterministic half of the Recurring Review's due-items segment. Three sources
// carry dated one-shot tasks -- the Workflowy ⏰ Tasks (due dates) buckets, Things 3, and Apple
// Reminders -- and each one models dates differently. This normalizes all three into a single
// schema, drops anything not yet due, orders the survivors by due date, and stages the exact
// shell command for each outcome so the walk never builds one by hand.
//
// Recurring review items are NOT collected here: they always come back on an interval, so
// compute-overdue.mjs owns them. This script owns tasks that should be done once and go away.
//
// Usage:
//   node collect-due-items.mjs --workflowy roots.json --things things.json \
//     --reminders reminders.json [--today YYYY-MM-DD] [--print]
//
// Every input is optional; a missing source contributes nothing rather than failing.

import {readFileSync} from 'node:fs';
import {buildTimeElement, parseTimeISO, swapTimeElement} from './compute-overdue.mjs';

const DUE_BUCKET_PREFIX = '⏰';
const TASKS_WRAPPER_PREFIX = '✅';
// Legacy containers from before due dates lived on the nodes themselves. Tasks nest one level
// deeper inside these, so the collector descends through them until the data is migrated.
const TIMEFRAME_NAMES = ['Today', 'This week', 'This month'];

const pad = (n) => String(n).padStart(2, '0');

function shellSingleQuote(s) {
	return `'${String(s).replaceAll("'", `'"'"'`)}'`;
}

function daysBetween(fromISO, toISO) {
	const a = new Date(fromISO + 'T00:00:00Z');
	const b = new Date(toISO + 'T00:00:00Z');
	return Math.round((b - a) / 86_400_000);
}

function stripMarkup(name) {
	return String(name)
		.replace(/<time[^>]*>.*?<\/time>/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function lastDayOfMonth(year, month1) {
	return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

// file-tasks proposes a timeframe; the node stores a date. This is the conversion between them,
// and it is the only place that mapping lives.
export function resolveTimeframe(label, todayISO) {
	const [y, m, d] = todayISO.split('-').map(Number);
	if (/^today$/i.test(label)) return todayISO;
	if (/^this week$/i.test(label)) {
		// End of the working week: the upcoming Friday, or today when today already is Friday.
		const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
		const until = (5 - dow + 7) % 7;
		const dt = new Date(Date.UTC(y, m - 1, d + until));
		return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
	}
	if (/^this month$/i.test(label)) return `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`;
	throw new Error(`unknown timeframe: ${label}`);
}

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

// AppleScript's `date "..."` parses a plain human date. Workflowy's `<time>` element is HTML and
// means nothing to it, so the two sources need different substitutions for the same placeholder.
function appleScriptDate(iso) {
	const [y, m, d] = iso.split('-').map(Number);
	return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

/**
 * Fill a row's `reschedule` template for the new date, choosing the representation the row's
 * source actually understands. Callers pass an ISO date and never format it themselves — picking
 * the wrong one silently writes a garbage date rather than failing.
 */
export function applyReschedule(item, iso) {
	const replacement = item.source === 'workflowy' ? buildTimeElement(iso) : appleScriptDate(iso);
	return item.ops.reschedule.split('{{date}}').join(replacement);
}

function workflowyOps(node, due) {
	// The reschedule op is a template: substitute {{date}} with buildTimeElement(iso) to get the
	// runnable command. Keeping the element out of the template means the weekday label is always
	// computed, never typed.
	const rescheduledName = due
		? swapTimeElement(node.name, '{{date}}')
		: `${String(node.name).replace(/\s+$/, '')} {{date}}`;
	return {
		complete: `./bin/run.js node complete --id ${node.id}`,
		reschedule: `./bin/run.js node update --id ${node.id} --name ${shellSingleQuote(rescheduledName)}`,
		drop: `./bin/run.js node delete --id ${node.id}`,
	};
}

export function fromWorkflowy(roots, todayISO) {
	const items = [];

	for (const {rootKey, root} of roots ?? []) {
		const wrapper = (root.children ?? []).find((c) => String(c.name).startsWith(TASKS_WRAPPER_PREFIX));
		const containers = wrapper ? (wrapper.children ?? []) : (root.children ?? []);
		const bucket = containers.find((c) => String(c.name).startsWith(DUE_BUCKET_PREFIX));
		if (!bucket) continue;

		// Only the bucket's own children (and those of a legacy timeframe container) are tasks.
		// A task's children are sub-steps, notes, and provenance -- never tasks in their own right.
		const taskGroups = [];
		for (const child of bucket.children ?? []) {
			if (TIMEFRAME_NAMES.includes(String(child.name).trim())) {
				taskGroups.push({group: String(child.name).trim(), nodes: child.children ?? []});
			} else {
				taskGroups.push({group: null, nodes: [child]});
			}
		}

		for (const {group, nodes} of taskGroups) {
			for (const node of nodes) {
				if (node.completedAt) continue;
				const due = parseTimeISO(node.name);
				items.push({
					source: 'workflowy',
					rootKey,
					id: node.id,
					title: stripMarkup(node.name),
					name: node.name,
					due,
					dueSource: due ? 'deadline' : null,
					overdueByDays: due ? daysBetween(due, todayISO) : null,
					needsDate: due === null,
					group: group ?? String(bucket.name),
					url: node.shortId ? `https://workflowy.com/#/${node.shortId}` : null,
					childCount: (node.children ?? []).length,
					ops: workflowyOps(node, due),
				});
			}
		}
	}

	return items;
}

function thingsOps(id) {
	const complete = `tell application "Things3" to set status of to do id "${id}" to completed`;
	const drop = `tell application "Things3" to set status of to do id "${id}" to canceled`;
	const reschedule = `tell application "Things3" to set due date of to do id "${id}" to date "{{date}}"`;
	return {
		complete: `osascript -e ${shellSingleQuote(complete)}`,
		reschedule: `osascript -e ${shellSingleQuote(reschedule)}`,
		drop: `osascript -e ${shellSingleQuote(drop)}`,
	};
}

export function fromThings(things, todayISO) {
	if (!things) return [];
	const seen = new Set();
	const items = [];

	// `due` first so a task carrying a real deadline keeps that framing even when it also sits
	// in the Today list.
	const tagged = [
		...(things.due ?? []).map((task) => ({task, dueSource: 'deadline'})),
		...(things.today ?? []).map((task) => ({task, dueSource: task.due ? 'deadline' : 'scheduled'})),
	];

	for (const {task, dueSource} of tagged) {
		if (seen.has(task.id)) continue;
		seen.add(task.id);
		// A Today-list task without a deadline is not undated work. Things putting it in Today is
		// itself the due signal, so it dates to today rather than sinking below real deadlines.
		const due = task.due ?? todayISO;
		items.push({
			source: 'things',
			rootKey: null,
			id: task.id,
			title: task.title,
			name: task.title,
			due,
			dueSource,
			overdueByDays: daysBetween(due, todayISO),
			needsDate: false,
			group: task.list ?? 'Things',
			url: `things:///show?id=${task.id}`,
			childCount: 0,
			ops: thingsOps(task.id),
		});
	}

	return items;
}

function remindersOps(title) {
	// iMCP exposes no write tools and reminders carry no stable id here, so every op matches on
	// title through AppleScript -- the same bridge overview.md already documents.
	const target = `reminders of list "Reminders" whose completed is false and name is "${title}"`;
	const script = (body) =>
		`osascript -e ${shellSingleQuote(`tell application "Reminders"\nset matches to (${target})\nif (count of matches) > 0 then ${body}\nend tell`)}`;
	return {
		complete: script('set completed of (item 1 of matches) to true'),
		reschedule: script('set due date of (item 1 of matches) to date "{{date}}"'),
		drop: script('delete (item 1 of matches)'),
	};
}

export function fromReminders(reminders, todayISO) {
	if (!reminders) return [];
	// dueTomorrow is deliberately excluded: the walk is for what is due now, not a preview.
	return [...(reminders.overdue ?? []), ...(reminders.dueToday ?? [])].map((r) => {
		const due = r.dueDate ? String(r.dueDate).slice(0, 10) : null;
		return {
			source: 'reminders',
			rootKey: null,
			id: r.title,
			title: r.title,
			name: r.title,
			due,
			dueSource: due ? 'deadline' : null,
			overdueByDays: due ? daysBetween(due, todayISO) : null,
			needsDate: false,
			group: r.list ?? 'Reminders',
			url: null,
			childCount: 0,
			ops: remindersOps(r.title),
		};
	});
}

export function collectDueItems(sources, todayISO) {
	const rows = [
		...fromWorkflowy(sources.workflowy, todayISO),
		...fromThings(sources.things, todayISO),
		...fromReminders(sources.reminders, todayISO),
	];

	// Undated items sort last: they still need handling, but a real deadline outranks a maybe.
	return rows
		.filter((r) => r.due === null || r.due <= todayISO)
		.sort((a, b) => {
			if (a.due === null && b.due === null) return 0;
			if (a.due === null) return 1;
			if (b.due === null) return -1;
			return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
		});
}

function localTodayISO() {
	const now = new Date();
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readJSON(path) {
	return path ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

function main(argv) {
	const args = argv.slice(2);
	const paths = {workflowy: null, things: null, reminders: null};
	let today = localTodayISO();
	let print = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--today') today = args[++i];
		else if (args[i] === '--print') print = true;
		else if (args[i] === '--workflowy') paths.workflowy = args[++i];
		else if (args[i] === '--things') paths.things = args[++i];
		else if (args[i] === '--reminders') paths.reminders = args[++i];
	}

	const rows = collectDueItems(
		{workflowy: readJSON(paths.workflowy), things: readJSON(paths.things), reminders: readJSON(paths.reminders)},
		today,
	);

	if (!print) {
		process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
		return;
	}

	for (const r of rows) {
		const when = r.due ? `due ${r.due} (overdue ${r.overdueByDays}d)` : '⚠️ no date';
		process.stdout.write(`  [${r.source}] ${when} — ${r.title.slice(0, 90)}\n`);
	}
	const undated = rows.filter((r) => r.needsDate).length;
	process.stdout.write(`\nTOTAL DUE: ${rows.length}${undated ? ` (${undated} missing a date)` : ''}\n`);
}

export {buildTimeElement};

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
