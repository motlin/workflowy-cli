#!/usr/bin/env node
// Find the linked git worktrees that hold unexcluded build directories, and remove them on request.
//
// Removing a fully-committed worktree deletes its build output, which beats excluding it from Time
// Machine: the directories stop existing instead of piling up. A linked worktree is any checkout
// whose `.git` is a file pointing into `<repo>/.git/worktrees/<name>`, whether it lives under
// `<repo>/.worktrees/` or in a peer directory such as `~/projects/<repo>-<branch>`. The main checkout
// (a `.git` directory) and submodules (a `.git` file pointing into `.git/modules/`) never qualify.
//
// Removal always runs `git worktree remove` without `--force`, so git itself refuses a worktree with
// modified or untracked files, or a locked one. The branch is kept.
//
// Usage:
//   node scan-build-dirs.mjs | node find-removable-worktrees.mjs
//     Reads NUL- or newline-delimited build-dir paths from stdin and prints JSON:
//     [{path, repo, branch, dirCount, clean}] sorted by path.
//   node find-removable-worktrees.mjs --remove <worktree>...
//     Prints JSON: [{path, removed, error?}].

import {execFileSync} from 'node:child_process';
import {existsSync, lstatSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

const LINKED_GITDIR = /^gitdir: (.*\/\.git\/worktrees\/[^/]+)\s*$/;

function git(cwd, ...args) {
	return execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}

/** The root of the linked worktree containing `path`, or null when the nearest checkout is not one. */
function linkedWorktreeRoot(path) {
	for (let directory = dirname(path); directory !== dirname(directory); directory = dirname(directory)) {
		const dotGit = join(directory, '.git');
		if (!existsSync(dotGit)) continue;
		if (lstatSync(dotGit).isDirectory()) return null;
		return LINKED_GITDIR.test(readFileSync(dotGit, 'utf8')) ? directory : null;
	}
	return null;
}

function mainRepoOf(worktree) {
	return dirname(git(worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
}

function describeWorktree(path, dirCount) {
	return {
		path,
		repo: mainRepoOf(path),
		branch: git(path, 'rev-parse', '--abbrev-ref', 'HEAD'),
		dirCount,
		clean: git(path, 'status', '--porcelain') === '',
	};
}

export function findWorktrees(paths) {
	const dirCounts = new Map();
	for (const path of paths) {
		const root = linkedWorktreeRoot(path);
		if (root !== null) dirCounts.set(root, (dirCounts.get(root) ?? 0) + 1);
	}
	return [...dirCounts.keys()]
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
		.map((root) => describeWorktree(root, dirCounts.get(root)));
}

export function removeWorktrees(worktrees) {
	return worktrees.map((path) => {
		try {
			git(mainRepoOf(path), 'worktree', 'remove', path);
			return {path, removed: true};
		} catch (error) {
			return {path, removed: false, error: String(error.stderr || error.message).trim()};
		}
	});
}

function parsePathList(text) {
	return text
		.split('\0')
		.flatMap((chunk) => chunk.split('\n'))
		.filter((line) => line.length > 0);
}

function main() {
	const [flag, ...rest] = process.argv.slice(2);
	const result = flag === '--remove' ? removeWorktrees(rest) : findWorktrees(parsePathList(readFileSync(0, 'utf8')));
	process.stdout.write(`${JSON.stringify(result, null, '\t')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
