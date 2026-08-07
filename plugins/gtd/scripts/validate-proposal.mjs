#!/usr/bin/env node
// Validate a staged daily-review proposal file against the contract in
// plugins/gtd/skills/review-proposal-staging.md.
//
// Usage: node plugins/gtd/scripts/validate-proposal.mjs .llm/gtd/review/proposals/<slug>.json

import {readFileSync} from 'node:fs';

const REQUIRED_TOP_LEVEL = ['task', 'generatedAt', 'status'];
const KNOWN_STATUSES = ['ready', 'needs-interactive', 'empty', 'error'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A proposal stages exactly one node id: `nodeId`, the node its applyOps mutate. Every other id
// belongs inside an applyOps command string, already bound to its flag. A second bare id field is
// the bug this guards: a consumer reads it as a write target and moves the item under the wrong
// parent. Inert fields (counts, labels, fingerprints) are free to vary per task.
const ID_FIELD = /(?:^|[a-z])(?:Id|ID)$/;
const DEFAULT_ID_HINT = 'a proposal carries only nodeId; put every other id inside an applyOps command';
const ID_HINTS = {
	moveToNodeId:
		'the 📍 Move to: suggestion child is not a destination parent; resolve destinations by path at apply time',
};

const strayIdError = (index, field) =>
	`proposals[${index}]: stages a second node id "${field}" — ${ID_HINTS[field] ?? DEFAULT_ID_HINT}`;

const validateProposalEntry = (entry, index, errors) => {
	for (const field of Object.keys(entry)) {
		if (field !== 'nodeId' && ID_FIELD.test(field)) {
			errors.push(strayIdError(index, field));
			return;
		}
	}

	if (typeof entry.nodeId === 'string' && !UUID.test(entry.nodeId)) {
		errors.push(`proposals[${index}]: nodeId "${entry.nodeId}" is not a full uuid`);
		return;
	}

	const ops = Array.isArray(entry.applyOps) ? entry.applyOps : [];
	for (const [opIndex, op] of ops.entries()) {
		if (op.includes('--name') && !op.includes('--expect-name')) {
			errors.push(`proposals[${index}]: applyOps[${opIndex}] updates --name without --expect-name`);
			return;
		}
	}
};

export const validateProposal = (staged) => {
	const errors = [];

	for (const field of REQUIRED_TOP_LEVEL) {
		if (staged[field] === undefined) {
			errors.push(`missing required field "${field}"`);
		}
	}

	if (staged.status !== undefined && !KNOWN_STATUSES.includes(staged.status)) {
		errors.push(`unknown status "${staged.status}"`);
		return {valid: false, errors};
	}

	const proposals = Array.isArray(staged.proposals) ? staged.proposals : [];
	if (staged.status !== 'ready' && proposals.length > 0) {
		errors.push(`status "${staged.status}" must carry an empty proposals[] array`);
		return {valid: false, errors};
	}

	for (const [index, entry] of proposals.entries()) {
		validateProposalEntry(entry, index, errors);
	}

	return {valid: errors.length === 0, errors};
};

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
	const path = process.argv[2];
	if (!path) {
		console.error('usage: validate-proposal.mjs <staged-proposal.json>');
		process.exit(2);
	}

	const {valid, errors} = validateProposal(JSON.parse(readFileSync(path, 'utf8')));
	if (valid) {
		console.log(`✓ ${path} matches the staging contract`);
	} else {
		console.error(`✗ ${path} violates the staging contract:`);
		for (const error of errors) {
			console.error(`  - ${error}`);
		}
		process.exit(1);
	}
}
