import {describe, expect, it, vi} from 'vitest';
import {LadderEventBus} from '../src/server/ladder-events.js';
import {LadderService} from '../src/server/ladder-service.js';

const tier = (id: string, label: string, items: {id: string; name: string}[]) => ({
	id,
	name: label,
	completedAt: null,
	children: items.map((i) => ({id: i.id, name: i.name, completedAt: null, children: []})),
});

function makeService(overrides: Partial<ConstructorParameters<typeof LadderService>[0]> = {}) {
	const buckets = {
		work: {id: 'wb', name: '📌 work', children: [tier('w1', '1st', [{id: 'a', name: 'A'}]), tier('w2', '2nd', [])]},
		personal: {id: 'pb', name: '📌 personal', children: [tier('p1', '1st', [{id: 'x', name: 'X'}])]},
	};
	const moveNode = vi.fn(async () => undefined);
	const completeNode = vi.fn(async () => undefined);
	const events = new LadderEventBus();
	const service = new LadderService({
		readBuckets: async () => buckets,
		moveNode,
		completeNode,
		events,
		...overrides,
	});
	return {service, moveNode, completeNode, events};
}

describe('LadderService.read', () => {
	it('returns both ladders with tiers and capacity state', async () => {
		const {service} = makeService();
		const ladders = await service.read();
		expect(Object.keys(ladders)).toEqual(['work', 'personal']);
		expect(ladders.work.tiers.map((t) => t.label)).toEqual(['1st', '2nd']);
		expect(ladders.work.tiers[0].state).toBe('room');
	});
});

describe('LadderService.move', () => {
	it('writes the move to Workflowy with the destination tier as parent', async () => {
		const {service, moveNode} = makeService();
		await service.move({root: 'work', nodeId: 'a', toTier: '2nd'});
		expect(moveNode).toHaveBeenCalledWith('a', 'w2', -1);
	});

	it('publishes one event per write, so a watcher is woken per edit', async () => {
		const {service, events} = makeService();
		const seen: unknown[] = [];
		events.subscribe((e) => seen.push(e));
		await service.move({root: 'work', nodeId: 'a', toTier: '2nd'});
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({verb: 'move', nodeId: 'a', fromTier: '1st', toTier: '2nd', name: 'A'});
	});

	it('does not publish an event when the write fails', async () => {
		const {service, events} = makeService({
			moveNode: vi.fn(async () => {
				throw new Error('workflowy 500');
			}),
		});
		const seen: unknown[] = [];
		events.subscribe((e) => seen.push(e));
		await expect(service.move({root: 'work', nodeId: 'a', toTier: '2nd'})).rejects.toThrow('workflowy 500');
		expect(seen).toEqual([]);
	});

	it('rejects an unknown root instead of writing somewhere plausible', async () => {
		const {service, moveNode} = makeService();
		await expect(service.move({root: 'nope', nodeId: 'a', toTier: '2nd'})).rejects.toThrow(/nope/);
		expect(moveNode).not.toHaveBeenCalled();
	});

	it('rejects a node from the other ladder rather than moving it across roots', async () => {
		const {service, moveNode} = makeService();
		await expect(service.move({root: 'work', nodeId: 'x', toTier: '2nd'})).rejects.toThrow(/x/);
		expect(moveNode).not.toHaveBeenCalled();
	});
});

describe('LadderService.complete', () => {
	it('completes the node and publishes a complete event', async () => {
		const {service, completeNode, events} = makeService();
		const seen: unknown[] = [];
		events.subscribe((e) => seen.push(e));
		await service.complete({root: 'work', nodeId: 'a'});
		expect(completeNode).toHaveBeenCalledWith('a');
		expect(seen[0]).toMatchObject({verb: 'complete', nodeId: 'a', fromTier: '1st', name: 'A'});
	});
});

describe('exact placement using top/bottom writes', () => {
	it('persists a middle insertion in order and broadcasts each successful write', async () => {
		const buckets = {
			work: {
				id: 'bucket',
				children: [
					tier('first', '1st', [
						{id: 'alice', name: 'Alice'},
						{id: 'bob', name: 'Bob'},
						{id: 'charlie', name: 'Charlie'},
					]),
				],
			},
		};
		const {service, moveNode, events} = makeService({
			readBuckets: async () => buckets,
			now: () => new Date('2000-01-01T00:00:00.000Z'),
		});
		const seen: unknown[] = [];
		events.subscribe((event) => seen.push(event));
		await service.move({root: 'work', nodeId: 'alice', toTier: '1st', beforeNodeId: 'charlie'});
		expect(moveNode.mock.calls).toStrictEqual([
			['alice', 'first', 0],
			['charlie', 'first', 0],
		]);
		expect(seen).toStrictEqual([
			{
				verb: 'move',
				nodeId: 'alice',
				name: 'Alice',
				fromTier: '1st',
				toTier: '1st',
				beforeNodeId: '',
				at: '2000-01-01T00:00:00.000Z',
			},
			{
				verb: 'move',
				nodeId: 'charlie',
				name: 'Charlie',
				fromTier: '1st',
				toTier: '1st',
				beforeNodeId: '',
				at: '2000-01-01T00:00:00.000Z',
			},
			{
				verb: 'move',
				nodeId: 'alice',
				name: 'Alice',
				fromTier: '1st',
				toTier: '1st',
				beforeNodeId: 'charlie',
				at: '2000-01-01T00:00:00.000Z',
			},
		]);
	});

	it('rejects a stale insertion target without moving anything', async () => {
		const {service, moveNode} = makeService();
		await expect(service.move({root: 'work', nodeId: 'a', toTier: '2nd', beforeNodeId: 'missing'})).rejects.toThrow(
			new Error('node missing is not a destination row'),
		);
		expect(moveNode.mock.calls).toStrictEqual([]);
	});
});
