import {describe, expect, it} from 'vitest';
import {type RawNode, tierCapacity, toLadder, planTierMove} from '../src/server/ladder-model.js';

const node = (id: string, name: string, children: RawNode[] = []): RawNode => ({id, name, children, completedAt: null});

describe('tierCapacity', () => {
	it('doubles with each tier, so 1st holds 2 and 6th holds 64', () => {
		expect([1, 2, 3, 4, 5, 6].map(tierCapacity)).toEqual([2, 4, 8, 16, 32, 64]);
	});
});

describe('toLadder', () => {
	const bucket = {
		id: 'bucket',
		name: '📌 Tasks (asap) (work)',
		children: [
			node('t1', '1st', [node('a', 'Task A'), node('b', 'Task B')]),
			node('t2', '2nd', []),
			node('t3', '3rd', [node('c', 'Task C')]),
		],
	};

	it('reads tiers in order with their capacities', () => {
		const ladder = toLadder('work', bucket);
		expect(ladder.tiers.map((t) => [t.label, t.capacity, t.items.length])).toEqual([
			['1st', 2, 2],
			['2nd', 4, 0],
			['3rd', 8, 1],
		]);
	});

	it('keeps an empty tier, because pulling an item up into one is the main repair', () => {
		const ladder = toLadder('work', bucket);
		expect(ladder.tiers.find((t) => t.label === '2nd')?.items).toEqual([]);
	});

	it('marks each tier over, exact or room so the client does not recompute it', () => {
		const ladder = toLadder('work', bucket);
		expect(ladder.tiers.map((t) => t.state)).toEqual(['exact', 'room', 'room']);
	});

	it('drops completed tasks rather than showing work already done', () => {
		const withDone = {
			...bucket,
			children: [
				{
					id: 't1',
					name: '1st',
					completedAt: null,
					children: [node('a', 'Task A'), {id: 'z', name: 'Done', children: [], completedAt: '2026-09-01'}],
				},
			],
		};
		expect(toLadder('work', withDone).tiers[0].items.map((i) => i.id)).toEqual(['a']);
	});
});

describe('planTierMove', () => {
	const ladder = toLadder('work', {
		id: 'bucket',
		name: '📌',
		children: [node('t1', '1st', [node('a', 'A')]), node('t2', '2nd', [node('b', 'B')])],
	});

	it('resolves a tier label to the parent id the move endpoint needs', () => {
		expect(planTierMove(ladder, 'a', '2nd')).toEqual({nodeId: 'a', parentId: 't2', fromTier: '1st', toTier: '2nd'});
	});

	it('refuses a tier that does not exist rather than guessing', () => {
		expect(() => planTierMove(ladder, 'a', '9th')).toThrow(/9th/);
	});

	it('refuses a node that is not on this ladder', () => {
		expect(() => planTierMove(ladder, 'nope', '2nd')).toThrow(/nope/);
	});
});
