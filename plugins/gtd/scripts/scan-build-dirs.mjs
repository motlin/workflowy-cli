#!/usr/bin/env node
// Find build directories that Time Machine still backs up.
//
// `find ~/projects` exits non-zero when a directory disappears between being listed and being
// opened -- a `.git/rebase-merge` dir finishing its rebase is enough. That is not a failed scan:
// a directory that no longer exists has no build output to exclude. The walk prunes it and keeps
// going, so one transient entry never forces a second sweep of the whole tree. Anything else
// (permission denied, a missing root, a tmutil crash) is a real failure and exits non-zero.
//
// Usage: scan-build-dirs.mjs [root]    (default: ~/projects)
// Prints NUL-delimited unexcluded paths on stdout, ready for group-build-dirs.mjs.
// Vanished directories are listed on stderr for the record.

import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const BUILD_DIR_NAMES = new Set(['node_modules', 'target', 'build', 'dist']);
const VANISHED_CODES = new Set(['ENOENT', 'ENOTDIR']);
const TMUTIL_BATCH_SIZE = 200;

export function walkBuildDirs(root, {readdir = readdirSync} = {}) {
	const dirs = [];
	const vanished = [];
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop();
		let entries;
		try {
			entries = readdir(directory, {withFileTypes: true});
		} catch (error) {
			if (directory !== root && VANISHED_CODES.has(error.code)) {
				vanished.push(directory);
				continue;
			}
			throw error;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const path = join(directory, entry.name);
			if (BUILD_DIR_NAMES.has(entry.name)) {
				dirs.push(path);
			} else {
				pending.push(path);
			}
		}
	}
	return {dirs: dirs.sort(), vanished: vanished.sort()};
}

function runTmutilIsExcluded(paths) {
	return execFileSync('tmutil', ['isexcluded', ...paths], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
}

export function classifyExclusions(
	paths,
	{runTmutil = runTmutilIsExcluded, exists = existsSync, batchSize = TMUTIL_BATCH_SIZE} = {},
) {
	const unexcluded = [];
	const vanished = [];
	for (let start = 0; start < paths.length; start += batchSize) {
		const batch = paths.slice(start, start + batchSize);
		const lines = runTmutil(batch)
			.split('\n')
			.filter((line) => line !== '');
		if (lines.length !== batch.length) {
			throw new Error(`tmutil returned ${lines.length} lines for ${batch.length} paths`);
		}
		// tmutil prints one status line per argument, in argument order.
		for (const [index, path] of batch.entries()) {
			const line = lines[index];
			if (line.startsWith('[Excluded]')) continue;
			if (line.startsWith('[Included]')) {
				unexcluded.push(path);
			} else if (!exists(path)) {
				vanished.push(path);
			} else {
				throw new Error(`tmutil could not classify ${path}: ${line}`);
			}
		}
	}
	return {unexcluded, vanished};
}

function main() {
	const root = process.argv[2] ?? join(homedir(), 'projects');
	const walked = walkBuildDirs(root);
	const classified = classifyExclusions(walked.dirs);
	for (const path of [...walked.vanished, ...classified.vanished]) {
		process.stderr.write(`vanished mid-scan, skipped: ${path}\n`);
	}
	process.stdout.write(classified.unexcluded.map((path) => `${path}\0`).join(''));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
