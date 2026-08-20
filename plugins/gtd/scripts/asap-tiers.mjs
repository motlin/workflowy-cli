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
