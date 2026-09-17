// Run: node --test plugins/gtd/scripts/scan-build-dirs.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {classifyExclusions, walkBuildDirs} from './scan-build-dirs.mjs';

function makeTree(relativeDirs) {
	const root = mkdtempSync(join(tmpdir(), 'scan-build-dirs-'));
	for (const relativeDir of relativeDirs) {
		mkdirSync(join(root, relativeDir), {recursive: true});
	}
	return root;
}

function errorWithCode(code, path) {
	return Object.assign(new Error(`${code}: ${path}`), {code});
}

test('the walk lists build dirs and prunes below each match', () => {
	const root = makeTree(['app/node_modules/pkg/dist', 'app/src', 'lib/target/classes', 'lib/docs/build']);
	try {
		assert.deepStrictEqual(walkBuildDirs(root), {
			dirs: [join(root, 'app/node_modules'), join(root, 'lib/docs/build'), join(root, 'lib/target')],
			vanished: [],
		});
	} finally {
		rmSync(root, {recursive: true});
	}
});

test('a directory that vanishes mid-walk is pruned and the rest of the walk continues', () => {
	const root = makeTree(['liftwizard/.git/rebase-merge', 'liftwizard/target', 'other/dist']);
	const vanishing = join(root, 'liftwizard/.git/rebase-merge');
	const readdir = (directory, options) => {
		if (directory === vanishing) {
			throw errorWithCode('ENOENT', directory);
		}
		return readdirSync(directory, options);
	};
	try {
		assert.deepStrictEqual(walkBuildDirs(root, {readdir}), {
			dirs: [join(root, 'liftwizard/target'), join(root, 'other/dist')],
			vanished: [vanishing],
		});
	} finally {
		rmSync(root, {recursive: true});
	}
});

test('a non-transient read failure aborts the walk', () => {
	const root = makeTree(['locked/src', 'other/dist']);
	const locked = join(root, 'locked');
	const readdir = (directory, options) => {
		if (directory === locked) {
			throw errorWithCode('EACCES', directory);
		}
		return readdirSync(directory, options);
	};
	try {
		assert.throws(() => walkBuildDirs(root, {readdir}), {code: 'EACCES'});
	} finally {
		rmSync(root, {recursive: true});
	}
});

test('a missing scan root is a real failure, not a vanished directory', () => {
	assert.throws(() => walkBuildDirs('/nonexistent/scan-build-dirs-root'), {code: 'ENOENT'});
});

test('classification keeps only included paths', () => {
	const paths = ['/projects/app/node_modules', '/projects/app/dist'];
	const runTmutil = () => '[Excluded]  /projects/app/node_modules\n[Included]  /projects/app/dist\n';
	assert.deepStrictEqual(classifyExclusions(paths, {runTmutil, exists: () => true}), {
		unexcluded: ['/projects/app/dist'],
		vanished: [],
	});
});

test('a build dir that vanished before tmutil saw it is reported as vanished', () => {
	const paths = ['/projects/app/node_modules', '/projects/app/dist'];
	const runTmutil = () => '[UNKNOWN]   /projects/app/node_modules\n[Included]  /projects/app/dist\n';
	assert.deepStrictEqual(
		classifyExclusions(paths, {runTmutil, exists: (path) => path !== '/projects/app/node_modules'}),
		{unexcluded: ['/projects/app/dist'], vanished: ['/projects/app/node_modules']},
	);
});

test('an unknown status for a path that still exists is a real tmutil failure', () => {
	const runTmutil = () => '[UNKNOWN]   /projects/app/dist\n';
	assert.throws(
		() => classifyExclusions(['/projects/app/dist'], {runTmutil, exists: () => true}),
		/tmutil could not classify \/projects\/app\/dist/,
	);
});

test('a tmutil reply with the wrong number of lines is a real failure', () => {
	const runTmutil = () => '[Included]  /projects/app/dist\n';
	assert.throws(
		() => classifyExclusions(['/projects/app/dist', '/projects/app/build'], {runTmutil, exists: () => true}),
		/tmutil returned 1 lines for 2 paths/,
	);
});

test('a tmutil crash propagates', () => {
	const runTmutil = () => {
		throw new Error('tmutil exited 1');
	};
	assert.throws(() => classifyExclusions(['/projects/app/dist'], {runTmutil, exists: () => true}), /tmutil exited 1/);
});

test('paths are sent to tmutil in batches', () => {
	const paths = Array.from({length: 5}, (_, index) => `/projects/app${index}/dist`);
	const batchSizes = [];
	const runTmutil = (batch) => {
		batchSizes.push(batch.length);
		return batch.map((path) => `[Included]  ${path}\n`).join('');
	};
	assert.deepStrictEqual(classifyExclusions(paths, {runTmutil, exists: () => true, batchSize: 2}), {
		unexcluded: paths,
		vanished: [],
	});
	assert.deepStrictEqual(batchSizes, [2, 2, 1]);
});

test('no paths means no tmutil call', () => {
	const runTmutil = () => {
		throw new Error('should not run');
	};
	assert.deepStrictEqual(classifyExclusions([], {runTmutil, exists: () => true}), {unexcluded: [], vanished: []});
});
