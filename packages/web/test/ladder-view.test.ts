import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {ReactElement, ReactNode} from 'react';
import type {Ladders} from '../src/client/ladder-state.js';
import {LadderView} from '../src/client/components/ladder-view.js';

vi.mock('../src/client/components/ladder-tree.js', () => ({LadderTree: () => null}));

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
		onSelect: (id: string, range: boolean, additive?: boolean) => void;
		selected: Set<string>;
		onGripCancel: () => void;
		onGripDown: (event: unknown, item: {id: string; name: string}) => void;
		onGripMove: (event: unknown, name: string) => void;
		onGripUp: (event: unknown) => void;
		onStep: (id: string, label: string, beforeNodeId?: string) => void;
		onComplete: (id: string) => void;
		rowErrors: Record<string, string>;
		pending: Set<string>;
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
		let respond!: (value: unknown) => void;
		request.mockReturnValueOnce(
			new Promise((resolve) => {
				respond = resolve;
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
		respond({ok: false, json: async () => ({error: 'Test write rejected'})});
		await settle();
		expect((hooks.values[0] as Ladders).personal.tiers.map((tier) => tier.items)).toStrictEqual([
			[item('alice')],
			[item('bob')],
		]);
		expect(tierProps().rowErrors).toStrictEqual({alice: 'Test write rejected'});
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

	it('re-reads the ladder when the connection drops mid-move instead of guessing', async () => {
		const landed = ladders();
		landed.personal.tiers = [
			{...landed.personal.tiers[0], state: 'room', items: [item('bob')]},
			{...landed.personal.tiers[1], items: [item('alice')]},
		];
		request
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
			.mockResolvedValueOnce({ok: true, json: async () => ({ladders: landed})});
		tierProps().onStep('alice', '2nd');
		await settle();
		expect({
			calls: request.mock.calls.map(([path]) => path),
			ladders: hooks.values[0],
			errors: tierProps().rowErrors,
			pending: tierProps().pending,
		}).toStrictEqual({
			calls: ['/api/v1/ladder/move', '/api/v1/ladder'],
			ladders: landed,
			errors: {},
			pending: new Set(),
		});
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

describe('a row whose write is in flight', () => {
	function rowButtons(nodeId: string) {
		const rows = render()
			.filter((element) => element.props.tier)
			.flatMap((tier) => elements((tier.type as (props: ElementProps) => ReactNode)(tier.props)));
		const row = rows.find((element) => element.props['data-node-id'] === nodeId);
		if (!row) throw new Error(`no row ${nodeId}`);
		return elements(row.props.children)
			.filter((element) => element.type === 'button' && element.props.className !== 'ladder-tree-button')
			.map((button) => ({
				label: button.props['aria-label'] ?? button.props.children,
				disabled: button.props.disabled,
			}));
	}

	beforeEach(() => {
		hooks.values = [
			{
				personal: {
					...ladders().personal,
					tiers: [
						{
							tier: 1,
							id: 'first',
							label: '1st',
							capacity: 2,
							state: 'exact',
							items: [item('alice'), item('bob')],
						},
						{tier: 2, id: 'second', label: '2nd', capacity: 4, state: 'room', items: [item('carol')]},
					],
				},
			},
		];
		request.mockReturnValue(new Promise(() => {}));
	});

	it('disables only its own buttons while the other rows stay usable', () => {
		tierProps().onStep('alice', '2nd');
		expect({bob: rowButtons('bob'), carol: rowButtons('carol')}).toStrictEqual({
			bob: [
				{label: 'Move to the tier above', disabled: true},
				{label: 'Move to 2nd', disabled: false},
				{label: 'Done', disabled: false},
			],
			carol: [
				{label: 'Move to 1st', disabled: false},
				{label: 'Move to the tier below', disabled: true},
				{label: 'Done', disabled: false},
			],
		});
	});

	it('still dispatches a move for another row', () => {
		tierProps().onStep('alice', '2nd');
		tierProps().onStep('bob', '2nd');
		expect(request.mock.calls.map(([, options]) => JSON.parse(options.body))).toStrictEqual([
			{root: 'personal', node_id: 'alice', to_tier: '2nd'},
			{root: 'personal', node_id: 'bob', to_tier: '2nd'},
		]);
	});

	it('ignores a second move of the same row until the first lands', () => {
		tierProps().onStep('alice', '2nd');
		tierProps().onStep('alice', '1st');
		expect(request.mock.calls.map(([, options]) => JSON.parse(options.body))).toStrictEqual([
			{root: 'personal', node_id: 'alice', to_tier: '2nd'},
		]);
	});
});

describe('row selection and pointer cancellation', () => {
	it('replaces selection on click and toggles with a modifier', () => {
		tierProps().onSelect('alice', false);
		tierProps().onSelect('bob', false);
		expect(tierProps().selected).toStrictEqual(new Set(['bob']));
		tierProps().onSelect('alice', false, true);
		expect(tierProps().selected).toStrictEqual(new Set(['bob', 'alice']));
		tierProps().onSelect('bob', false, true);
		expect(tierProps().selected).toStrictEqual(new Set(['alice']));
	});

	it('keeps the anchor when extending and shrinking a range', () => {
		tierProps().onSelect('alice', false);
		tierProps().onSelect('bob', true);
		expect(tierProps().selected).toStrictEqual(new Set(['alice', 'bob']));
		tierProps().onSelect('alice', true);
		expect(tierProps().selected).toStrictEqual(new Set(['alice']));
	});

	it('never saves a cancelled drag', () => {
		const row = {dataset: {nodeId: 'bob'}, getBoundingClientRect: () => ({top: 100, height: 40})};
		const zone = {dataset: {tier: '1st'}, classList: {contains: () => true}, querySelectorAll: () => [row]};
		vi.stubGlobal('document', {elementFromPoint: () => ({closest: () => zone})});
		const event = {
			button: 0,
			isPrimary: true,
			pointerType: 'mouse',
			pointerId: 1,
			clientX: 100,
			clientY: 100,
			target: {closest: () => null},
			currentTarget: {setPointerCapture: vi.fn()},
		};
		tierProps().onGripDown(event, {id: 'alice', name: 'Alice'});
		tierProps().onGripMove({...event, clientY: 140}, 'Alice');
		tierProps().onGripCancel();
		tierProps().onGripUp(event);
		expect(request.mock.calls).toStrictEqual([]);
	});

	it('reloads authoritative order after a partially applied move fails', async () => {
		request
			.mockResolvedValueOnce({ok: false, json: async () => ({error: 'Test suffix failed', reconcile: true})})
			.mockResolvedValueOnce({ok: true, json: async () => ({ladders: ladders()})});
		tierProps().onStep('alice', '2nd');
		await settle();
		expect({ladders: hooks.values[0], errors: tierProps().rowErrors}).toStrictEqual({
			ladders: ladders(),
			errors: {alice: 'Test suffix failed'},
		});
	});
});

it('saves selected rows before the same anchor in display order', async () => {
	tierProps().onSelect('alice', false);
	tierProps().onSelect('bob', true);
	tierProps().onStep('bob', '2nd', 'charlie');
	await settle();
	expect(request.mock.calls.map(([, options]) => JSON.parse(options.body))).toStrictEqual([
		{root: 'personal', node_id: 'alice', to_tier: '2nd', before_id: 'charlie'},
		{root: 'personal', node_id: 'bob', to_tier: '2nd', before_id: 'charlie'},
	]);
});

describe('row children', () => {
	function renderTier(items: Ladders[string]['tiers'][number]['items']) {
		const tier = render().find((element) => element.props.tier);
		if (!tier) throw new Error('no tier element');
		const props = {...tier.props, tier: {...(tier.props.tier as object), items}};
		return elements((tier.type as (props: ElementProps) => ReactNode)(props));
	}

	function text(node: ReactNode): string {
		if (typeof node === 'string' || typeof node === 'number') return String(node);
		if (Array.isArray(node)) return node.map(text).join('');
		if (node && typeof node === 'object' && 'props' in node) {
			return text((node as ReactElement<ElementProps>).props.children);
		}
		return '';
	}

	it('shows a descendant-count badge and dimmed child lines for a row with children', () => {
		const parent = {
			id: 'alice',
			name: 'alice',
			hasChildren: true,
			descendantCount: 3,
			children: [
				{id: 'c1', name: 'first child', children: [], descendantCount: 0},
				{
					id: 'c2',
					name: 'second child',
					hasChildren: true,
					descendantCount: 1,
					children: [{id: 'g1', name: 'grandchild', children: [], descendantCount: 0}],
				},
			],
		};
		const rendered = renderTier([parent, item('bob')]);
		const badges = rendered.filter((element) => element.props.className === 'ladder-child-count');
		expect(badges.map((badge) => badge.props['aria-label'])).toStrictEqual(['3 open items below']);
		const lists = rendered.filter((element) => element.props.className === 'ladder-children');
		expect(lists).toHaveLength(1);
		const lines = elements(lists[0].props.children).filter((element) => element.type === 'li');
		expect(lines.map(text)).toStrictEqual(['first child', 'second child+1']);
	});
});
