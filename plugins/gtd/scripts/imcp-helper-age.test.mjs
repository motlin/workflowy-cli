// Run: node --test plugins/gtd/scripts/imcp-helper-age.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {STALE_THRESHOLD_SECONDS, ageSeconds, parseLstartToEpochSeconds} from './imcp-helper-age.mjs';

test('parseLstartToEpochSeconds parses the BSD ps lstart format', () => {
	const expected = Math.floor(new Date(2026, 5, 27, 14, 2, 14).getTime() / 1000);
	assert.strictEqual(parseLstartToEpochSeconds('Sat Jun 27 14:02:14 2026'), expected);
});

test('parseLstartToEpochSeconds tolerates trailing whitespace from ps -o lstart=', () => {
	const expected = Math.floor(new Date(2026, 5, 27, 14, 2, 14).getTime() / 1000);
	assert.strictEqual(parseLstartToEpochSeconds('Sat Jun 27 14:02:14 2026    '), expected);
});

test('parseLstartToEpochSeconds returns null on garbage input', () => {
	assert.strictEqual(parseLstartToEpochSeconds('not a date'), null);
	assert.strictEqual(parseLstartToEpochSeconds(''), null);
});

test('ageSeconds returns the difference from a known now', () => {
	const start = Math.floor(new Date(2026, 5, 27, 14, 2, 14).getTime() / 1000);
	assert.strictEqual(ageSeconds('Sat Jun 27 14:02:14 2026', start + 760), 760);
});

test('ageSeconds returns null when lstart is unparseable', () => {
	assert.strictEqual(ageSeconds('not a date', 1_000_000), null);
});

test('STALE_THRESHOLD_SECONDS is one day, matching the skill doc', () => {
	assert.strictEqual(STALE_THRESHOLD_SECONDS, 86400);
});
