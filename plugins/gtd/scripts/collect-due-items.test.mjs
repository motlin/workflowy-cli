// Run: node --test plugins/gtd/scripts/collect-due-items.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
	applyReschedule,
	collectDueItems,
	fromReminders,
	fromThings,
	fromWorkflowy,
	resolveTimeframe,
} from './collect-due-items.mjs';

const TODAY = '2026-08-07'; // a Friday

function workflowyRoot({rootKey = 'personal', bucketName = '⏰ Tasks (due dates) (personal)', tasks = []} = {}) {
	return {
		rootKey,
		root: {
			name: '☑️ Next (Personal)',
			id: 'root-uuid',
			children: [
				{name: '📋 Meeting agendas', id: 'agendas-uuid', children: []},
				{
					name: '✅ Tasks',
					id: 'wrapper-uuid',
					children: [
						{name: bucketName, id: 'bucket-uuid', children: tasks},
						{
							name: '📌 Tasks (asap) (personal)',
							id: 'asap-uuid',
							children: [{name: 'Not a due task', id: 'x'}],
						},
					],
				},
			],
		},
	};
}

const dated = (name, iso, id) => ({
	name: `${name} <time startYear="${iso.slice(0, 4)}" startMonth="${+iso.slice(5, 7)}" startDay="${+iso.slice(8, 10)}">label</time> `,
	id,
	shortId: id.slice(-12),
	children: [],
});

test('fromWorkflowy pulls dated tasks out of the ⏰ bucket only', () => {
	const items = fromWorkflowy(
		[
			workflowyRoot({
				tasks: [
					dated('Call the allergist', '2026-07-04', 'aaaaaaaaaaaa1111'),
					dated('Future thing', '2026-09-01', 'bbbbbbbbbbbb2222'),
				],
			}),
		],
		TODAY,
	);

	assert.deepEqual(
		items.map((i) => [i.source, i.title, i.due, i.overdueByDays]),
		[
			['workflowy', 'Call the allergist', '2026-07-04', 34],
			['workflowy', 'Future thing', '2026-09-01', -25],
		],
	);
});

test('fromWorkflowy never returns items from the 📌 asap bucket', () => {
	const items = fromWorkflowy([workflowyRoot({tasks: []})], TODAY);
	assert.deepEqual(items, []);
});

test('fromWorkflowy flags undated tasks sitting in the ⏰ bucket as needing a date', () => {
	const items = fromWorkflowy(
		[
			workflowyRoot({
				tasks: [
					{name: 'Forgot to date this one', id: 'cccccccccccc3333', shortId: 'cccc33334444', children: []},
				],
			}),
		],
		TODAY,
	);

	assert.equal(items.length, 1);
	assert.equal(items[0].due, null);
	assert.equal(items[0].needsDate, true);
});

test('fromWorkflowy skips completed tasks', () => {
	const task = dated('Already done', '2026-06-01', 'dddddddddddd4444');
	task.completedAt = '2026-06-02T00:00:00.000Z';
	assert.deepEqual(fromWorkflowy([workflowyRoot({tasks: [task]})], TODAY), []);
});

test('fromWorkflowy stages complete and reschedule ops carrying the full uuid', () => {
	const [item] = fromWorkflowy(
		[workflowyRoot({tasks: [dated('Pay dues', '2026-07-31', 'eeeeeeeeeeee5555')]})],
		TODAY,
	);

	assert.equal(item.ops.complete, './bin/run.js node complete --id eeeeeeeeeeee5555');
	assert.match(item.ops.reschedule, /^\.\/bin\/run\.js node update --id eeeeeeeeeeee5555 --name /);
	assert.match(item.ops.reschedule, /\{\{date\}\}/);
});

test('fromThings maps due-dated and Today-list tasks, deduping by id', () => {
	const items = fromThings(
		{
			due: [{id: 'JMwVZ', title: 'Pay temple dues', due: '2026-08-01', list: 'Anytime'}],
			today: [
				{id: 'JMwVZ', title: 'Pay temple dues', due: '2026-08-01', list: 'Today'},
				{id: '9XHRt', title: 'FreshDirect order', due: null, list: 'Today'},
			],
		},
		TODAY,
	);

	assert.deepEqual(
		items.map((i) => [i.source, i.id, i.title, i.due]),
		[
			['things', 'JMwVZ', 'Pay temple dues', '2026-08-01'],
			// An undated Today-list task is not undated work: Things scheduling it for today IS the
			// due signal, so it dates to today rather than sinking to the bottom of the walk.
			['things', '9XHRt', 'FreshDirect order', TODAY],
		],
	);
});

test('fromThings distinguishes a real deadline from a Today-list scheduling', () => {
	const items = fromThings(
		{
			due: [{id: 'a', title: 'Has a deadline', due: '2026-08-01', list: 'Anytime'}],
			today: [{id: 'b', title: 'Merely scheduled', due: null, list: 'Today'}],
		},
		TODAY,
	);

	assert.deepEqual(
		items.map((i) => [i.id, i.dueSource, i.needsDate]),
		[
			['a', 'deadline', false],
			['b', 'scheduled', false],
		],
	);
});

test('fromThings leaves an undated task outside the Today list undated', () => {
	const [item] = fromThings(
		{due: [], today: [], other: [{id: 'c', title: 'Someday', due: null, list: 'Anytime'}]},
		TODAY,
	);
	assert.equal(item, undefined);
});

test('fromThings stages an AppleScript completion keyed on the stable id', () => {
	const [item] = fromThings({due: [{id: 'JMwVZ', title: "Craig's task", due: '2026-08-01'}], today: []}, TODAY);

	assert.match(item.ops.complete, /Things3/);
	assert.match(item.ops.complete, /JMwVZ/);
	assert.match(item.ops.complete, /completed/);
});

test('fromReminders flattens overdue and dueToday, ignoring dueTomorrow', () => {
	const items = fromReminders(
		{
			overdue: [{title: 'Pay credit card', dueDate: '2026-08-01T09:00:00', list: 'Personal'}],
			dueToday: [{title: 'Call doctor', dueDate: '2026-08-07T14:00:00', list: 'Personal'}],
			dueTomorrow: [{title: 'Submit report', dueDate: '2026-08-08T17:00:00', list: 'Work'}],
		},
		TODAY,
	);

	assert.deepEqual(
		items.map((i) => [i.source, i.title, i.due]),
		[
			['reminders', 'Pay credit card', '2026-08-01'],
			['reminders', 'Call doctor', '2026-08-07'],
		],
	);
});

test('fromReminders keys its completion op on the title, since iMCP exposes no id', () => {
	const [item] = fromReminders(
		{overdue: [{title: "O'Brien follow-up", dueDate: '2026-08-01T09:00:00', list: 'Personal'}]},
		TODAY,
	);

	assert.equal(item.id, "O'Brien follow-up");
	assert.match(item.ops.complete, /Reminders/);
	assert.match(item.ops.complete, /O'"'"'Brien follow-up/);
});

test('collectDueItems merges all three sources sorted by due date, undated last', () => {
	const rows = collectDueItems(
		{
			workflowy: [
				workflowyRoot({
					tasks: [
						dated('Workflowy overdue', '2026-06-15', 'ffffffffffff6666'),
						{name: 'Workflowy undated', id: 'gggggggggggg7777', children: []},
					],
				}),
			],
			things: {due: [{id: 'TH1', title: 'Things overdue', due: '2026-07-01'}], today: []},
			reminders: {overdue: [{title: 'Reminder overdue', dueDate: '2026-05-01T09:00:00'}], dueToday: []},
		},
		TODAY,
	);

	assert.deepEqual(
		rows.map((r) => [r.source, r.due]),
		[
			['reminders', '2026-05-01'],
			['workflowy', '2026-06-15'],
			['things', '2026-07-01'],
			['workflowy', null],
		],
	);
});

test('collectDueItems drops items due after today', () => {
	const rows = collectDueItems(
		{
			workflowy: [workflowyRoot({tasks: [dated('Next month', '2026-09-01', 'hhhhhhhhhhhh8888')]})],
			things: null,
			reminders: null,
		},
		TODAY,
	);
	assert.deepEqual(rows, []);
});

test('collectDueItems tolerates missing sources', () => {
	assert.deepEqual(collectDueItems({}, TODAY), []);
});

test('resolveTimeframe converts the file-tasks timeframes into concrete dates', () => {
	// 2026-08-07 is a Friday, so "this week" lands on that same Friday.
	assert.equal(resolveTimeframe('Today', TODAY), '2026-08-07');
	assert.equal(resolveTimeframe('This week', TODAY), '2026-08-07');
	assert.equal(resolveTimeframe('This month', TODAY), '2026-08-31');
});

test('resolveTimeframe picks the upcoming Friday mid-week', () => {
	assert.equal(resolveTimeframe('This week', '2026-08-03'), '2026-08-07'); // Monday -> Friday
	assert.equal(resolveTimeframe('This week', '2026-08-08'), '2026-08-14'); // Saturday -> next Friday
});

/**
 * Regression test for the reschedule placeholder. Workflowy stores dates as a `<time>` element,
 * but the Things and Reminders ops are AppleScript and need a plain date string. The walk was
 * documented to substitute `buildTimeElement(iso)` into every `{{date}}`, which injected HTML
 * markup into `set due date ... to date "..."` and set a garbage date. `applyReschedule` makes
 * the substitution source-aware so the caller never picks the format.
 */
test('applyReschedule substitutes a <time> element for Workflowy items', () => {
	const [item] = fromWorkflowy(
		[
			workflowyRoot({
				tasks: [
					{
						name: 'Ship the thing <time startYear="2026" startMonth="6" startDay="1">Mon, Jun 1, 2026</time>',
						id: 'wf-uuid',
					},
				],
			}),
		],
		TODAY,
	);
	const cmd = applyReschedule(item, '2026-08-31');
	assert.match(cmd, /startYear="2026" startMonth="8" startDay="31"/);
	assert.doesNotMatch(cmd, /\{\{date\}\}/);
});

test('applyReschedule substitutes an AppleScript date string for Things items', () => {
	const [item] = fromThings({due: [{id: 'things-1', title: 'Refill the propane tank', due: '2026-04-25'}]}, TODAY);
	const cmd = applyReschedule(item, '2026-08-31');
	assert.doesNotMatch(cmd, /<time/);
	assert.doesNotMatch(cmd, /\{\{date\}\}/);
	assert.match(cmd, /date "August 31, 2026"/);
});

test('applyReschedule substitutes an AppleScript date string for Reminders items', () => {
	const [item] = fromReminders(
		{overdue: [{title: 'Replace the HEPA filters', dueDate: '2026-08-07T00:00:00-04:00'}]},
		TODAY,
	);
	const cmd = applyReschedule(item, '2026-08-31');
	assert.doesNotMatch(cmd, /<time/);
	assert.match(cmd, /date "August 31, 2026"/);
});
