import {describe, expect, it} from 'vitest';
import type {Ladder} from '../src/server/ladder-model.js';
import {applyLadderEvent, moveWithin} from '../src/client/ladder-state.js';

const ladder = (): Record<string, Ladder> => ({
	work: {
		root: 'work',
		bucketId: 'wb',
		tiers: [
			{
				tier: 1,
				label: '1st',
				id: 'w1',
				capacity: 2,
				state: 'exact',
				items: [
					{id: 'a', name: 'A'},
					{id: 'b', name: 'B'},
				],
			},
			{tier: 2, label: '2nd', id: 'w2', capacity: 4, state: 'room', items: []},
		],
	},
});

describe('moveWithin', () => {
	it('relocates the row and recomputes both tiers capacity state', () => {
		const next = moveWithin(ladder(), 'work', 'a', '2nd');
		expect(next.work.tiers[0].items.map((i) => i.id)).toEqual(['b']);
		expect(next.work.tiers[0].state).toBe('room');
		expect(next.work.tiers[1].items.map((i) => i.id)).toEqual(['a']);
	});

	it('flags the destination as over once it passes its cap', () => {
		const start = ladder();
		start.work.tiers[1] = {...start.work.tiers[1], capacity: 1, items: [{id: 'c', name: 'C'}]};
		const next = moveWithin(start, 'work', 'a', '2nd');
		expect(next.work.tiers[1].state).toBe('over');
	});

	it('leaves the ladder untouched when the row is not on it', () => {
		const start = ladder();
		expect(moveWithin(start, 'work', 'missing', '2nd')).toBe(start);
	});
});

describe('applyLadderEvent', () => {
	it('applies a move announced over the socket', () => {
		const next = applyLadderEvent(ladder(), {
			verb: 'move',
			nodeId: 'a',
			name: 'A',
			fromTier: '1st',
			toTier: '2nd',
			at: 'T',
		});
		expect(next.work.tiers[1].items.map((i) => i.id)).toEqual(['a']);
	});

	it('drops a completed row off the ladder', () => {
		const next = applyLadderEvent(ladder(), {
			verb: 'complete',
			nodeId: 'a',
			name: 'A',
			fromTier: '1st',
			toTier: null,
			at: 'T',
		});
		expect(next.work.tiers[0].items.map((i) => i.id)).toEqual(['b']);
		expect(next.work.tiers[0].state).toBe('room');
	});

	it('ignores an event for a node it has never seen rather than inventing a row', () => {
		const start = ladder();
		expect(
			applyLadderEvent(start, {verb: 'move', nodeId: 'zz', name: 'Z', fromTier: '1st', toTier: '2nd', at: 'T'}),
		).toBe(start);
	});
});
