// Run: node --test plugins/gtd/scripts/group-build-dirs.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatBuildDirReport, groupBuildDirs, parsePathList} from './group-build-dirs.mjs';

const LIFTWIZARD = '/projects/liftwizard';

test('paths outside a .worktrees directory stay individually listed', () => {
	const paths = ['/projects/app/node_modules', '/projects/app/packages/web/dist'];
	assert.deepStrictEqual(groupBuildDirs(paths), {durable: paths, worktrees: []});
});

test('build dirs inside worktrees collapse to one aggregate per repo', () => {
	const paths = [
		'/projects/app/node_modules',
		`${LIFTWIZARD}/.worktrees/default-8b7ac1b7f/target`,
		`${LIFTWIZARD}/.worktrees/default-8b7ac1b7f/liftwizard-clock/target`,
		`${LIFTWIZARD}/.worktrees/default-96caa988b/target`,
		'/projects/other/.worktrees/feature/node_modules',
	];
	assert.deepStrictEqual(groupBuildDirs(paths), {
		durable: ['/projects/app/node_modules'],
		worktrees: [
			{repo: LIFTWIZARD, worktreeCount: 2, dirCount: 3},
			{repo: '/projects/other', worktreeCount: 1, dirCount: 1},
		],
	});
});

test('a build dir sitting directly under .worktrees has no worktree and stays durable', () => {
	const path = `${LIFTWIZARD}/.worktrees/node_modules`;
	assert.deepStrictEqual(groupBuildDirs([path]), {durable: [path], worktrees: []});
});

test('the outermost .worktrees segment decides the repo', () => {
	const path = `${LIFTWIZARD}/.worktrees/wt-a/nested/.worktrees/wt-b/target`;
	assert.deepStrictEqual(groupBuildDirs([path]), {
		durable: [],
		worktrees: [{repo: LIFTWIZARD, worktreeCount: 1, dirCount: 1}],
	});
});

test('durable paths keep input order and aggregates sort by repo', () => {
	const paths = [
		'/projects/zeta/.worktrees/w/target',
		'/projects/b/dist',
		'/projects/alpha/.worktrees/w/target',
		'/projects/a/dist',
	];
	assert.deepStrictEqual(groupBuildDirs(paths), {
		durable: ['/projects/b/dist', '/projects/a/dist'],
		worktrees: [
			{repo: '/projects/alpha', worktreeCount: 1, dirCount: 1},
			{repo: '/projects/zeta', worktreeCount: 1, dirCount: 1},
		],
	});
});

test('formatBuildDirReport prints durable paths first, then one line per repo', () => {
	const grouped = groupBuildDirs([
		`${LIFTWIZARD}/.worktrees/default-8b7ac1b7f/target`,
		`${LIFTWIZARD}/.worktrees/default-8b7ac1b7f/liftwizard-clock/target`,
		`${LIFTWIZARD}/.worktrees/default-96caa988b/target`,
		'/projects/other/.worktrees/feature/node_modules',
		'/projects/app/node_modules',
	]);
	assert.deepStrictEqual(formatBuildDirReport(grouped), [
		'/projects/app/node_modules',
		`3 build dirs across 2 worktrees under ${LIFTWIZARD}`,
		'1 build dir across 1 worktree under /projects/other',
	]);
});

test('formatBuildDirReport is empty when nothing is unexcluded', () => {
	assert.deepStrictEqual(formatBuildDirReport(groupBuildDirs([])), []);
});

test('parsePathList accepts NUL- and newline-delimited input and drops blanks', () => {
	assert.deepStrictEqual(parsePathList('/a/dist\0/b/target\0'), ['/a/dist', '/b/target']);
	assert.deepStrictEqual(parsePathList('/a/dist\n/b/target\n\n'), ['/a/dist', '/b/target']);
	assert.deepStrictEqual(parsePathList(''), []);
});
