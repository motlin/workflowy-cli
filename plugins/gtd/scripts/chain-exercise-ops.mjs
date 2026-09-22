#!/usr/bin/env node
// Chain refine-exercise proposals off the refine-journal proposals staged for the same entries.
//
// Both preps read the same live text, but the journal walk runs first. When the user accepts a
// journal proposal the entry's name becomes the journal `after`, so an exercise op guarded with
// `--expect-name <live text>` would stale-skip. Prep therefore stages two ops for an overlapping
// entry: the proposal's own `applyOps` (fallback, keyed on the live text) and `chained.applyOps`
// (keyed on the journal `after`). Apply resolves which one to run from the entry's current name.
//
// Usage:
//   node chain-exercise-ops.mjs validate <refine-exercise.json> <refine-journal.json>
//   node chain-exercise-ops.mjs resolve <refine-exercise.json> > <resolved.json>

import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const hasUnguardedNameOp = (op) => op.includes('--name') && !op.includes('--expect-name');

export const validateExerciseChain = (exercise, journal) => {
	const journalAfter = new Map((journal.proposals ?? []).map((entry) => [entry.nodeId, entry.after]));
	const errors = [];

	for (const [index, entry] of (exercise.proposals ?? []).entries()) {
		const {chained} = entry;
		if (journalAfter.has(entry.nodeId) && !chained) {
			errors.push(
				`proposals[${index}]: ${entry.nodeId} is also staged by refine-journal but carries no "chained" op — accepting the journal proposal would stale-skip it`,
			);
			continue;
		}
		if (!chained) {
			continue;
		}
		if (chained.before !== journalAfter.get(entry.nodeId)) {
			errors.push(
				`proposals[${index}]: chained.before does not equal the refine-journal after text for ${entry.nodeId}`,
			);
			continue;
		}
		const opIndex = (chained.applyOps ?? []).findIndex(hasUnguardedNameOp);
		if (opIndex !== -1) {
			errors.push(`proposals[${index}]: chained.applyOps[${opIndex}] updates --name without --expect-name`);
		}
	}

	return {valid: errors.length === 0, errors};
};

// `liveNames` maps nodeId to the entry's current name, read after the journal walk finished.
// A drifted entry keeps the fallback so its --expect-name guard stale-skips it at apply time.
const resolveEntry = (entry, liveNames) => {
	const {chained, ...rest} = entry;
	if (!chained || liveNames[entry.nodeId] !== chained.before) {
		return rest;
	}
	return {...rest, before: chained.before, after: chained.after, applyOps: chained.applyOps};
};

export const resolveExerciseProposals = (exercise, liveNames) => {
	const proposals = (exercise.proposals ?? [])
		.map((entry) => resolveEntry(entry, liveNames))
		.filter((entry) => entry.ambiguity || entry.before !== entry.after);
	const status = exercise.status === 'ready' && proposals.length === 0 ? 'empty' : exercise.status;
	return {...exercise, proposals, status};
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const readLiveName = (nodeId) =>
	JSON.parse(
		execFileSync('./bin/run.js', ['node', 'get', '--id', nodeId, '--json', '--fields', 'name'], {encoding: 'utf8'}),
	).name;

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
	const [command, exercisePath, journalPath] = process.argv.slice(2);
	if (command === 'validate' && exercisePath && journalPath) {
		const {valid, errors} = validateExerciseChain(readJson(exercisePath), readJson(journalPath));
		if (valid) {
			console.log(`✓ ${exercisePath} chains every entry refine-journal also staged`);
		} else {
			console.error(`✗ ${exercisePath} is not chained on ${journalPath}:`);
			for (const error of errors) {
				console.error(`  - ${error}`);
			}
			process.exit(1);
		}
	} else if (command === 'resolve' && exercisePath) {
		const exercise = readJson(exercisePath);
		const liveNames = Object.fromEntries(
			(exercise.proposals ?? [])
				.filter((entry) => entry.chained)
				.map((entry) => [entry.nodeId, readLiveName(entry.nodeId)]),
		);
		console.log(JSON.stringify(resolveExerciseProposals(exercise, liveNames), null, '\t'));
	} else {
		console.error('usage: chain-exercise-ops.mjs validate <refine-exercise.json> <refine-journal.json>');
		console.error('       chain-exercise-ops.mjs resolve <refine-exercise.json>');
		process.exit(2);
	}
}
