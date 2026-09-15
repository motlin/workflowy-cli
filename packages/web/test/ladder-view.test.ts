import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {ReactElement, ReactNode} from 'react';
import {LadderView} from '../src/client/components/ladder-view.js';

const hooks = vi.hoisted(() => ({values: [] as unknown[], cursor: 0}));
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
	useEffect() {},
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
	request.mockReset().mockResolvedValue({ok: true});
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
