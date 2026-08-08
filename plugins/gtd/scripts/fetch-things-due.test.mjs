// Run: node --test plugins/gtd/scripts/fetch-things-due.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FIELD_SEP, parseThingsRows, RECORD_SEP} from './fetch-things-due.mjs';

const row = (...fields) => fields.join(FIELD_SEP);
const out = (...rows) => rows.join(RECORD_SEP) + RECORD_SEP;

test('parseThingsRows splits the record-separated AppleScript output', () => {
	const raw = out(
		row('JMwVZ', 'Pay temple dues', '2026-8-1', 'Today'),
		row('9XHRt', 'FreshDirect order', '', 'Today'),
	);

	assert.deepEqual(parseThingsRows(raw), [
		{id: 'JMwVZ', title: 'Pay temple dues', due: '2026-08-01', list: 'Today'},
		{id: '9XHRt', title: 'FreshDirect order', due: null, list: 'Today'},
	]);
});

test('parseThingsRows zero-pads single-digit months and days', () => {
	assert.equal(parseThingsRows(out(row('a', 'T', '2026-3-9', 'Anytime')))[0].due, '2026-03-09');
});

test('parseThingsRows returns nothing for empty output', () => {
	assert.deepEqual(parseThingsRows(''), []);
	assert.deepEqual(parseThingsRows(RECORD_SEP), []);
});

test('parseThingsRows preserves titles containing newlines and pipes', () => {
	// Control-character separators are used precisely so ordinary punctuation in a task title
	// cannot corrupt the parse.
	const raw = out(row('x', 'Buy milk | eggs\nand bread', '', 'Today'));
	assert.equal(parseThingsRows(raw)[0].title, 'Buy milk | eggs\nand bread');
});

test('parseThingsRows skips malformed records rather than emitting partial rows', () => {
	const raw = out(row('good', 'Fine', '', 'Today'), 'truncated-record');
	assert.deepEqual(
		parseThingsRows(raw).map((r) => r.id),
		['good'],
	);
});
