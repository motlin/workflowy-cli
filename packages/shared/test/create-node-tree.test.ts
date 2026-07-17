import {createNodeTree, type TreeWriteClient} from '../src/cache/create-node-tree.js';
import type {WorkflowyNode} from '../src/types/workflowy.js';

/** A fake write-through client that records createNode calls and hands back ids. */
function fakeClient() {
	const calls: {parent_id: string; name: string; position?: string}[] = [];
	let counter = 0;
	const client: TreeWriteClient = {
		async createNode(options) {
			calls.push({parent_id: options.parent_id, name: options.name, position: options.position});
			counter += 1;
			return {id: `id-${counter}`, name: options.name, createdAt: 1000 + counter} as WorkflowyNode;
		},
	};
	return {client, calls};
}

describe('createNodeTree', () => {
	it('creates a single node under the parent with the given position', async () => {
		const {client, calls} = fakeClient();
		const result = await createNodeTree({name: 'Root', note: 'n'}, 'parent', client, 'top');

		expect(calls).toStrictEqual([{parent_id: 'parent', name: 'Root', position: 'top'}]);
		expect(result).toStrictEqual({id: 'id-1', name: 'Root', createdAt: 1001, children: []});
	});

	it('creates children depth-first, always at position bottom to preserve order', async () => {
		const {client, calls} = fakeClient();
		const result = await createNodeTree(
			{name: 'Root', children: [{name: 'A', children: [{name: 'A1'}]}, {name: 'B'}]},
			'parent',
			client,
		);

		// Root (parent), then A under root, then A1 under A, then B under root.
		expect(calls).toStrictEqual([
			{parent_id: 'parent', name: 'Root', position: undefined},
			{parent_id: 'id-1', name: 'A', position: 'bottom'},
			{parent_id: 'id-2', name: 'A1', position: 'bottom'},
			{parent_id: 'id-1', name: 'B', position: 'bottom'},
		]);
		expect(result.children.map((c) => c.name)).toStrictEqual(['A', 'B']);
		expect(result.children[0].children[0].name).toBe('A1');
	});
});
