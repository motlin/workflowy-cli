// Run: node --test plugins/gtd/scripts/asap-tiers.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
	bottomTier,
	ladderCapacity,
	parseTierLabel,
	planInsertion,
	planRebalance,
	readLadder,
	tierCapacity,
	tierLabel,
	tiersNeededFor,
} from './asap-tiers.mjs';

const item = (id) => ({id, name: `task ${id}`});
const fill = (tier, n) => ({
	name: tierLabel(tier),
	id: `tier-${tier}`,
	children: Array.from({length: n}, (_, i) => item(`t${tier}-${i}`)),
});

test('tierLabel produces English ordinals', () => {
	assert.deepStrictEqual([1, 2, 3, 4, 5, 11, 12, 13, 21, 22, 23, 101].map(tierLabel), [
		'1st',
		'2nd',
		'3rd',
		'4th',
		'5th',
		'11th',
		'12th',
		'13th',
		'21st',
		'22nd',
		'23rd',
		'101st',
	]);
});

test('parseTierLabel round-trips tier labels and rejects category names', () => {
	assert.strictEqual(parseTierLabel('1st'), 1);
	assert.strictEqual(parseTierLabel('  3rd  '), 3);
	assert.strictEqual(parseTierLabel('💻 Coding'), null);
	assert.strictEqual(parseTierLabel('Administrative'), null);
	assert.strictEqual(parseTierLabel('1th'), null);
	assert.strictEqual(parseTierLabel('0th'), null);
});

/**
 * The whole point of the ladder: each tier holds at most half the tier below it, so capacity is
 * 2^k. These are fixed, never derived from what the tier below currently holds -- a relative cap
 * would push items out of 1st every time something in 2nd got completed, punishing progress.
 */
test('tierCapacity is a fixed power of two per tier', () => {
	assert.deepStrictEqual([1, 2, 3, 4, 5].map(tierCapacity), [2, 4, 8, 16, 32]);
});

test('ladderCapacity sums the tiers and tiersNeededFor inverts it', () => {
	assert.deepStrictEqual([1, 2, 3, 4, 5].map(ladderCapacity), [2, 6, 14, 30, 62]);
	assert.strictEqual(tiersNeededFor(10), 3);
	assert.strictEqual(tiersNeededFor(14), 3);
	assert.strictEqual(tiersNeededFor(15), 4);
	assert.strictEqual(tiersNeededFor(34), 5);
	assert.strictEqual(tiersNeededFor(0), 1);
});

test('readLadder splits tier children from everything else in the bucket', () => {
	const ladder = readLadder({
		id: 'asap-uuid',
		children: [
			fill(1, 2),
			{name: '2nd', id: 'tier-2', children: [item('a'), {id: 'done', name: 'x', completedAt: '2026-08-01'}]},
			{name: '💻 Coding', id: 'cat-coding', children: [item('c1')]},
			item('loose-1'),
		],
	});

	assert.deepStrictEqual(
		ladder.tiers.map((t) => [t.tier, t.label, t.id, t.capacity, t.items.length]),
		[
			[1, '1st', 'tier-1', 2, 2],
			[2, '2nd', 'tier-2', 4, 1],
		],
	);
	assert.deepStrictEqual(
		ladder.unfiled.map((n) => n.id),
		['cat-coding', 'loose-1'],
	);
});

test('readLadder orders tiers by rank regardless of child order', () => {
	const ladder = readLadder({id: 'asap-uuid', children: [fill(3, 0), fill(1, 0), fill(2, 0)]});
	assert.deepStrictEqual(
		ladder.tiers.map((t) => t.tier),
		[1, 2, 3],
	);
});

test('bottomTier is the deepest tier, or null on a bucket with no ladder', () => {
	assert.strictEqual(bottomTier(readLadder({id: 'a', children: [fill(1, 0), fill(2, 0)]})).tier, 2);
	assert.strictEqual(bottomTier(readLadder({id: 'a', children: []})), null);
});

test('planInsertion into a tier with room demotes nothing', () => {
	const ladder = readLadder({id: 'a', children: [fill(1, 1), fill(2, 0)]});
	assert.deepStrictEqual(planInsertion(ladder, 1), {
		targetTier: 1,
		targetId: 'tier-1',
		demotions: [],
		createTiers: [],
	});
});

/**
 * Adding to a full tier is the forcing function: something already there has to give up its slot.
 * The default victim is the tier's bottom-most item, which the walk can override.
 */
test('planInsertion into a full tier demotes its bottom item one tier down', () => {
	const ladder = readLadder({id: 'a', children: [fill(1, 2), fill(2, 1)]});
	assert.deepStrictEqual(planInsertion(ladder, 1), {
		targetTier: 1,
		targetId: 'tier-1',
		demotions: [{nodeId: 't1-1', name: 'task t1-1', fromTier: 1, toTier: 2, toId: 'tier-2'}],
		createTiers: [],
	});
});

test('planInsertion cascades through consecutive full tiers', () => {
	const ladder = readLadder({id: 'a', children: [fill(1, 2), fill(2, 4), fill(3, 3)]});
	assert.deepStrictEqual(planInsertion(ladder, 1).demotions, [
		{nodeId: 't1-1', name: 'task t1-1', fromTier: 1, toTier: 2, toId: 'tier-2'},
		{nodeId: 't2-3', name: 'task t2-3', fromTier: 2, toTier: 3, toId: 'tier-3'},
	]);
});

/**
 * The bottom tier is the landing zone -- undated sweeps and Things Anytime dump into it -- so it
 * absorbs overflow instead of cascading into a tier that does not exist yet. Only tiers with a
 * tier below them are hard-capped.
 */
test('planInsertion lets the bottom tier run over its cap rather than cascading', () => {
	const ladder = readLadder({id: 'a', children: [fill(1, 2), fill(2, 9)]});
	assert.deepStrictEqual(planInsertion(ladder, 2), {
		targetTier: 2,
		targetId: 'tier-2',
		demotions: [],
		createTiers: [],
	});
});

test('planInsertion creates every missing tier down to the target', () => {
	const ladder = readLadder({id: 'a', children: []});
	assert.deepStrictEqual(planInsertion(ladder, 3), {
		targetTier: 3,
		targetId: null,
		demotions: [],
		createTiers: [
			{tier: 1, label: '1st'},
			{tier: 2, label: '2nd'},
			{tier: 3, label: '3rd'},
		],
	});
});

test('planInsertion rejects a target that is not a positive tier rank', () => {
	const ladder = readLadder({id: 'a', children: [fill(1, 0)]});
	assert.throws(() => planInsertion(ladder, 0), /tier rank/);
	assert.throws(() => planInsertion(ladder, 1.5), /tier rank/);
});

/**
 * planRebalance reads a ladder that is already out of shape. The cascade only fires on insertion,
 * so a ladder that drifted over cap needs a separate pass that proposes -- never applies -- the
 * push-downs, pull-ups, and the extension of the bottom tier.
 */
test('planRebalance on a balanced ladder proposes nothing and surfaces tiers 1-2 as the day plan', () => {
	const ladder = readLadder({id: 'a', children: [fill(1, 2), fill(2, 3), fill(3, 5), fill(4, 9)]});
	const plan = planRebalance(ladder);
	assert.deepStrictEqual(plan.pushDowns, []);
	assert.deepStrictEqual(plan.pullUps, []);
	assert.strictEqual(plan.extend, null);
	assert.deepStrictEqual(
		plan.dayPlan.map((t) => [t.tier, t.label, t.id, t.items.map((i) => i.id)]),
		[
			[1, '1st', 'tier-1', ['t1-0', 't1-1']],
			[2, '2nd', 'tier-2', ['t2-0', 't2-1', 't2-2']],
		],
	);
});

/**
 * An over-cap tier lists every occupant and the minimum number that has to leave. It never picks
 * a victim: which items are lowest priority is the user's call, not the bottom-most position.
 */
test('planRebalance lists every occupant of an over-cap tier and the minimum to demote, without choosing', () => {
	const ladder = readLadder({id: 'a', children: [fill(1, 3), fill(2, 6), fill(3, 8), fill(4, 4)]});
	const plan = planRebalance(ladder);
	assert.deepStrictEqual(
		plan.pushDowns.map((p) => [
			p.tier,
			p.label,
			p.id,
			p.count,
			p.capacity,
			p.excess,
			p.toTier,
			p.toId,
			p.items.length,
		]),
		[
			[1, '1st', 'tier-1', 3, 2, 1, 2, 'tier-2', 3],
			[2, '2nd', 'tier-2', 6, 4, 2, 3, 'tier-3', 6],
		],
	);
	assert.deepStrictEqual(
		plan.pushDowns[0].items.map((i) => i.id),
		['t1-0', 't1-1', 't1-2'],
	);
	assert.ok(!('nodeId' in plan.pushDowns[0]), 'no default victim');
	assert.strictEqual(plan.extend, null);
});

/**
 * The bottom tier has no tier below it, so it does not cascade -- it grows. The threshold is exact:
 * 2^k is fine, 2^k + 1 needs a new tier. The user picks which items move into it.
 */
test('planRebalance extends the ladder only when the bottom tier passes 2^k exactly', () => {
	const atCap = planRebalance(readLadder({id: 'a', children: [fill(1, 1), fill(2, 4)]}));
	assert.strictEqual(atCap.extend, null);
	assert.deepStrictEqual(atCap.pushDowns, []);

	const over = planRebalance(readLadder({id: 'a', children: [fill(1, 1), fill(2, 5)]}));
	assert.deepStrictEqual(over.pushDowns, []);
	assert.deepStrictEqual(
		[
			over.extend.tier,
			over.extend.label,
			over.extend.id,
			over.extend.count,
			over.extend.capacity,
			over.extend.newTier,
			over.extend.newLabel,
			over.extend.minimumToMove,
			over.extend.items.length,
		],
		[2, '2nd', 'tier-2', 5, 4, 3, '3rd', 1, 5],
	);
});

test('planRebalance pulls up into an empty 2nd from the tier below it', () => {
	const plan = planRebalance(readLadder({id: 'a', children: [fill(1, 1), fill(2, 0), fill(3, 3)]}));
	assert.deepStrictEqual(
		plan.pullUps.map((p) => [
			p.toTier,
			p.toLabel,
			p.toId,
			p.fromTier,
			p.fromLabel,
			p.fromId,
			p.candidates.map((c) => c.id),
		]),
		[[2, '2nd', 'tier-2', 3, '3rd', 'tier-3', ['t3-0', 't3-1', 't3-2']]],
	);
});

test('planRebalance pulls up into every empty tier of a run, all from the first non-empty tier below', () => {
	const plan = planRebalance(readLadder({id: 'a', children: [fill(1, 0), fill(2, 0), fill(3, 0), fill(4, 2)]}));
	assert.deepStrictEqual(
		plan.pullUps.map((p) => [p.toTier, p.fromTier, p.candidates.length]),
		[
			[2, 4, 2],
			[3, 4, 2],
		],
	);
});

/** Tier 1 is the special case: two things the user would drop everything else for, or nothing. */
test('planRebalance never pulls up into 1st on its own', () => {
	const plan = planRebalance(readLadder({id: 'a', children: [fill(1, 0), fill(2, 3), fill(3, 1)]}));
	assert.deepStrictEqual(plan.pullUps, []);
});

test('planRebalance proposes no pull-up when nothing below the empty tiers can be pulled', () => {
	const plan = planRebalance(readLadder({id: 'a', children: [fill(1, 1), fill(2, 0), fill(3, 0)]}));
	assert.deepStrictEqual(plan.pullUps, []);
});

test('planRebalance treats a missing tier as empty with no id, so the walk knows to create it', () => {
	const plan = planRebalance(readLadder({id: 'a', children: [fill(1, 1), fill(3, 2)]}));
	assert.deepStrictEqual(
		plan.pullUps.map((p) => [p.toTier, p.toId, p.fromTier]),
		[[2, null, 3]],
	);
	assert.deepStrictEqual(
		plan.dayPlan.map((t) => [t.tier, t.id, t.items.length]),
		[
			[1, 'tier-1', 1],
			[2, null, 0],
		],
	);
});

test('planRebalance on a bucket with no ladder proposes nothing', () => {
	assert.deepStrictEqual(planRebalance(readLadder({id: 'a', children: []})), {
		dayPlan: [],
		pushDowns: [],
		pullUps: [],
		extend: null,
	});
});
