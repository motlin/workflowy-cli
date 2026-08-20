// Run: node --test plugins/gtd/scripts/compute-overdue.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	addInterval,
	buildTimeElement,
	computeOverdue,
	foldSkipLog,
	intervalDays,
	intervalForSection,
	loadSkipStreaks,
	nextLongerSection,
	parseTimeISO,
	recordOutcome,
	swapTimeElement,
} from './compute-overdue.mjs';

test('parseTimeISO pulls the date out of a node name', () => {
	const name = 'Record status <time startYear="2026" startMonth="6" startDay="24">Wed, Jun 24, 2026</time> ';
	assert.equal(parseTimeISO(name), '2026-06-24');
});

test('parseTimeISO returns null when there is no time element', () => {
	assert.equal(parseTimeISO('A task with no date'), null);
});

test('intervalForSection matches by substring, ignoring emoji prefixes', () => {
	assert.deepEqual(intervalForSection('🔄 Daily Review'), {amount: 1, unit: 'd'});
	assert.deepEqual(intervalForSection('⬆️ Frequently Important'), {amount: 1, unit: 'd'});
	assert.deepEqual(intervalForSection('☀️ Low priority daily tasks'), {amount: 1, unit: 'd'});
	assert.deepEqual(intervalForSection('🗓️ Weekly Review'), {amount: 7, unit: 'd'});
	assert.deepEqual(intervalForSection('Monthly Review'), {amount: 1, unit: 'm'});
	assert.deepEqual(intervalForSection('Every 2 months'), {amount: 2, unit: 'm'});
	assert.deepEqual(intervalForSection('Every 6 months'), {amount: 6, unit: 'm'});
	assert.deepEqual(intervalForSection('Annual Review'), {amount: 1, unit: 'y'});
});

test('intervalForSection returns null when the section needs a user-chosen interval', () => {
	assert.equal(intervalForSection('Every few years'), null);
	assert.equal(intervalForSection('🤷 Unrecognized section'), null);
});

test('addInterval advances days, weeks, months, and years', () => {
	assert.equal(addInterval('2026-06-24', {amount: 1, unit: 'd'}), '2026-06-25');
	assert.equal(addInterval('2026-06-24', {amount: 7, unit: 'd'}), '2026-07-01');
	assert.equal(addInterval('2026-06-24', {amount: 1, unit: 'm'}), '2026-07-24');
	assert.equal(addInterval('2026-06-24', {amount: 1, unit: 'y'}), '2027-06-24');
});

test('addInterval clamps a month rollover to the last day rather than skipping a month', () => {
	// Jan 31 + 1 month must not roll into March.
	assert.equal(addInterval('2026-01-31', {amount: 1, unit: 'm'}), '2026-02-28');
});

test('buildTimeElement computes the weekday and keeps the trailing space', () => {
	const el = buildTimeElement('2026-06-24');
	assert.match(el, /startYear="2026"/);
	assert.match(el, /startMonth="6"/);
	assert.match(el, /startDay="24"/);
	assert.match(el, />Wed, Jun 24, 2026<\/time> $/);
});

test('swapTimeElement replaces an existing time element in place', () => {
	const name = 'Reminders <time startYear="2026" startMonth="6" startDay="24">Wed, Jun 24, 2026</time> ';
	const next = buildTimeElement('2026-06-25');
	const swapped = swapTimeElement(name, next);
	assert.match(swapped, /^Reminders /);
	assert.match(swapped, /startDay="25"/);
	assert.doesNotMatch(swapped, /startDay="24"/);
});

const FIXTURE = {
	children: [
		{
			name: '🔄 Daily Review',
			priority: 3,
			children: [
				{
					name: 'Reminders <time startYear="2026" startMonth="6" startDay="24">Wed, Jun 24, 2026</time> ',
					id: 'id-reminders',
					shortId: 'sid-reminders',
					children: [],
				},
				{
					name: 'Future task <time startYear="2026" startMonth="6" startDay="30">Tue, Jun 30, 2026</time> ',
					id: 'id-future',
					shortId: 'sid-future',
					children: [],
				},
				{
					name: 'A task with no date and so never overdue',
					id: 'id-nodate',
					shortId: 'sid-nodate',
					children: [],
				},
			],
		},
		{
			name: '🗓️ Weekly Review',
			priority: 5,
			children: [
				{
					name: 'Factorio data converter #llm-task <time startYear="2026" startMonth="6" startDay="20">Sat, Jun 20, 2026</time> ',
					id: 'id-factorio',
					shortId: 'sid-factorio',
					children: [{name: 'a sub-step'}],
				},
			],
		},
		{
			name: '🗃️ Routine Archive',
			priority: 9,
			children: [
				{
					name: 'Archived thing <time startYear="2020" startMonth="1" startDay="1">Wed, Jan 1, 2020</time> ',
					id: 'id-archive',
					shortId: 'sid-archive',
					children: [],
				},
			],
		},
	],
};

test('computeOverdue finds only on-or-before-today dated items, skipping the archive', () => {
	const rows = computeOverdue(FIXTURE, '2026-06-26');
	const ids = rows.map((r) => r.id);
	assert.deepEqual(ids, ['id-reminders', 'id-factorio']);
});

test('computeOverdue skips the Phase 0 LLM Tasks: container and its subtree', () => {
	const tree = {
		children: [
			{
				name: '🔄 Daily Review',
				priority: 3,
				children: [
					{
						name: 'Real recurring task <time startYear="2026" startMonth="6" startDay="24">Wed, Jun 24, 2026</time> ',
						id: 'id-real',
						shortId: 'sid-real',
						children: [],
					},
					{
						name: 'LLM Tasks:',
						id: 'id-llm-container',
						shortId: 'sid-llm',
						children: [
							{
								name: '📥 Import latest workflowy data #llm-task <time startYear="2026" startMonth="6" startDay="20">Sat, Jun 20, 2026</time> ',
								id: 'id-import',
								shortId: 'sid-import',
								children: [],
							},
						],
					},
				],
			},
		],
	};
	const ids = computeOverdue(tree, '2026-06-26').map((r) => r.id);
	assert.deepEqual(ids, ['id-real']);
});

test('computeOverdue orders by section priority then due date', () => {
	const rows = computeOverdue(FIXTURE, '2026-06-26');
	assert.equal(rows[0].section, '🔄 Daily Review');
	assert.equal(rows[1].section, '🗓️ Weekly Review');
});

test('computeOverdue annotates overdue days, llm-task, and child count', () => {
	const rows = computeOverdue(FIXTURE, '2026-06-26');
	const reminders = rows.find((r) => r.id === 'id-reminders');
	assert.equal(reminders.due, '2026-06-24');
	assert.equal(reminders.overdueByDays, 2);
	assert.equal(reminders.isLlmTask, false);
	assert.equal(reminders.hasKids, false);

	const factorio = rows.find((r) => r.id === 'id-factorio');
	assert.equal(factorio.isLlmTask, true);
	assert.equal(factorio.hasKids, true);
});

test('computeOverdue stages the next date and a verbatim node update applyOp', () => {
	const rows = computeOverdue(FIXTURE, '2026-06-26');
	const reminders = rows.find((r) => r.id === 'id-reminders');
	// Daily Review = +1 day from today (the review date advances to today + interval).
	assert.equal(reminders.nextDate, '2026-06-27');
	assert.match(reminders.newName, /^Reminders /);
	assert.match(reminders.newName, /startDay="27"/);
	assert.match(reminders.applyOp, /^\.\/bin\/run\.js node update --id id-reminders --name /);
	// The new <time> element must be embedded in the applyOp verbatim.
	assert.ok(reminders.applyOp.includes(reminders.newName));
});

test('computeOverdue flags sections that need a user-chosen interval', () => {
	const tree = {
		children: [
			{
				name: 'Every few years',
				priority: 1,
				children: [
					{
						name: 'Replace smoke detectors <time startYear="2026" startMonth="1" startDay="1">Thu, Jan 1, 2026</time> ',
						id: 'id-smoke',
						shortId: 'sid-smoke',
						children: [],
					},
				],
			},
		],
	};
	const rows = computeOverdue(tree, '2026-06-26');
	assert.equal(rows.length, 1);
	assert.equal(rows[0].needsInterval, true);
	assert.equal(rows[0].nextDate, null);
	assert.equal(rows[0].applyOp, null);
});

test('intervalDays orders every cadence from daily to annual', () => {
	assert.equal(intervalDays({amount: 1, unit: 'd'}), 1);
	assert.equal(intervalDays({amount: 7, unit: 'd'}), 7);
	assert.ok(intervalDays({amount: 1, unit: 'm'}) > intervalDays({amount: 7, unit: 'd'}));
	assert.ok(intervalDays({amount: 1, unit: 'y'}) > intervalDays({amount: 6, unit: 'm'}));
	assert.equal(intervalDays(null), Infinity);
});

const LADDER_SECTIONS = [
	{name: '⬆️ Frequently Important', id: 'sec-freq'},
	{name: '🗓️ Weekly Review', id: 'sec-weekly'},
	{name: '📅 Monthly Review', id: 'sec-monthly'},
	{name: '🗓️ Every 6 months', id: 'sec-6mo'},
	{name: '🎆 Annual Review', id: 'sec-annual'},
	{name: '🗃️ Routine Archive', id: 'sec-archive'},
	{name: 'Every few years', id: 'sec-fewyears'},
];

test('nextLongerSection climbs one rung of the cadence ladder', () => {
	assert.equal(nextLongerSection(LADDER_SECTIONS, {amount: 1, unit: 'd'}).id, 'sec-weekly');
	assert.equal(nextLongerSection(LADDER_SECTIONS, {amount: 7, unit: 'd'}).id, 'sec-monthly');
	assert.equal(nextLongerSection(LADDER_SECTIONS, {amount: 1, unit: 'm'}).id, 'sec-6mo');
	assert.equal(nextLongerSection(LADDER_SECTIONS, {amount: 6, unit: 'm'}).id, 'sec-annual');
});

test('nextLongerSection returns null at the top of the ladder and for unknown cadences', () => {
	assert.equal(nextLongerSection(LADDER_SECTIONS, {amount: 1, unit: 'y'}), null);
	assert.equal(nextLongerSection(LADDER_SECTIONS, null), null);
});

test('nextLongerSection never targets the archive', () => {
	const sections = [
		{name: '🔄 Daily Review', id: 'sec-daily'},
		{name: '🗃️ Routine Archive', id: 'sec-archive'},
	];
	assert.equal(nextLongerSection(sections, {amount: 1, unit: 'd'}), null);
});

test('foldSkipLog counts consecutive trailing skips per item', () => {
	const streaks = foldSkipLog([
		{key: 'id-a', outcome: 'done', date: '2026-08-10'},
		{key: 'id-a', outcome: 'skip', date: '2026-08-11'},
		{key: 'id-a', outcome: 'skip', date: '2026-08-12'},
		{key: 'id-b', outcome: 'skip', date: '2026-08-12'},
	]);
	assert.equal(streaks.get('id-a').skipStreak, 2);
	assert.equal(streaks.get('id-a').skippedSince, '2026-08-11');
	assert.equal(streaks.get('id-b').skipStreak, 1);
});

test('foldSkipLog resets the streak when the item is finally handled', () => {
	const streaks = foldSkipLog([
		{key: 'id-a', outcome: 'skip', date: '2026-08-10'},
		{key: 'id-a', outcome: 'skip', date: '2026-08-11'},
		{key: 'id-a', outcome: 'done', date: '2026-08-12'},
	]);
	assert.equal(streaks.get('id-a').skipStreak, 0);
	assert.equal(streaks.get('id-a').skippedSince, null);
});

test('foldSkipLog collapses repeats from the same day so a re-run cannot inflate a streak', () => {
	const streaks = foldSkipLog([
		{key: 'id-a', outcome: 'skip', date: '2026-08-12'},
		{key: 'id-a', outcome: 'skip', date: '2026-08-12'},
		{key: 'id-a', outcome: 'skip', date: '2026-08-12'},
	]);
	assert.equal(streaks.get('id-a').skipStreak, 1);
});

test('foldSkipLog lets a same-day correction overwrite an earlier outcome', () => {
	const streaks = foldSkipLog([
		{key: 'id-a', outcome: 'skip', date: '2026-08-11'},
		{key: 'id-a', outcome: 'skip', date: '2026-08-12'},
		{key: 'id-a', outcome: 'done', date: '2026-08-12'},
	]);
	assert.equal(streaks.get('id-a').skipStreak, 0);
});

test('recordOutcome appends to the log and loadSkipStreaks reads it back', () => {
	const dir = mkdtempSync(join(tmpdir(), 'gtd-skip-'));
	const logPath = join(dir, 'skip-log.jsonl');
	recordOutcome('id-a', 'skip', {date: '2026-08-11', path: logPath});
	recordOutcome('id-a', 'skip', {date: '2026-08-12', path: logPath});
	recordOutcome('id-b', 'done', {date: '2026-08-12', path: logPath});

	const streaks = loadSkipStreaks(logPath);
	assert.equal(streaks.get('id-a').skipStreak, 2);
	assert.equal(streaks.get('id-b').skipStreak, 0);
	rmSync(dir, {recursive: true, force: true});
});

test('loadSkipStreaks treats a missing log as no history', () => {
	const streaks = loadSkipStreaks(join(tmpdir(), 'gtd-skip-does-not-exist', 'skip-log.jsonl'));
	assert.equal(streaks.size, 0);
});

test('computeOverdue reports a zero skip streak when there is no history', () => {
	const rows = computeOverdue(FIXTURE, '2026-06-26');
	assert.equal(rows[0].skipStreak, 0);
	assert.equal(rows[0].skippedSince, null);
});

test('computeOverdue carries each item skip streak onto its row', () => {
	const streaks = foldSkipLog([
		{key: 'id-reminders', outcome: 'skip', date: '2026-06-24'},
		{key: 'id-reminders', outcome: 'skip', date: '2026-06-25'},
	]);
	const rows = computeOverdue(FIXTURE, '2026-06-26', {skipStreaks: streaks});
	const reminders = rows.find((r) => r.id === 'id-reminders');
	assert.equal(reminders.skipStreak, 2);
	assert.equal(reminders.skippedSince, '2026-06-24');
});

const LADDER_TREE = {
	children: [
		{
			name: '🔄 Daily Review',
			id: 'sec-daily',
			priority: 3,
			children: [
				{
					name: 'Change batteries in the front door lock <time startYear="2026" startMonth="6" startDay="24">Wed, Jun 24, 2026</time> ',
					id: 'id-batteries',
					shortId: 'sid-batteries',
					children: [],
				},
			],
		},
		{name: '🗓️ Weekly Review', id: 'sec-weekly', priority: 5, children: []},
		{name: '🎆 Annual Review', id: 'sec-annual', priority: 8, children: []},
	],
};

test('computeOverdue stages a lengthen op that moves the item up one cadence rung', () => {
	const rows = computeOverdue(LADDER_TREE, '2026-06-26');
	const {lengthen} = rows[0];
	assert.equal(lengthen.section, '🗓️ Weekly Review');
	assert.equal(lengthen.sectionId, 'sec-weekly');
	assert.deepEqual(lengthen.interval, {amount: 7, unit: 'd'});
	assert.equal(lengthen.nextDate, '2026-07-03');
	assert.match(lengthen.newName, /startDay="3"/);
	assert.match(lengthen.newName, /startMonth="7"/);
	assert.ok(lengthen.applyOp.includes(`node update --id id-batteries --name `));
	assert.ok(lengthen.applyOp.includes(lengthen.newName));
	assert.ok(lengthen.applyOp.includes('node move --node-id id-batteries --parent-id sec-weekly'));
});

test('computeOverdue leaves lengthen null at the top of the ladder', () => {
	const tree = {
		children: [
			{
				name: '🎆 Annual Review',
				id: 'sec-annual',
				priority: 8,
				children: [
					{
						name: 'Review the will <time startYear="2026" startMonth="1" startDay="1">Thu, Jan 1, 2026</time> ',
						id: 'id-will',
						shortId: 'sid-will',
						children: [],
					},
				],
			},
		],
	};
	assert.equal(computeOverdue(tree, '2026-06-26')[0].lengthen, null);
});

test('computeOverdue leaves lengthen null when the section interval is unknown', () => {
	const tree = {
		children: [
			{
				name: 'Every few years',
				id: 'sec-fewyears',
				priority: 1,
				children: [
					{
						name: 'Replace smoke detectors <time startYear="2026" startMonth="1" startDay="1">Thu, Jan 1, 2026</time> ',
						id: 'id-smoke',
						shortId: 'sid-smoke',
						children: [],
					},
				],
			},
			{name: '🎆 Annual Review', id: 'sec-annual', priority: 8, children: []},
		],
	};
	assert.equal(computeOverdue(tree, '2026-06-26')[0].lengthen, null);
});

test('computeOverdue leaves lengthen null when the target section has no id to move into', () => {
	const tree = {
		children: [
			{
				name: '🔄 Daily Review',
				id: 'sec-daily',
				priority: 3,
				children: [
					{
						name: 'Water the plants <time startYear="2026" startMonth="6" startDay="24">Wed, Jun 24, 2026</time> ',
						id: 'id-plants',
						shortId: 'sid-plants',
						children: [],
					},
				],
			},
			{name: '🗓️ Weekly Review', priority: 5, children: []},
		],
	};
	assert.equal(computeOverdue(tree, '2026-06-26')[0].lengthen, null);
});
