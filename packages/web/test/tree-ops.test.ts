import {QueryClient} from '@tanstack/react-query';
import {describe, expect, it} from 'vitest';
import type {NodeResponse} from '../src/node-types.js';
import {nodeKeys} from '../src/client/node-cache.js';
import {
	nextSelectionAfterDelete,
	planDuplicate,
	planIndent,
	planInsertSiblingAfter,
	planMoveDown,
	planMoveUp,
	planOutdent,
} from '../src/client/tree-ops.js';

function node(partial: Partial<NodeResponse> & {id: string}): NodeResponse {
	return {
		parent_id: null,
		name: null,
		note: null,
		priority: 0,
		data: {layoutMode: null},
		createdAt: null,
		modifiedAt: null,
		completedAt: null,
		...partial,
	};
}

function seed(children: Record<string, NodeResponse[]>, details: NodeResponse[] = []): QueryClient {
	const qc = new QueryClient();
	for (const [parentId, kids] of Object.entries(children)) {
		qc.setQueryData(nodeKeys.children(parentId === 'root' ? null : parentId), kids);
	}
	for (const d of details) qc.setQueryData(nodeKeys.detail(d.id), d);
	return qc;
}

const siblings = [
	node({id: 'a', parent_id: 'p', priority: 0}),
	node({id: 'b', parent_id: 'p', priority: 100}),
	node({id: 'c', parent_id: 'p', priority: 200}),
];

describe('planInsertSiblingAfter / planDuplicate', () => {
	it('inserts an empty sibling at the midpoint after the node', () => {
		const qc = seed({p: siblings});
		expect(planInsertSiblingAfter(qc, siblings[0])).toStrictEqual({parent_id: 'p', name: '', position: 50});
	});

	it('steps +100 past the last sibling', () => {
		const qc = seed({p: siblings});
		expect(planInsertSiblingAfter(qc, siblings[2])).toStrictEqual({parent_id: 'p', name: '', position: 300});
	});

	it('carries name and note when duplicating', () => {
		const qc = seed({p: siblings});
		const src = node({id: 'a', parent_id: 'p', priority: 0, name: 'Hi', note: 'yo'});
		expect(planDuplicate(qc, src)).toStrictEqual({parent_id: 'p', name: 'Hi', note: 'yo', position: 50});
	});
});

describe('planIndent', () => {
	it('moves the node under its previous sibling', () => {
		const qc = seed({p: siblings});
		expect(planIndent(qc, siblings[1])).toStrictEqual({nodeId: 'b', parent_id: 'a'});
	});

	it('returns null for the first sibling', () => {
		const qc = seed({p: siblings});
		expect(planIndent(qc, siblings[0])).toBeNull();
	});
});

describe('planOutdent', () => {
	it('positions the node after its parent among the grandparent children', () => {
		const parent = node({id: 'p', parent_id: 'gp', priority: 100});
		const parentSiblings = [
			node({id: 'p', parent_id: 'gp', priority: 100}),
			node({id: 'q', parent_id: 'gp', priority: 200}),
		];
		const qc = seed({gp: parentSiblings, p: siblings}, [parent]);
		expect(planOutdent(qc, siblings[0])).toStrictEqual({nodeId: 'a', parent_id: 'gp', position: 150});
	});

	it('returns null for a root-level node', () => {
		const qc = seed({});
		expect(planOutdent(qc, node({id: 'x', parent_id: null}))).toBeNull();
	});
});

describe('planMoveUp / planMoveDown', () => {
	it('moves up before the previous sibling', () => {
		const qc = seed({p: siblings});
		expect(planMoveUp(qc, siblings[2])).toStrictEqual({nodeId: 'c', parent_id: 'p', position: 50});
	});
	it('returns null moving up the first sibling', () => {
		expect(planMoveUp(seed({p: siblings}), siblings[0])).toBeNull();
	});
	it('moves down after the next sibling', () => {
		const qc = seed({p: siblings});
		expect(planMoveDown(qc, siblings[0])).toStrictEqual({nodeId: 'a', parent_id: 'p', position: 150});
	});
	it('returns null moving down the last sibling', () => {
		expect(planMoveDown(seed({p: siblings}), siblings[2])).toBeNull();
	});
});

describe('nextSelectionAfterDelete', () => {
	const visible = ['a', 'b', 'c'];
	it('picks the previous visible node', () => {
		expect(nextSelectionAfterDelete(visible, node({id: 'b', parent_id: 'p'}))).toBe('a');
	});
	it('falls back to the parent when first', () => {
		expect(nextSelectionAfterDelete(visible, node({id: 'a', parent_id: 'p'}))).toBe('p');
	});
	it('returns null at the top with no parent', () => {
		expect(nextSelectionAfterDelete(visible, node({id: 'a', parent_id: null}))).toBeNull();
	});
});
