// Run: node --test plugins/gtd/scripts/fetch-things-due.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FIELD_SEP, OSASCRIPT_TIMEOUT_MS, parseThingsRows, partitionThings, RECORD_SEP} from './fetch-things-due.mjs';

const row = (...fields) => fields.join(FIELD_SEP);
const out = (...rows) => rows.join(RECORD_SEP) + RECORD_SEP;

test('parseThingsRows splits the record-separated AppleScript output', () => {
	const raw = out(
		row('JMwVZ', 'Pay temple dues', '2026-8-1', 'Today', 'bring the receipt'),
		row('9XHRt', 'FreshDirect order', '', 'Today', ''),
	);

	// The notes come along because the walk shows an item's context before asking about it.
	assert.deepEqual(parseThingsRows(raw), [
		{id: 'JMwVZ', title: 'Pay temple dues', due: '2026-08-01', list: 'Today', notes: 'bring the receipt'},
		{id: '9XHRt', title: 'FreshDirect order', due: null, list: 'Today', notes: null},
	]);
});

test('parseThingsRows zero-pads single-digit months and days', () => {
	assert.equal(parseThingsRows(out(row('a', 'T', '2026-3-9', 'Anytime', '')))[0].due, '2026-03-09');
});

test('parseThingsRows returns nothing for empty output', () => {
	assert.deepEqual(parseThingsRows(''), []);
	assert.deepEqual(parseThingsRows(RECORD_SEP), []);
});

test('parseThingsRows preserves titles containing newlines and pipes', () => {
	// Control-character separators are used precisely so ordinary punctuation in a task title
	// cannot corrupt the parse.
	const raw = out(row('x', 'Buy milk | eggs\nand bread', '', 'Today', ''));
	assert.equal(parseThingsRows(raw)[0].title, 'Buy milk | eggs\nand bread');
});

test('parseThingsRows skips malformed records rather than emitting partial rows', () => {
	const raw = out(row('good', 'Fine', '', 'Today', ''), 'truncated-record');
	assert.deepEqual(
		parseThingsRows(raw).map((r) => r.id),
		['good'],
	);
});

const task = (id, due, list) => ({id, title: `task ${id}`, due, list});

test('partitionThings unions Today and Anytime into the due set without duplicating a task', () => {
	const todayList = [task('a', '2026-08-01', 'Today'), task('b', null, 'Today')];
	const anytime = [task('a', '2026-08-01', 'Anytime'), task('c', '2026-08-05', 'Anytime')];

	const {due, today} = partitionThings({todayList, anytime}, '2026-08-07');

	assert.deepEqual(
		due.map((t) => [t.id, t.list]),
		[
			['a', 'Today'],
			['c', 'Anytime'],
		],
	);
	assert.equal(today, todayList);
});

test('partitionThings leaves tasks due after today out of the due set', () => {
	const {due} = partitionThings({todayList: [], anytime: [task('later', '2026-09-01', 'Anytime')]}, '2026-08-07');
	assert.deepEqual(due, []);
});

/**
 * Things "Anytime" is where undated personal work piles up invisibly -- nothing ever surfaces it,
 * because nothing is due. The review sweeps it into the personal asap ladder instead, so these
 * rows are reported separately from `due` and carry no date.
 */
test('partitionThings reports undated Anytime tasks separately for the asap sweep', () => {
	const todayList = [task('in-today', null, 'Today')];
	const anytime = [
		task('in-today', null, 'Anytime'),
		task('undated', null, 'Anytime'),
		task('dated', '2026-09-01', 'Anytime'),
	];

	const {anytime: sweep} = partitionThings({todayList, anytime}, '2026-08-07');

	assert.deepEqual(
		sweep.map((t) => t.id),
		['undated'],
	);
});

test('the osascript budget leaves room for a large Anytime backlog', () => {
	assert.equal(OSASCRIPT_TIMEOUT_MS, 180_000);
});
