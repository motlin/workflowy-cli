// Run: node --test plugins/gtd/scripts/otter-api-credentials.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT = fileURLToPath(new URL('./otter-api.sh', import.meta.url));

/** Build a sandbox with a fake `op` that records every invocation. */
function sandbox() {
	const dir = mkdtempSync(join(tmpdir(), 'otter-creds-'));
	const bin = join(dir, 'bin');
	const cache = join(dir, 'cache');
	const calls = join(dir, 'op-calls.log');
	mkdirSync(bin);
	mkdirSync(cache);
	const fakeOp = join(bin, 'op');
	writeFileSync(
		fakeOp,
		[
			'#!/bin/bash',
			`echo "$*" >> ${JSON.stringify(calls)}`,
			'case "$2" in',
			'*username*) echo user@example.com ;;',
			'*) echo hunter2 ;;',
			'esac',
			'',
		].join('\n'),
	);
	chmodSync(fakeOp, 0o755);
	return {dir, bin, cache, calls};
}

function warm(sb) {
	return execFileSync('bash', [SCRIPT, 'warm-credentials'], {
		env: {
			...process.env,
			PATH: `${sb.bin}:${process.env.PATH}`,
			OTTER_CACHE_DIR: sb.cache,
			OTTER_USERNAME: 'op://Private/Otter/username',
			OTTER_PASSWORD: 'op://Private/Otter/password',
		},
		encoding: 'utf8',
	});
}

const opCalls = (sb) => (existsSync(sb.calls) ? readFileSync(sb.calls, 'utf8').trim().split('\n').filter(Boolean) : []);

test('warm-credentials resolves op:// refs into the cache file', () => {
	const sb = sandbox();
	warm(sb);
	const creds = readFileSync(join(sb.cache, 'otter-creds-cache'), 'utf8');
	assert.deepStrictEqual(creds.trim().split('\n'), ['user@example.com', 'hunter2']);
	assert.equal(opCalls(sb).length, 2, 'cold warm should call op exactly twice');
});

test('warm-credentials is a no-op once the cache exists, so subagents never invoke op', () => {
	const sb = sandbox();
	warm(sb);
	warm(sb);
	assert.equal(opCalls(sb).length, 2, 'second warm must not invoke op again');
});

const SYNC_PY = fileURLToPath(new URL('./otter_sync.py', import.meta.url));

test('credential cache lives outside /tmp so reads do not trigger permission prompts', () => {
	for (const file of [SCRIPT, SYNC_PY]) {
		const body = readFileSync(file, 'utf8');
		for (const stale of ['/tmp/otter-creds-cache', '/tmp/otter-session-cache', '/tmp/otter-userid-cache']) {
			assert.ok(!body.includes(stale), `${file} must not hardcode ${stale}`);
		}
	}
});

test('the shell and python scanners share one cache dir, so warming the shell warms both', () => {
	const sb = sandbox();
	warm(sb);
	const resolved = execFileSync(
		'python3',
		[
			'-c',
			`import os,sys; sys.path.insert(0,${JSON.stringify(join(SYNC_PY, '..'))}); import otter_sync; print(otter_sync.CREDS_FILE)`,
		],
		{env: {...process.env, OTTER_CACHE_DIR: sb.cache}, encoding: 'utf8'},
	).trim();
	assert.equal(resolved, join(sb.cache, 'otter-creds-cache'));
	assert.equal(opCalls(sb).length, 2, 'python scanner must reuse the warmed cache, not call op again');
});
