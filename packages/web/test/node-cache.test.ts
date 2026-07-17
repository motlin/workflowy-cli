import {QueryClient} from '@tanstack/react-query';
import {describe, expect, it} from 'vitest';
import {nodeKeys, readChildren, readDetail} from '../src/client/node-cache.js';

describe('nodeKeys', () => {
	it('builds stable, namespaced keys', () => {
		expect(nodeKeys.all).toStrictEqual(['nodes']);
		expect(nodeKeys.children('p')).toStrictEqual(['nodes', 'children', 'p']);
		expect(nodeKeys.children(null)).toStrictEqual(['nodes', 'children', null]);
		expect(nodeKeys.detail('n')).toStrictEqual(['nodes', 'detail', 'n']);
		expect(nodeKeys.ancestors('n')).toStrictEqual(['nodes', 'ancestors', 'n']);
	});
});

describe('readChildren / readDetail', () => {
	it('reads through the matching key', () => {
		const qc = new QueryClient();
		const kids = [{id: 'a', priority: 0}] as never;
		qc.setQueryData(nodeKeys.children('parent'), kids);
		qc.setQueryData(nodeKeys.detail('n'), {id: 'n'} as never);

		expect(readChildren(qc, 'parent')).toBe(kids);
		expect(readDetail(qc, 'n')).toStrictEqual({id: 'n'});
	});

	it('returns undefined on a cache miss', () => {
		const qc = new QueryClient();
		expect(readChildren(qc, 'absent')).toBeUndefined();
		expect(readDetail(qc, 'absent')).toBeUndefined();
	});
});
