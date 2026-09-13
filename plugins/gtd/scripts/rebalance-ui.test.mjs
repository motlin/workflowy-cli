// Run: node --test plugins/gtd/scripts/rebalance-ui.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildLadderModel, diffSubmission, renderPage} from './rebalance-ui.mjs';

const bucket = (id, tiers) => ({
	id,
	name: '📌 Tasks (asap) (work)',
	children: tiers.map(([label, items]) => ({
		name: label,
		id: `${id}-${label}`,
		children: items.map((n) => ({id: `${n}-id`, shortId: n, name: n, completedAt: null})),
	})),
});

test('buildLadderModel carries every tier with its 2^k capacity', () => {
	const model = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b', 'c']],
		]),
	);
	assert.equal(model.root, 'work');
	assert.equal(model.bucketId, 'w');
	assert.deepStrictEqual(
		model.tiers.map((t) => [t.label, t.capacity, t.items.length]),
		[
			['1st', 2, 1],
			['2nd', 4, 2],
		],
	);
});

test('an empty tier survives into the model rather than being dropped', () => {
	const model = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', []],
			['3rd', ['b']],
		]),
	);
	const second = model.tiers.find((t) => t.label === '2nd');
	assert.ok(second, 'the empty 2nd tier must be present');
	assert.deepStrictEqual(second.items, []);
});

test('renderPage emits a single continuous list, not one box per tier', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a']],
				['2nd', []],
			]),
		),
	]);
	assert.match(html, /class="ladder-list"/, 'one continuous list container per ladder');
	assert.ok(!/class="tier-box"/.test(html), 'tiers must be dividers inside the list, not separate boxes');
	assert.match(html, /data-tier-boundary="2"/, 'tier boundaries are rendered inside the list');
});

test('every tier band is a drop target with a minimum height, empty ones included', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a']],
				['2nd', []],
			]),
		),
	]);
	assert.match(html, /--tier-min-drop-height/, 'a minimum drop-zone height must be defined');
	assert.match(html, /empty — drop here/, 'an empty tier renders explicit empty-state text');
	const span = html.slice(html.indexOf('data-tier-span="2"'));
	assert.match(span.slice(0, 400), /data-drop-target="true"/, 'the empty tier span is still a drop target');
});

test('diffSubmission emits creates for new tiers before the moves into them', () => {
	const model = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b', 'c']],
		]),
	);
	const ops = diffSubmission([model], {
		roots: {
			work: {
				bucketId: 'w',
				tiers: [
					{tier: 1, label: '1st', id: 'w-1st', isNew: false, items: ['a-id']},
					{tier: 2, label: '2nd', id: 'w-2nd', isNew: false, items: ['b-id']},
					{tier: 3, label: '3rd', id: null, isNew: true, items: ['c-id']},
				],
			},
		},
	});
	assert.equal(ops[0].op, 'create');
	assert.equal(ops[0].label, '3rd');
	assert.deepStrictEqual(
		ops.slice(1).map((o) => [o.op, o.nodeId, o.toLabel]),
		[['move', 'c-id', '3rd']],
	);
});

test('diffSubmission reports only items that actually changed tier', () => {
	const model = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b']],
		]),
	);
	const ops = diffSubmission([model], {
		roots: {
			work: {
				bucketId: 'w',
				tiers: [
					{tier: 1, label: '1st', id: 'w-1st', isNew: false, items: ['a-id']},
					{tier: 2, label: '2nd', id: 'w-2nd', isNew: false, items: ['b-id']},
				],
			},
		},
	});
	assert.deepStrictEqual(ops, []);
});

test('each ladder carries its own tier ids, so two ladders never share a destination', () => {
	const work = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b']],
		]),
	);
	const personal = buildLadderModel(
		'personal',
		bucket('p', [
			['1st', ['c']],
			['2nd', ['d']],
		]),
	);
	const html = renderPage([work, personal]);
	assert.match(html, /data-tier-id="w-1st"/, "work's 1st tier id must be in the markup");
	assert.match(html, /data-tier-id="p-1st"/, "personal's 1st tier id must be in the markup");
	const personalSection = html.slice(html.indexOf('data-root="personal"'));
	assert.ok(!personalSection.includes('data-tier-id="w-'), 'the personal ladder must not carry work tier ids');
});

test('rows carry a stable index so a shift-click range can be computed', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a', 'b']],
				['2nd', ['c']],
			]),
		),
	]);
	assert.match(html, /data-row-index="0"/, 'rows must be indexed for range selection');
	assert.match(html, /data-row-index="2"/, 'indices run across tier boundaries, not per tier');
});

test('the page selects with click and extends with shift-click, not with checkboxes', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a']],
				['2nd', ['b']],
			]),
		),
	]);
	assert.match(html, /shiftKey/, 'shift-click range selection must be wired');
	assert.ok(!/type="checkbox"|type="radio"/.test(html), 'no per-row checkbox or radio circles');
});

test('dragging a selected row carries every selected row as one block', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a', 'b']],
				['2nd', []],
			]),
		),
	]);
	assert.match(html, /selectedRows|carrySelection/, 'drag must move the whole selection, not just the grabbed row');
});

test('every mutation autosaves, so there is no Submit button to forget', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a']],
				['2nd', []],
			]),
		),
	]);
	assert.match(html, /autosave/i, 'the page must save on each change');
	assert.ok(!/id="submit"/.test(html), 'an explicit Submit button must not gate saving');
});

test('each tier region is painted by capacity state, not just labelled with text', () => {
	const html = renderPage([
		buildLadderModel(
			'w1',
			bucket('w', [
				['1st', ['a']],
				['2nd', ['b', 'c', 'd', 'e', 'f']],
			]),
		),
	]);
	assert.match(html, /--over-bg/, 'an over-cap state colour must be defined');
	assert.match(html, /--room-bg/, 'an under-cap state colour must be defined');
	assert.match(html, /--exact-bg/, 'an at-cap state colour must be defined');
	assert.match(
		html,
		/class="span [a-z]+"|data-state="(room|exact|over)"/,
		'the span itself carries its capacity state',
	);
});

test('an over-cap tier is marked over and an under-cap tier is marked room', () => {
	// 1st holds 1 of 2 (room); 2nd holds 5 of 4 (over)
	const html = renderPage([
		buildLadderModel(
			'w2',
			bucket('w', [
				['1st', ['a']],
				['2nd', ['b', 'c', 'd', 'e', 'f']],
			]),
		),
	]);
	// slice from each tier's BOUNDARY, since data-state precedes data-tier-span on the span
	const first = html.slice(html.indexOf('data-tier-boundary="1"'), html.indexOf('data-tier-boundary="2"'));
	const second = html.slice(html.indexOf('data-tier-boundary="2"'));
	assert.match(first, /data-state="room"/, '1st is under cap');
	assert.match(second, /data-state="over"/, '2nd is over cap');
});

test('a tier with room shows its free slots so the gap is visible, not inferred', () => {
	const html = renderPage([
		buildLadderModel(
			'w3',
			bucket('w', [
				['1st', ['a']],
				['2nd', []],
			]),
		),
	]);
	assert.match(html, /class="slot"/, 'free capacity renders as empty slots');
});

test('rows past the cap are marked so you can see which ones must leave', () => {
	const html = renderPage([
		buildLadderModel(
			'w4',
			bucket('w', [
				['1st', ['a']],
				['2nd', ['b', 'c', 'd', 'e', 'f']],
			]),
		),
	]);
	assert.match(html, /row excess|class="row[^"]*excess/, 'the overflowing rows carry an excess marker');
});

test('a legend explains the three capacity states', () => {
	const html = renderPage([buildLadderModel('w5', bucket('w', [['1st', ['a']]]))]);
	assert.match(html, /class="legend"/, 'the page carries a legend');
});

test('the draft key is bound to the ladder shape, so a stale draft cannot rearrange a new page', () => {
	const sixTiers = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b']],
			['3rd', ['c']],
			['4th', ['d']],
			['5th', ['e']],
			['6th', ['f']],
		]),
	);
	const sevenTiers = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b']],
			['3rd', ['c']],
			['4th', ['d']],
			['5th', ['e']],
			['6th', ['f']],
			['7th', ['g']],
		]),
	);
	// the key is derived at runtime from PAGE_SIGNATURE, so compare that
	const keyOf = (html) => html.match(/const PAGE_SIGNATURE = "([^"]+)"/)[1];
	const six = keyOf(renderPage([sixTiers]));
	const seven = keyOf(renderPage([sevenTiers]));
	assert.notEqual(six, seven, 'adding a tier must invalidate the previous draft, not silently replay it');
});

test('a draft whose rows no longer match the page is ignored rather than applied', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a']],
				['2nd', ['b']],
			]),
		),
	]);
	assert.match(
		html,
		/draftMatchesPage|draft\.signature/,
		'the restore path must validate the draft before applying it',
	);
});
