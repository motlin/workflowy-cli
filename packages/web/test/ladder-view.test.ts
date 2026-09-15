import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {ReactElement, ReactNode} from 'react';
import type {Ladders} from '../src/client/ladder-state.js';
import {LadderView} from '../src/client/components/ladder-view.js';

const hooks = vi.hoisted(() => ({values: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[]}));
vi.mock('react', () => ({
	useState(initial: unknown) {
		const index = hooks.cursor++;
		if (!(index in hooks.values)) hooks.values[index] = initial;
		return [
			hooks.values[index],
			(value: unknown) => {
				hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
			},
		];
	},
	useRef(initial: unknown) {
		const index = hooks.cursor++;
		if (!(index in hooks.values)) hooks.values[index] = {current: initial};
		return hooks.values[index];
	},
	useEffect(callback: () => unknown) {
		hooks.effects.push(callback);
	},
	useMemo: (callback: () => unknown) => callback(),
	useCallback: (callback: unknown) => callback,
}));

interface ElementProps {
	children?: ReactNode;
	[key: string]: unknown;
}

function elements(node: ReactNode): ReactElement<ElementProps>[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== 'object' || !('props' in node)) return [];
	const element = node as ReactElement<ElementProps>;
	return [element, ...elements(element.props.children)];
}

function render() {
	hooks.cursor = 0;
	return elements(LadderView());
}

function tierProps() {
	return render().find((element) => element.props.tier)?.props as {
		onSelect: (id: string, range: boolean) => void;
		onStep: (id: string, label: string) => void;
		onComplete: (id: string) => void;
		rowErrors: Record<string, string>;
	};
}

const item = (id: string) => ({id, name: id, children: [], descendantCount: 0});
const ladders = () => ({
	personal: {
		root: 'personal',
		bucketId: 'personal-bucket',
		tiers: [
			{tier: 1, id: 'first', label: '1st', capacity: 2, state: 'exact', items: [item('alice'), item('bob')]},
			{tier: 2, id: 'second', label: '2nd', capacity: 4, state: 'room', items: []},
		],
	},
});
const request = vi.fn();
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
	hooks.values = [ladders()];
	hooks.effects = [];
	request.mockReset().mockImplementation(async (path: string, options: {body: string}) => {
		const body = JSON.parse(options.body);
		return {
			ok: true,
			json: async () => ({
				event: {
					nodeId: body.node_id,
					verb: path.endsWith('complete') ? 'complete' : 'move',
					name: body.node_id,
					fromTier: '1st',
					toTier: body.to_tier ?? null,
					at: '2000-01-01T00:00:00.000Z',
				},
			}),
		};
	});
	vi.stubGlobal('fetch', request);
});

describe('local ladder actions', () => {
	it('saves a reverse-selected group in display order into an empty tier', async () => {
		tierProps().onSelect('bob', false);
		tierProps().onSelect('alice', true);
		tierProps().onStep('alice', '2nd');
		await settle();
		expect(request.mock.calls).toStrictEqual([
			[
				'/api/v1/ladder/move',
				{
					method: 'POST',
					headers: {'content-type': 'application/json'},
					body: JSON.stringify({root: 'personal', node_id: 'alice', to_tier: '2nd'}),
				},
			],
			[
				'/api/v1/ladder/move',
				{
					method: 'POST',
					headers: {'content-type': 'application/json'},
					body: JSON.stringify({root: 'personal', node_id: 'bob', to_tier: '2nd'}),
				},
			],
		]);
	});

	it('stops a group at the failed move without dispatching the rest', async () => {
		request.mockResolvedValue({ok: false, json: async () => ({error: 'Test write rejected'})});
		tierProps().onSelect('alice', false);
		tierProps().onSelect('bob', true);
		tierProps().onStep('alice', '2nd');
		await settle();
		expect(request.mock.calls).toStrictEqual([
			[
				'/api/v1/ladder/move',
				{
					method: 'POST',
					headers: {'content-type': 'application/json'},
					body: JSON.stringify({root: 'personal', node_id: 'alice', to_tier: '2nd'}),
				},
			],
		]);
	});

	it('completes only the clicked row even when other rows are selected', async () => {
		tierProps().onSelect('alice', false);
		tierProps().onSelect('bob', true);
		tierProps().onComplete('bob');
		await settle();
		expect(request.mock.calls).toStrictEqual([
			[
				'/api/v1/ladder/complete',
				{
					method: 'POST',
					headers: {'content-type': 'application/json'},
					body: JSON.stringify({root: 'personal', node_id: 'bob'}),
				},
			],
		]);
	});

	it('reconciles an optimistic move with the returned event', async () => {
		let respond!: (value: unknown) => void;
		request.mockReturnValue(
			new Promise((resolve) => {
				respond = resolve;
			}),
		);
		tierProps().onStep('alice', '2nd');
		expect((hooks.values[0] as Ladders).personal.tiers.map((tier) => tier.items)).toStrictEqual([
			[item('bob')],
			[item('alice')],
		]);
		respond({
			ok: true,
			json: async () => ({
				event: {
					nodeId: 'alice',
					verb: 'move',
					name: 'alice',
					fromTier: '2nd',
					toTier: '1st',
					at: '2000-01-01T00:00:00.000Z',
				},
			}),
		});
		await settle();
		expect((hooks.values[0] as Ladders).personal.tiers.map((tier) => tier.items)).toStrictEqual([
			[item('bob'), item('alice')],
			[],
		]);
	});

	it('restores a failed Done row without undoing another socket write and clears its error on retry', async () => {
		let reject!: (reason: Error) => void;
		request.mockReturnValueOnce(
			new Promise((_resolve, rejectRequest) => {
				reject = rejectRequest;
			}),
		);
		const listeners: Record<string, (message: {data: string}) => void> = {};
		vi.stubGlobal('location', {protocol: 'http:', host: 'example.com'});
		vi.stubGlobal(
			'WebSocket',
			class {
				addEventListener(name: string, callback: (message: {data: string}) => void) {
					listeners[name] = callback;
				}
			},
		);
		const actions = tierProps();
		hooks.effects[1]();
		actions.onComplete('alice');
		listeners.message({
			data: JSON.stringify({
				nodeId: 'bob',
				verb: 'move',
				name: 'bob',
				fromTier: '1st',
				toTier: '2nd',
				at: '2000-01-01T00:00:00.000Z',
			}),
		});
		reject(new Error('Test connection failed'));
		await settle();
		expect((hooks.values[0] as Ladders).personal.tiers.map((tier) => tier.items)).toStrictEqual([
			[item('alice')],
			[item('bob')],
		]);
		expect(tierProps().rowErrors).toStrictEqual({alice: 'Test connection failed'});
		tierProps().onComplete('alice');
		await settle();
		expect(tierProps().rowErrors).toStrictEqual({});
		expect((hooks.values[0] as Ladders).personal.tiers.map((tier) => tier.items)).toStrictEqual([
			[],
			[item('bob')],
		]);
	});

	it('keeps a socket-confirmed completion when its HTTP response is lost', async () => {
		let reject!: (reason: Error) => void;
		request.mockReturnValueOnce(
			new Promise((_resolve, rejectRequest) => {
				reject = rejectRequest;
			}),
		);
		const listeners: Record<string, (message: {data: string}) => void> = {};
		vi.stubGlobal('location', {protocol: 'http:', host: 'example.com'});
		vi.stubGlobal(
			'WebSocket',
			class {
				addEventListener(name: string, callback: (message: {data: string}) => void) {
					listeners[name] = callback;
				}
			},
		);
		const actions = tierProps();
		hooks.effects[1]();
		actions.onComplete('alice');
		listeners.message({
			data: JSON.stringify({
				nodeId: 'alice',
				verb: 'complete',
				name: 'alice',
				fromTier: '1st',
				toTier: null,
				at: '2000-01-01T00:00:00.000Z',
			}),
		});
		reject(new Error('Test response lost'));
		await settle();
		expect((hooks.values[0] as Ladders).personal.tiers.map((tier) => tier.items)).toStrictEqual([
			[item('bob')],
			[],
		]);
		expect(tierProps().rowErrors).toStrictEqual({});
	});

	it('creates the next ordinal under the displayed bucket and refreshes the page', async () => {
		request
			.mockResolvedValueOnce({ok: true})
			.mockResolvedValueOnce({ok: true, json: async () => ({ladders: ladders()})});
		const button = render().find((element) => element.props.children === 'Add bottom tier');
		if (!button) throw new Error('Add bottom tier button is missing');
		(button.props.onClick as () => void)();
		await settle();
		expect(request.mock.calls).toStrictEqual([
			[
				'/api/v1/nodes',
				{
					method: 'POST',
					headers: {'content-type': 'application/json'},
					body: JSON.stringify({parent_id: 'personal-bucket', name: '3rd', position: 0}),
				},
			],
			['/api/v1/ladder'],
		]);
	});
});
