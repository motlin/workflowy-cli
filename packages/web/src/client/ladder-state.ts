/**
 * Ladder state in the browser, moved without a refetch.
 *
 * Every write reaches the page twice: once as the optimistic local move that
 * makes the drop feel instant, and again as the WebSocket frame the server
 * broadcasts after the write lands. Both go through here, and both are
 * idempotent — re-applying a move the page already made is a no-op.
 */

import type {Ladder, LadderTier, TierState} from '../server/ladder-model.js';
import type {LadderEvent} from '../server/ladder-events.js';

export type Ladders = Record<string, Ladder>;

function stateFor(count: number, capacity: number): TierState {
	if (count > capacity) {
		return 'over';
	}
	return count === capacity ? 'exact' : 'room';
}

function withItems(tier: LadderTier, items: LadderTier['items']): LadderTier {
	return {...tier, items, state: stateFor(items.length, tier.capacity)};
}

/** Move one row to another tier of the same ladder, or return the input unchanged. */
export function moveWithin(ladders: Ladders, root: string, nodeId: string, toTier: string): Ladders {
	const ladder = ladders[root];
	if (!ladder) {
		return ladders;
	}
	const origin = ladder.tiers.find((tier) => tier.items.some((item) => item.id === nodeId));
	const destination = ladder.tiers.find((tier) => tier.label === toTier);
	if (!origin || !destination || origin.label === destination.label) {
		return ladders;
	}
	const item = origin.items.find((candidate) => candidate.id === nodeId);
	if (!item) {
		return ladders;
	}
	const tiers = ladder.tiers.map((tier) => {
		if (tier.label === origin.label) {
			return withItems(
				tier,
				tier.items.filter((candidate) => candidate.id !== nodeId),
			);
		}
		if (tier.label === destination.label) {
			return withItems(tier, [...tier.items, item]);
		}
		return tier;
	});
	return {...ladders, [root]: {...ladder, tiers}};
}

/** Remove a row from whichever ladder holds it. */
export function removeRow(ladders: Ladders, nodeId: string): Ladders {
	for (const [root, ladder] of Object.entries(ladders)) {
		if (!ladder.tiers.some((tier) => tier.items.some((item) => item.id === nodeId))) {
			continue;
		}
		const tiers = ladder.tiers.map((tier) =>
			tier.items.some((item) => item.id === nodeId)
				? withItems(
						tier,
						tier.items.filter((item) => item.id !== nodeId),
					)
				: tier,
		);
		return {...ladders, [root]: {...ladder, tiers}};
	}
	return ladders;
}

/** Apply one broadcast write. Unknown nodes are ignored, never invented. */
export function applyLadderEvent(ladders: Ladders, event: LadderEvent): Ladders {
	const root = Object.entries(ladders).find(([, ladder]) =>
		ladder.tiers.some((tier) => tier.items.some((item) => item.id === event.nodeId)),
	)?.[0];
	if (!root) {
		return ladders;
	}
	if (event.verb === 'move' && event.toTier) {
		return moveWithin(ladders, root, event.nodeId, event.toTier);
	}
	if (event.verb === 'complete') {
		return removeRow(ladders, event.nodeId);
	}
	return ladders;
}

/**
 * Which tier a row is in right now. The drop handler uses this to drop a
 * gesture that ended where it started: a finger that wanders and comes back
 * should not cost a write.
 */
export function tierOf(ladders: Ladders, root: string, nodeId: string): string | undefined {
	return ladders[root]?.tiers.find((tier) => tier.items.some((item) => item.id === nodeId))?.label;
}
