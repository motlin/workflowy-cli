// The priority ladder inside a 📌 Tasks (asap) bucket: ordinal tiers with a halving capacity.
//
// The asap buckets used to be split by category (Coding, Administrative, Docs to write, …). A
// category tells you what a task is, never whether to do it before the other thirty things in the
// bucket, so the buckets grew without bound. Tiers replace categories: the bucket's children are
// `1st`, `2nd`, `3rd`, … and each tier holds at most half of the tier below it -- 2, 4, 8, 16, 32.
// What a task *is* moves onto the task text as a #tag, where it can be searched and combined.
//
// Two rules make the ladder work, and both are easy to get subtly wrong by hand:
//
//   Fixed caps, not relative ones. A cap computed from what the tier below currently holds is
//   unstable from the bottom -- completing two items in 2nd would retroactively force an item out
//   of 1st, punishing progress. 2^k only ever pushes down when something is added at the top,
//   which is the forcing function the ladder exists for.
//
//   The bottom tier is the landing zone. Undated sweeps out of the ⏰ bucket and undated Things
//   Anytime tasks arrive there in bulk, so it absorbs overflow instead of cascading into a tier
//   that does not exist yet. Every tier that has a tier below it is hard-capped; the deepest one
//   runs over until a rebalance extends the ladder.
//
// The cascade in planInsertion only fires when something is *inserted* into a full tier, so a
// ladder that has drifted out of shape stays that way until planRebalance reads it. That report is
// proposals only: which items leave an over-cap tier is the user's judgment, never a position.

import {readFileSync} from 'node:fs';

const ORDINAL_SUFFIX = {1: 'st', 2: 'nd', 3: 'rd'};

function assertTierRank(tier) {
	if (!Number.isInteger(tier) || tier < 1) throw new Error(`not a tier rank: ${tier}`);
}

export function tierLabel(tier) {
	assertTierRank(tier);
	// 11th/12th/13th are the exceptions every naive ordinal formatter gets wrong.
	const teen = tier % 100 >= 11 && tier % 100 <= 13;
	const suffix = teen ? 'th' : (ORDINAL_SUFFIX[tier % 10] ?? 'th');
	return `${tier}${suffix}`;
}

export function parseTierLabel(name) {
	const match = /^(\d+)(st|nd|rd|th)$/.exec(String(name ?? '').trim());
	if (!match) return null;
	const tier = Number(match[1]);
	// Reject `1th` and `3nd`: a mistyped label is a category node, not a tier.
	return tier >= 1 && tierLabel(tier) === match[0] ? tier : null;
}

export function tierCapacity(tier) {
	assertTierRank(tier);
	return 2 ** tier;
}

/** Total capacity of a ladder `tiers` deep: 2 + 4 + … + 2^tiers. */
export function ladderCapacity(tiers) {
	assertTierRank(tiers);
	return 2 ** (tiers + 1) - 2;
}

/** How deep a ladder has to be to hold `count` tasks. Used once, when migrating a bucket. */
export function tiersNeededFor(count) {
	let tiers = 1;
	while (ladderCapacity(tiers) < count) tiers += 1;
	return tiers;
}

/**
 * Split a 📌 bucket's children into the tier ladder and everything else. `unfiled` holds both
 * loose tasks and pre-migration category containers -- telling those two apart is the migration's
 * job, not this function's.
 */
export function readLadder(bucket) {
	const tiers = [];
	const unfiled = [];

	for (const child of bucket?.children ?? []) {
		const tier = parseTierLabel(child.name);
		if (tier === null) {
			unfiled.push(child);
			continue;
		}
		tiers.push({
			tier,
			label: tierLabel(tier),
			id: child.id,
			capacity: tierCapacity(tier),
			items: (child.children ?? []).filter((node) => !node.completedAt),
		});
	}

	tiers.sort((a, b) => a.tier - b.tier);
	return {bucketId: bucket?.id ?? null, tiers, unfiled};
}

export function bottomTier(ladder) {
	return ladder.tiers.at(-1) ?? null;
}

/**
 * Plan what has to happen for one task to land in `targetTier`: which tiers to create first, and
 * which already-filed tasks get bumped down to make room. Returns a plan rather than commands so
 * the walk can show the cascade and let the user pick a different item to demote.
 */
export function planInsertion(ladder, targetTier) {
	assertTierRank(targetTier);

	const byTier = new Map(ladder.tiers.map((t) => [t.tier, t]));
	const deepest = bottomTier(ladder)?.tier ?? 0;
	const demotions = [];

	// The deepest tier absorbs overflow rather than cascading, so it bounds the walk.
	for (let tier = targetTier; tier < deepest; tier++) {
		const existing = byTier.get(tier);
		// A tier that does not exist yet is empty, so nothing in it has to give up a slot.
		if (!existing || existing.items.length < existing.capacity) break;
		const victim = existing.items.at(-1);
		demotions.push({
			nodeId: victim.id,
			name: victim.name,
			fromTier: tier,
			toTier: tier + 1,
			toId: byTier.get(tier + 1)?.id ?? null,
		});
	}

	// Never leave a hole in the ladder: a `3rd` with no `1st` above it reads as a broken migration.
	const createTiers = [];
	for (let tier = 1; tier <= targetTier; tier++) {
		if (!byTier.has(tier)) createTiers.push({tier, label: tierLabel(tier)});
	}

	return {targetTier, targetId: byTier.get(targetTier)?.id ?? null, demotions, createTiers};
}

/**
 * Read a ladder that may already be out of shape and report what a rebalance would propose. Every
 * entry is a proposal for the user to confirm; nothing here picks an item. Tiers are numbered
 * 1..deepest, and a tier missing from the bucket counts as empty with `id: null`.
 *
 *   dayPlan   -- tiers 1 and 2, the goals for the day.
 *   pushDowns -- each capped (non-bottom) tier over 2^k, with every occupant and the minimum
 *                number that has to move to the tier below.
 *   pullUps   -- the run of empty tiers starting at 2nd, each to be fed from the first non-empty
 *                tier below the run. 1st is never a pull-up target: it is two things the user
 *                would drop everything else for, or nothing.
 *   extend    -- the bottom tier once it passes 2^k (exactly 2^k + 1 triggers it): a new tier to
 *                create, with every occupant so the user can say which ones move into it.
 */
export function planRebalance(ladder) {
	const byTier = new Map(ladder.tiers.map((t) => [t.tier, t]));
	const deepest = bottomTier(ladder)?.tier ?? 0;
	const tierAt = (tier) =>
		byTier.get(tier) ?? {tier, label: tierLabel(tier), id: null, capacity: tierCapacity(tier), items: []};

	const dayPlan = [];
	for (let tier = 1; tier <= Math.min(2, deepest); tier++) {
		const {label, id, items} = tierAt(tier);
		dayPlan.push({tier, label, id, items});
	}

	const pushDowns = [];
	for (let tier = 1; tier < deepest; tier++) {
		const {label, id, capacity, items} = tierAt(tier);
		if (items.length <= capacity) continue;
		pushDowns.push({
			tier,
			label,
			id,
			count: items.length,
			capacity,
			excess: items.length - capacity,
			toTier: tier + 1,
			toId: tierAt(tier + 1).id,
			items,
		});
	}

	const pullUps = [];
	if (deepest >= 2 && tierAt(2).items.length === 0) {
		let source = 2;
		while (source <= deepest && tierAt(source).items.length === 0) source += 1;
		if (source <= deepest) {
			const from = tierAt(source);
			for (let tier = 2; tier < source; tier++) {
				const to = tierAt(tier);
				pullUps.push({
					toTier: tier,
					toLabel: to.label,
					toId: to.id,
					fromTier: from.tier,
					fromLabel: from.label,
					fromId: from.id,
					candidates: from.items,
				});
			}
		}
	}

	let extend = null;
	const bottom = bottomTier(ladder);
	if (bottom && bottom.items.length > bottom.capacity) {
		extend = {
			tier: bottom.tier,
			label: bottom.label,
			id: bottom.id,
			count: bottom.items.length,
			capacity: bottom.capacity,
			newTier: bottom.tier + 1,
			newLabel: tierLabel(bottom.tier + 1),
			minimumToMove: bottom.items.length - bottom.capacity,
			items: bottom.items,
		};
	}

	return {dayPlan, pushDowns, pullUps, extend};
}

function main(arguments_) {
	const [command, inputPath] = arguments_.slice(2);
	if (command !== 'rebalance' || !inputPath) {
		throw new Error(
			'usage: asap-tiers.mjs rebalance <bucket.json>  (a 📌 bucket from `node get --depth 2 --json`)',
		);
	}
	const bucket = JSON.parse(readFileSync(inputPath, 'utf8'));
	process.stdout.write(`${JSON.stringify(planRebalance(readLadder(bucket)), null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
