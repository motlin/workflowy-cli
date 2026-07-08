#!/usr/bin/env node
// Report the running iMCP helper's age for the daily review's "iMCP self-heal
// preflight" (plugins/gtd/commands/review/daily/overview.md), which restarts
// iMCP only when it is genuinely stale.
//
// Prints one token to stdout:
//   none       no iMCP helper is running (launch a fresh one)
//   unknown    a helper is running but its start time couldn't be parsed
//              (proceed; don't kill a live helper on a parse glitch)
//   <integer>  the helper's age in whole seconds
//
// Age comes from `ps -o lstart=`, not `ps -o etimes=`: etimes is GNU/procps-only,
// so on BSD/macOS it errors and the empty result reads as "not running" — which
// would needlessly kill a healthy helper.

import {execSync} from 'node:child_process';

// ~1 day, mirrored in overview.md
export const STALE_THRESHOLD_SECONDS = 86400;

const MONTHS = {
	Jan: 0,
	Feb: 1,
	Mar: 2,
	Apr: 3,
	May: 4,
	Jun: 5,
	Jul: 6,
	Aug: 7,
	Sep: 8,
	Oct: 9,
	Nov: 10,
	Dec: 11,
};

// `ps -o lstart=` renders e.g. "Sat Jun 27 14:02:14 2026", sometimes with trailing
// spaces. Parse it to epoch seconds in local time, matching how ps prints it.
const LSTART_RE = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/;

export function parseLstartToEpochSeconds(lstart) {
	const m = String(lstart).trim().match(LSTART_RE);
	if (!m) return null;
	const month = MONTHS[m[1]];
	if (month === undefined) return null;
	const [, , day, hh, mm, ss, year] = m;
	return Math.floor(new Date(+year, month, +day, +hh, +mm, +ss).getTime() / 1000);
}

export function ageSeconds(lstart, nowEpochSeconds) {
	const start = parseLstartToEpochSeconds(lstart);
	return start === null ? null : nowEpochSeconds - start;
}

function main() {
	let pid = '';
	try {
		pid = execSync("pgrep -f 'iMCP.app/Contents/MacOS/imcp-server'", {encoding: 'utf8'}).split('\n')[0].trim();
	} catch {
		// pgrep exits non-zero when there is no match.
		pid = '';
	}
	if (!pid) {
		process.stdout.write('none\n');
		return;
	}

	let lstart = '';
	try {
		lstart = execSync(`ps -o lstart= -p ${pid}`, {encoding: 'utf8'}).trim();
	} catch {
		process.stdout.write('unknown\n');
		return;
	}

	const age = ageSeconds(lstart, Math.floor(Date.now() / 1000));
	process.stdout.write(age === null ? 'unknown\n' : `${age}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
