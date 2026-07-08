// Run: node --test plugins/gtd/scripts/serve-overview.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyCheck, injectClient, startServer} from './serve-overview.mjs';

test('injectClient adds the client wiring and a Done control before </body>', () => {
	const out = injectClient('<html><body><h1>Overview</h1></body></html>');
	assert.match(out, /<\/script>\s*<\/body>/); // script injected inside body
	assert.match(out, /\/check/); // posts checkbox changes
	assert.match(out, /\/done/); // posts the submit
	assert.match(out, /id="overview-done"/); // a Done button exists
	assert.ok(out.indexOf('<h1>Overview</h1>') < out.indexOf('overview-done'));
});

test('applyCheck upserts a row by id and toggles checked', () => {
	let state = {submitted: false, checks: []};
	state = applyCheck(state, {id: 'a', source: 'workflowy', label: 'Task A', checked: true});
	assert.deepEqual(state.checks, [{id: 'a', source: 'workflowy', label: 'Task A', checked: true}]);
	// Re-checking the same id updates in place, not appends.
	state = applyCheck(state, {id: 'a', source: 'workflowy', label: 'Task A', checked: false});
	assert.equal(state.checks.length, 1);
	assert.equal(state.checks[0].checked, false);
});

test('the server serves the page, records checks, and flips submitted on /done', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'overview-'));
	const htmlPath = join(dir, 'overview.html');
	const outPath = join(dir, 'overview-checks.json');
	writeFileSync(htmlPath, '<html><body><h1>Morning</h1></body></html>');

	const {port, close} = await startServer({htmlPath, outPath, port: 0});
	try {
		const page = await fetch(`http://127.0.0.1:${port}/`);
		const body = await page.text();
		assert.match(body, /Morning/);
		assert.match(body, /overview-done/); // wiring injected on serve

		await fetch(`http://127.0.0.1:${port}/check`, {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify({id: 'node-1', source: 'workflowy', label: 'Pay rent', checked: true}),
		});
		await fetch(`http://127.0.0.1:${port}/done`, {method: 'POST'});

		const state = JSON.parse(readFileSync(outPath, 'utf8'));
		assert.equal(state.submitted, true);
		assert.deepEqual(state.checks, [{id: 'node-1', source: 'workflowy', label: 'Pay rent', checked: true}]);
	} finally {
		await close();
	}
});
