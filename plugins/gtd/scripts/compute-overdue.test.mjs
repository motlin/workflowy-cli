// Run: node --test plugins/gtd/scripts/compute-overdue.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
	addInterval,
	buildTimeElement,
	computeOverdue,
	intervalForSection,
	parseTimeISO,
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
	assert.deepEqual(intervalForSection('🔄 Daily Review'), {num: 1, unit: 'd'});
	assert.deepEqual(intervalForSection('⬆️ Frequently Important'), {num: 1, unit: 'd'});
	assert.deepEqual(intervalForSection('☀️ Low priority daily tasks'), {num: 1, unit: 'd'});
	assert.deepEqual(intervalForSection('🗓️ Weekly Review'), {num: 7, unit: 'd'});
	assert.deepEqual(intervalForSection('Monthly Review'), {num: 1, unit: 'm'});
	assert.deepEqual(intervalForSection('Every 2 months'), {num: 2, unit: 'm'});
	assert.deepEqual(intervalForSection('Every 6 months'), {num: 6, unit: 'm'});
	assert.deepEqual(intervalForSection('Annual Review'), {num: 1, unit: 'y'});
});

test('intervalForSection returns null when the section needs a user-chosen interval', () => {
	assert.equal(intervalForSection('Every few years'), null);
	assert.equal(intervalForSection('🤷 Unrecognized section'), null);
});

test('addInterval advances days, weeks, months, and years', () => {
	assert.equal(addInterval('2026-06-24', {num: 1, unit: 'd'}), '2026-06-25');
	assert.equal(addInterval('2026-06-24', {num: 7, unit: 'd'}), '2026-07-01');
	assert.equal(addInterval('2026-06-24', {num: 1, unit: 'm'}), '2026-07-24');
	assert.equal(addInterval('2026-06-24', {num: 1, unit: 'y'}), '2027-06-24');
});

test('addInterval clamps a month rollover to the last day rather than skipping a month', () => {
	// Jan 31 + 1 month must not roll into March.
	assert.equal(addInterval('2026-01-31', {num: 1, unit: 'm'}), '2026-02-28');
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
