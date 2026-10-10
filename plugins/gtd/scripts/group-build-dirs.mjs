#!/usr/bin/env node
// Group unexcluded build directories for the Time Machine exclusions report.
//
// A repo's `.worktrees/` directory can hold hundreds of Maven `target/` dirs, one per module per
// worktree. Listing each one buries the handful of durable-checkout paths that matter. Build output
// inside a worktree is still regenerable and still gets excluded; only the presentation changes:
// every path under `<repo>/.worktrees/<worktree>/` collapses into one line per repo. Scratch checkouts
// at `<repo>/.llm/conflicts-*/` and `<repo>/.llm/pr-*-repair/`, and Yarn PnP packages at
// `<repo>/.yarn/unplugged/<package>/`, collapse the same way, each kind into its own line per repo.
//
// Never exclude the `.worktrees` root itself. Worktrees share one Git object database, and a
// worktree with uncommitted changes is exactly the source that needs backing up.
//
// Usage:
//   find ... -print0 | node group-build-dirs.mjs
//
// Reads NUL- or newline-delimited paths from stdin and prints JSON:
//   {"durable": [...], "worktrees": [{repo, worktreeCount, dirCount}],
//    "conflicts": [{repo, checkoutCount, dirCount}], "repairs": [{repo, checkoutCount, dirCount}],
//    "unplugged": [{repo, packageCount, dirCount}], "report": [...]}

import {readFileSync} from 'node:fs';

const PR_REPAIR = /^pr-.+-repair$/;

/**
 * Each kind of collapsible location: the segments that mark it under the repo, a test for the
 * segment naming one checkout or package, the count key, and how a report line describes it.
 */
const KINDS = {
	worktrees: {marker: ['.worktrees'], matches: () => true, countKey: 'worktreeCount', noun: 'worktree', under: ''},
	conflicts: {
		marker: ['.llm'],
		matches: (name) => name.startsWith('conflicts-'),
		countKey: 'checkoutCount',
		noun: 'conflicts checkout',
		under: '/.llm',
	},
	repairs: {
		marker: ['.llm'],
		matches: (name) => PR_REPAIR.test(name),
		countKey: 'checkoutCount',
		noun: 'PR repair checkout',
		under: '/.llm',
	},
	unplugged: {
		marker: ['.yarn', 'unplugged'],
		matches: () => true,
		countKey: 'packageCount',
		noun: 'unplugged package',
		under: '/.yarn/unplugged',
	},
};

/** The kind whose marker and name match `segments` at `index`, or null. */
function kindAt(segments, index) {
	for (const [kind, {marker, matches}] of Object.entries(KINDS)) {
		const nameIndex = index + marker.length;
		// The last segment is the build dir itself, so a location needs a named segment before it.
		if (nameIndex >= segments.length - 1) continue;
		if (!marker.every((segment, offset) => segments[index + offset] === segment)) continue;
		if (matches(segments[nameIndex])) return {kind, name: segments[nameIndex]};
	}
	return null;
}

/** The outermost collapsible location containing `path` as `{kind, repo, name}`, or null for a durable path. */
function locationOf(path) {
	const segments = path.split('/');
	for (let index = 0; index < segments.length; index += 1) {
		const match = kindAt(segments, index);
		if (match !== null) return {...match, repo: segments.slice(0, index).join('/')};
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
	const byKind = Object.fromEntries(Object.keys(KINDS).map((kind) => [kind, new Map()]));

	for (const path of paths) {
		const location = locationOf(path);
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
		...Object.fromEntries(
			Object.entries(KINDS).map(([kind, {countKey}]) => [kind, aggregate(byKind[kind], countKey)]),
		),
	};
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function formatBuildDirReport(grouped) {
	return [
		...grouped.durable,
		...Object.entries(KINDS).flatMap(([kind, {countKey, noun, under}]) =>
			grouped[kind].map(
				(entry) =>
					`${plural(entry.dirCount, 'build dir')} across ${plural(entry[countKey], noun)} under ${entry.repo}${under}`,
			),
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
