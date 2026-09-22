// Run: node --test plugins/gtd/scripts/launch-herdr-tab.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {insertIndexRightOf, parseArgs} from './launch-herdr-tab.mjs';

const tab = (workspace_id, tab_id) => ({workspace_id, tab_id});

test('insert index sits immediately right of the caller tab within its workspace', () => {
	const tabs = [
		tab('w1', 'w1:t1'),
		tab('w8', 'w8:t8'),
		tab('w8', 'w8:t27'),
		tab('w8', 'w8:t32'),
		tab('w8', 'w8:t40'),
	];
	assert.strictEqual(insertIndexRightOf(tabs, 'w8', 'w8:t27'), 2);
});

test('a caller tab that is already last yields the end position', () => {
	const tabs = [tab('w8', 'w8:t8'), tab('w8', 'w8:t27')];
	assert.strictEqual(insertIndexRightOf(tabs, 'w8', 'w8:t27'), 2);
});

test('a caller tab missing from the workspace is an error', () => {
	assert.throws(() => insertIndexRightOf([tab('w8', 'w8:t8')], 'w8', 'w8:t99'), /w8:t99/);
});

test('parseArgs splits the label, cwd, and command after --', () => {
	assert.deepStrictEqual(parseArgs(['--label', 'time-machine', '--cwd', '/projects', '--', '/bin/sweep.sh', 'arg']), {
		label: 'time-machine',
		cwd: '/projects',
		focus: true,
		command: ['/bin/sweep.sh', 'arg'],
	});
});

test('parseArgs honours --no-focus', () => {
	assert.strictEqual(parseArgs(['--label', 'x', '--no-focus', '--', 'echo']).focus, false);
});

test('parseArgs requires a label and a command', () => {
	assert.throws(() => parseArgs(['--', 'echo']), /--label/);
	assert.throws(() => parseArgs(['--label', 'x']), /command/);
});
