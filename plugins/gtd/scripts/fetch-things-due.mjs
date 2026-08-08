#!/usr/bin/env node
// Fetch the Things 3 tasks the daily review is responsible for, as JSON for collect-due-items.mjs.
//
// Things is read two ways in this repo and they are not interchangeable. The capture scanner
// reads main.sqlite directly, where dates are a packed integer format. This script uses
// AppleScript instead, because the review also has to *write* (complete, reschedule, cancel) and
// AppleScript is the only bridge that does both. Reading and writing through one bridge keeps the
// ids consistent between what was shown and what gets acted on.
//
// Two working sets, unioned by collect-due-items.mjs:
//   due   -- anything with a deadline on or before today, whatever list it lives in
//   today -- the Today list, which is what Things itself says to do now
//
// Usage: node fetch-things-due.mjs [--today YYYY-MM-DD] > things.json

import {execFileSync} from 'node:child_process';

// ASCII unit/record separators: a task title can contain any punctuation, but never these.
export const FIELD_SEP = '\x1f';
export const RECORD_SEP = '\x1e';

const pad = (n) => String(n).padStart(2, '0');

function normalizeDate(due) {
	if (!due) return null;
	const [y, m, d] = due.split('-').map(Number);
	return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseThingsRows(raw) {
	return String(raw)
		.split(RECORD_SEP)
		.filter((record) => record.length > 0)
		.map((record) => record.split(FIELD_SEP))
		.filter((fields) => fields.length === 4)
		.map(([id, title, due, list]) => ({id, title, due: normalizeDate(due), list}));
}

function script(listName) {
	// The separators are built with `ASCII character` so no control byte has to survive the trip
	// through the shell into an AppleScript string literal.
	return `set fs to (ASCII character 31)
set rs to (ASCII character 30)
tell application "Things3"
	set out to ""
	repeat with t in (to dos of list "${listName}")
		set dd to due date of t
		if dd is missing value then
			set ds to ""
		else
			set ds to ((year of dd) as string) & "-" & ((month of dd) as integer) & "-" & ((day of dd) as string)
		end if
		set out to out & (id of t) & fs & (name of t) & fs & ds & fs & "${listName}" & rs
	end repeat
	return out
end tell`;
}

function run(listName) {
	return parseThingsRows(execFileSync('osascript', ['-e', script(listName)], {encoding: 'utf8', timeout: 30_000}));
}

function localTodayISO() {
	const now = new Date();
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function main(argv) {
	const args = argv.slice(2);
	let today = localTodayISO();
	for (let i = 0; i < args.length; i++) if (args[i] === '--today') today = args[++i];

	const todayList = run('Today');
	// Things treats Anytime as a superset that already contains Today, so the union needs a dedup.
	const anytime = run('Anytime');
	const seen = new Set();
	const due = [...todayList, ...anytime].filter((t) => t.due && t.due <= today && !seen.has(t.id) && seen.add(t.id));

	process.stdout.write(JSON.stringify({due, today: todayList}, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
