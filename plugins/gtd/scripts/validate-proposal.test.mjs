// Run: node --test plugins/gtd/scripts/validate-proposal.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateProposal} from './validate-proposal.mjs';

const proposal = (overrides = {}) => ({
	nodeId: '11111111-2222-3333-4444-555555555555',
	header: 'Feb 9',
	before: 'Ran 5k with Gary in the morning',
	after: '🏃 Ran 5k with @FrankWilson in the morning #exercise',
	changes: [{type: 'people', icon: '👤', detail: 'Gary → @FrankWilson'}],
	applyOps: [],
	...overrides,
});

const staged = (overrides = {}) => ({
	task: 'refine-journal',
	generatedAt: '2026-08-03T23:04:41-04:00',
	status: 'ready',
	presentation: 'Refine calendar journal',
	summary: {entriesReviewed: 31},
	proposals: [proposal()],
	...overrides,
});

test('accepts a staged file matching the documented schema', () => {
	assert.deepStrictEqual(validateProposal(staged()), {valid: true, errors: []});
});

test('rejects a per-proposal moveToNodeId, which names a suggestion child and is not a move target', () => {
	const result = validateProposal(
		staged({proposals: [proposal({moveToNodeId: '99999999-8888-7777-6666-555555555555'})]}),
	);

	assert.deepStrictEqual(result, {
		valid: false,
		errors: [
			'proposals[0]: stages a second node id "moveToNodeId" — the 📍 Move to: suggestion child is not a destination parent; resolve destinations by path at apply time',
		],
	});
});

test('rejects any other stray id field, whatever it is called', () => {
	const result = validateProposal(
		staged({proposals: [proposal({destinationParentId: '99999999-8888-7777-6666-555555555555'})]}),
	);

	assert.deepStrictEqual(result, {
		valid: false,
		errors: [
			'proposals[0]: stages a second node id "destinationParentId" — a proposal carries only nodeId; put every other id inside an applyOps command',
		],
	});
});

test('allows inert non-id extension fields such as fingerprint', () => {
	assert.deepStrictEqual(validateProposal(staged({proposals: [proposal({fingerprint: 'abc123', inbox: 'Work'})]})), {
		valid: true,
		errors: [],
	});
});

test('reports every offending proposal, not just the first', () => {
	const result = validateProposal(
		staged({
			proposals: [proposal({moveToNodeId: 'a'}), proposal(), proposal({refinementNodeId: 'b'})],
		}),
	);

	assert.deepStrictEqual(result, {
		valid: false,
		errors: [
			'proposals[0]: stages a second node id "moveToNodeId" — the 📍 Move to: suggestion child is not a destination parent; resolve destinations by path at apply time',
			'proposals[2]: stages a second node id "refinementNodeId" — a proposal carries only nodeId; put every other id inside an applyOps command',
		],
	});
});

test('requires a full uuid nodeId, since short ids 404 on writes', () => {
	const result = validateProposal(staged({proposals: [proposal({nodeId: '1493cca5a53d'})]}));

	assert.deepStrictEqual(result, {
		valid: false,
		errors: ['proposals[0]: nodeId "1493cca5a53d" is not a full uuid'],
	});
});

test('requires --expect-name on every name update op', () => {
	const result = validateProposal(
		staged({
			proposals: [
				proposal({
					applyOps: ["./bin/run.js node update --id 11111111-2222-3333-4444-555555555555 --name 'new text'"],
				}),
			],
		}),
	);

	assert.deepStrictEqual(result, {
		valid: false,
		errors: ['proposals[0]: applyOps[0] updates --name without --expect-name'],
	});
});

test('accepts a name update op carrying --expect-name', () => {
	const result = validateProposal(
		staged({
			proposals: [
				proposal({
					applyOps: [
						"./bin/run.js node update --id 11111111-2222-3333-4444-555555555555 --name 'new' --expect-name 'old'",
					],
				}),
			],
		}),
	);

	assert.deepStrictEqual(result, {valid: true, errors: []});
});

test('requires proposals[] to be empty unless status is ready', () => {
	const result = validateProposal(staged({status: 'empty'}));

	assert.deepStrictEqual(result, {
		valid: false,
		errors: ['status "empty" must carry an empty proposals[] array'],
	});
});

test('accepts an empty status with no proposals', () => {
	assert.deepStrictEqual(validateProposal(staged({status: 'empty', proposals: []})), {valid: true, errors: []});
});

test('rejects an unknown status', () => {
	const result = validateProposal(staged({status: 'done', proposals: []}));

	assert.deepStrictEqual(result, {valid: false, errors: ['unknown status "done"']});
});

test('reports missing required top-level fields', () => {
	const result = validateProposal({status: 'empty', proposals: []});

	assert.deepStrictEqual(result, {
		valid: false,
		errors: ['missing required field "task"', 'missing required field "generatedAt"'],
	});
});

const emailCalendarProposal = (overrides = {}) => ({
	header: 'Sep 25',
	key: 'alice-imap-uid-12345-sep25',
	altKeys: ['Book club dinner | 2026-09-25'],
	before: 'Unread email offering registration for a dinner on Sep 25',
	after: '🍽️ Book club dinner — Fri Sep 25 2026',
	changes: [{type: 'category', icon: '🏷️', detail: 'New calendar event from unread email'}],
	...overrides,
});

const emailCalendarStaged = (overrides = {}) =>
	staged({
		task: 'email-calendar',
		presentation: 'Scan email for events',
		proposals: [emailCalendarProposal()],
		...overrides,
	});

test('accepts an email-calendar proposal carrying a ledger key', () => {
	assert.deepStrictEqual(validateProposal(emailCalendarStaged()), {valid: true, errors: []});
});

test('rejects an email-calendar proposal with no ledger key, since a null key suppresses nothing', () => {
	const {key: _key, ...withoutKey} = emailCalendarProposal();
	const result = validateProposal(emailCalendarStaged({proposals: [withoutKey]}));

	assert.deepStrictEqual(result, {
		valid: false,
		errors: [
			'proposals[0]: email-calendar proposal has no ledger "key" — apply writes it to email-calendar-decisions.json, and a null key never suppresses a re-proposal',
		],
	});
});

test('rejects an email-calendar proposal whose ledger key is null or blank', () => {
	const result = validateProposal(
		emailCalendarStaged({
			proposals: [emailCalendarProposal({key: null}), emailCalendarProposal({key: '   '})],
		}),
	);

	assert.deepStrictEqual(result, {
		valid: false,
		errors: [
			'proposals[0]: email-calendar proposal has no ledger "key" — apply writes it to email-calendar-decisions.json, and a null key never suppresses a re-proposal',
			'proposals[1]: email-calendar proposal has no ledger "key" — apply writes it to email-calendar-decisions.json, and a null key never suppresses a re-proposal',
		],
	});
});

test('names the sourceKey mismatch when prep staged the identity under the old field', () => {
	const {key: _key, ...withoutKey} = emailCalendarProposal();
	const result = validateProposal(
		emailCalendarStaged({proposals: [{...withoutKey, sourceKey: 'alice-imap-uid-12345-sep25'}]}),
	);

	assert.deepStrictEqual(result, {
		valid: false,
		errors: [
			'proposals[0]: email-calendar proposal stages its ledger key as "sourceKey" — the ledger and apply read "key"; rename it',
		],
	});
});

test('does not require a ledger key on other tasks', () => {
	assert.deepStrictEqual(validateProposal(staged()), {valid: true, errors: []});
});
