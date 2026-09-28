// Run: node --test plugins/gtd/scripts/find-removable-worktrees.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findWorktrees, removeWorktrees} from './find-removable-worktrees.mjs';

function git(cwd, ...args) {
	return execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
}

/** A repo at `<root>/app` with one commit and ignored build dirs, plus linked worktrees as requested. */
function makeRepo(worktrees) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'find-removable-worktrees-')));
	const repo = join(root, 'app');
	mkdirSync(repo);
	git(repo, 'init', '--quiet', '--initial-branch=main');
	git(repo, 'config', 'user.email', 'test@example.com');
	git(repo, 'config', 'user.name', 'Test');
	writeFileSync(join(repo, '.gitignore'), 'node_modules/\ntarget/\n');
	git(repo, 'add', '.gitignore');
	git(repo, 'commit', '--quiet', '--message', 'init');
	for (const [branch, path] of worktrees) {
		git(repo, 'worktree', 'add', '--quiet', '-b', branch, join(root, path));
	}
	return {root, repo};
}

test('build dirs in the main checkout are not worktree candidates', () => {
	const {root, repo} = makeRepo([]);
	try {
		mkdirSync(join(repo, 'node_modules'));
		assert.deepStrictEqual(findWorktrees([join(repo, 'node_modules')]), []);
	} finally {
		rmSync(root, {recursive: true});
	}
});

test('linked worktrees in peer dirs and under .worktrees are found with their build-dir counts', () => {
	const {root, repo} = makeRepo([
		['just-format-hooks', 'app-just-format-hooks'],
		['feature', 'app/.worktrees/feature'],
	]);
	const peer = join(root, 'app-just-format-hooks');
	const nested = join(repo, '.worktrees/feature');
	try {
		for (const dir of [`${peer}/node_modules`, `${peer}/lib/target`, `${nested}/target`]) {
			mkdirSync(dir, {recursive: true});
		}
		assert.deepStrictEqual(
			findWorktrees([`${peer}/node_modules`, `${peer}/lib/target`, `${nested}/target`, '/nonexistent/app/dist']),
			[
				{path: peer, repo, branch: 'just-format-hooks', dirCount: 2, clean: true},
				{path: nested, repo, branch: 'feature', dirCount: 1, clean: true},
			],
		);
	} finally {
		rmSync(root, {recursive: true});
	}
});

test('a worktree with untracked or modified files is reported as not clean', () => {
	const {root, repo} = makeRepo([['dirty', 'app-dirty']]);
	const dirty = join(root, 'app-dirty');
	try {
		mkdirSync(join(dirty, 'target'));
		writeFileSync(join(dirty, 'notes.txt'), 'wip\n');
		assert.deepStrictEqual(findWorktrees([join(dirty, 'target')]), [
			{path: dirty, repo, branch: 'dirty', dirCount: 1, clean: false},
		]);
	} finally {
		rmSync(root, {recursive: true});
	}
});

test('removal runs git worktree remove without --force and reports refusals', () => {
	const {root, repo} = makeRepo([
		['clean', 'app-clean'],
		['dirty', 'app-dirty'],
	]);
	const clean = join(root, 'app-clean');
	const dirty = join(root, 'app-dirty');
	try {
		mkdirSync(join(clean, 'node_modules'));
		writeFileSync(join(dirty, 'notes.txt'), 'wip\n');
		const results = removeWorktrees([clean, dirty]);
		assert.deepStrictEqual(
			results.map(({path, removed}) => ({path, removed})),
			[
				{path: clean, removed: true},
				{path: dirty, removed: false},
			],
		);
		assert.match(results[1].error, /contains modified or untracked files/);
		assert.deepStrictEqual([existsSync(clean), existsSync(dirty)], [false, true]);
		assert.match(git(repo, 'branch', '--list', 'clean'), /clean/);
	} finally {
		rmSync(root, {recursive: true});
	}
});
