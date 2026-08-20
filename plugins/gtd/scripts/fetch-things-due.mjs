#!/usr/bin/env node
// Fetch the Things 3 tasks the daily review is responsible for, as JSON for collect-due-items.mjs.
//
// Things is read two ways in this repo and they are not interchangeable. The capture scanner
// reads main.sqlite directly, where dates are a packed integer format. This script uses
// AppleScript instead, because the review also has to *write* (complete, reschedule, cancel) and
// AppleScript is the only bridge that does both. Reading and writing through one bridge keeps the
// ids consistent between what was shown and what gets acted on.
//
// Three working sets. collect-due-items.mjs unions the first two:
//   due     -- anything with a deadline on or before today, whatever list it lives in
//   today   -- the Today list, which is what Things itself says to do now
//   anytime -- undated Anytime tasks, which nothing ever surfaces because nothing is due. These
//              are not due items; file-tasks sweeps them into the personal 📌 asap ladder.
//
// Usage: node fetch-things-due.mjs [--today YYYY-MM-DD] > things.json

import {execFileSync} from 'node:child_process';

// ASCII unit/record separators: a task title or note can contain any punctuation -- including
// newlines and pipes -- but never these.
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
		.filter((fields) => fields.length === 5)
		.map(([id, title, due, list, notes]) => ({id, title, due: normalizeDate(due), list, notes: notes || null}));
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
		set out to out & (id of t) & fs & (name of t) & fs & ds & fs & "${listName}" & fs & (notes of t) & rs
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

/**
 * Split the two raw Things lists into the review's working sets. Things treats Anytime as a
 * superset that already contains Today, so the Today ids come off the Anytime list once, up front,
 * and both splits work from that remainder rather than trusting the list membership.
 */
export function partitionThings({todayList, anytime}, todayISO) {
	const inToday = new Set(todayList.map((t) => t.id));
	const anytimeOnly = anytime.filter((t) => !inToday.has(t.id));

	const due = [...todayList, ...anytimeOnly].filter((t) => t.due && t.due <= todayISO);
	// A dated Anytime task is already handled -- either it is due now and in `due`, or it will
	// surface on its own date. Only the undated ones are invisible and need the asap sweep.
	const undatedAnytime = anytimeOnly.filter((t) => !t.due);

	return {due, today: todayList, anytime: undatedAnytime};
}

function main(argv) {
	const args = argv.slice(2);
	let today = localTodayISO();
	for (let i = 0; i < args.length; i++) if (args[i] === '--today') today = args[++i];

	const sets = partitionThings({todayList: run('Today'), anytime: run('Anytime')}, today);
	process.stdout.write(JSON.stringify(sets, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
