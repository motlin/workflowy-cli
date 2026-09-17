#!/usr/bin/env node
// Group unexcluded build directories for the Time Machine exclusions report.
//
// A repo's `.worktrees/` directory can hold hundreds of Maven `target/` dirs, one per module per
// worktree. Listing each one buries the handful of durable-checkout paths that matter. Build output
// inside a worktree is still regenerable and still gets excluded; only the presentation changes:
// every path under `<repo>/.worktrees/<worktree>/` collapses into one line per repo. Scratch checkouts
// at `<repo>/.llm/conflicts-*/` collapse the same way, into their own line per repo.
//
// Never exclude the `.worktrees` root itself. Worktrees share one Git object database, and a
// worktree with uncommitted changes is exactly the source that needs backing up.
//
// Usage:
//   find ... -print0 | node group-build-dirs.mjs
//
// Reads NUL- or newline-delimited paths from stdin and prints JSON:
//   {"durable": [...], "worktrees": [{repo, worktreeCount, dirCount}],
//    "conflicts": [{repo, checkoutCount, dirCount}], "report": [...]}

import {readFileSync} from 'node:fs';

const WORKTREES_SEGMENT = '.worktrees';
const LLM_SEGMENT = '.llm';
const CONFLICTS_PREFIX = 'conflicts-';

/** The checkout kind marked by the segment pair `<marker>/<name>`, or null when the pair marks no checkout. */
function checkoutKind(marker, name) {
	if (marker === WORKTREES_SEGMENT) return 'worktrees';
	if (marker === LLM_SEGMENT && name.startsWith(CONFLICTS_PREFIX)) return 'conflicts';
	return null;
}

/**
 * Locate the outermost scratch checkout containing `path`: `<repo>/.worktrees/<name>/` or
 * `<repo>/.llm/conflicts-<name>/`. Returns `{kind, repo, name}`, or null for a durable path.
 */
function checkoutOf(path) {
	const segments = path.split('/');
	// The last segment is the build dir itself, so a checkout needs a segment between it and the marker.
	for (let index = 0; index < segments.length - 2; index += 1) {
		const name = segments[index + 1];
		const kind = checkoutKind(segments[index], name);
		if (kind !== null) return {kind, repo: segments.slice(0, index).join('/'), name};
	}
	return null;
}

function aggregate(byRepo, countKey) {
	return [...byRepo.entries()]
		.map(([repo, {names, dirCount}]) => ({repo, [countKey]: names.size, dirCount}))
		.sort((a, b) => a.repo.localeCompare(b.repo));
}

export function groupBuildDirs(paths) {
	const durable = [];
	const byKind = {worktrees: new Map(), conflicts: new Map()};

	for (const path of paths) {
		const location = checkoutOf(path);
		if (!location) {
			durable.push(path);
			continue;
		}
		const byRepo = byKind[location.kind];
		const entry = byRepo.get(location.repo) ?? {names: new Set(), dirCount: 0};
		entry.names.add(location.name);
		entry.dirCount += 1;
		byRepo.set(location.repo, entry);
	}

	return {
		durable,
		worktrees: aggregate(byKind.worktrees, 'worktreeCount'),
		conflicts: aggregate(byKind.conflicts, 'checkoutCount'),
	};
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function formatBuildDirReport({durable, worktrees, conflicts}) {
	return [
		...durable,
		...worktrees.map(
			({repo, worktreeCount, dirCount}) =>
				`${plural(dirCount, 'build dir')} across ${plural(worktreeCount, 'worktree')} under ${repo}`,
		),
		...conflicts.map(
			({repo, checkoutCount, dirCount}) =>
				`${plural(dirCount, 'build dir')} across ${plural(checkoutCount, 'conflicts checkout')} under ${repo}/${LLM_SEGMENT}`,
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
