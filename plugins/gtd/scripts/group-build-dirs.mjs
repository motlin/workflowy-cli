#!/usr/bin/env node
// Group unexcluded build directories for the Time Machine exclusions report.
//
// A repo's `.worktrees/` directory can hold hundreds of Maven `target/` dirs, one per module per
// worktree. Listing each one buries the handful of durable-checkout paths that matter. Build output
// inside a worktree is still regenerable and still gets excluded; only the presentation changes:
// every path under `<repo>/.worktrees/<worktree>/` collapses into one line per repo.
//
// Never exclude the `.worktrees` root itself. Worktrees share one Git object database, and a
// worktree with uncommitted changes is exactly the source that needs backing up.
//
// Usage:
//   find ... -print0 | node group-build-dirs.mjs
//
// Reads NUL- or newline-delimited paths from stdin and prints JSON:
//   {"durable": [...], "worktrees": [{repo, worktreeCount, dirCount}], "report": [...]}

import {readFileSync} from 'node:fs';

const WORKTREES_SEGMENT = '.worktrees';

/** Split `path` into `{repo, worktree}` when it lies inside `<repo>/.worktrees/<worktree>/`. */
function worktreeOf(path) {
	const segments = path.split('/');
	const index = segments.indexOf(WORKTREES_SEGMENT);
	// The last segment is the build dir itself, so a worktree needs a segment between it and `.worktrees`.
	if (index === -1 || index >= segments.length - 2) return null;
	return {repo: segments.slice(0, index).join('/'), worktree: segments[index + 1]};
}

export function groupBuildDirs(paths) {
	const durable = [];
	const byRepo = new Map();

	for (const path of paths) {
		const location = worktreeOf(path);
		if (!location) {
			durable.push(path);
			continue;
		}
		const entry = byRepo.get(location.repo) ?? {worktrees: new Set(), dirCount: 0};
		entry.worktrees.add(location.worktree);
		entry.dirCount += 1;
		byRepo.set(location.repo, entry);
	}

	const worktrees = [...byRepo.entries()]
		.map(([repo, {worktrees: names, dirCount}]) => ({repo, worktreeCount: names.size, dirCount}))
		.sort((a, b) => a.repo.localeCompare(b.repo));

	return {durable, worktrees};
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function formatBuildDirReport({durable, worktrees}) {
	return [
		...durable,
		...worktrees.map(
			({repo, worktreeCount, dirCount}) =>
				`${plural(dirCount, 'build dir')} across ${plural(worktreeCount, 'worktree')} under ${repo}`,
		),
	];
}

export function parsePathList(text) {
	return text
		.split('\0')
		.flatMap((chunk) => chunk.split('\n'))
		.filter((line) => line.length > 0);
}

function main() {
	const grouped = groupBuildDirs(parsePathList(readFileSync(0, 'utf8')));
	process.stdout.write(`${JSON.stringify({...grouped, report: formatBuildDirReport(grouped)}, null, '\t')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
