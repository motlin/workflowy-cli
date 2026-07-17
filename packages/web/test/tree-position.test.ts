import {describe, expect, it} from 'vitest';
import {insertAfterPriority, insertBeforePriority, sortByPriority} from '../src/client/tree-position.js';

const siblings = [
	{id: 'a', priority: 0},
	{id: 'b', priority: 100},
	{id: 'c', priority: 200},
];

describe('sortByPriority', () => {
	it('sorts ascending without mutating the input', () => {
		const input = [
			{id: 'c', priority: 200},
			{id: 'a', priority: 0},
			{id: 'b', priority: 100},
		];
		const sorted = sortByPriority(input);
		expect(sorted.map((s) => s.id)).toStrictEqual(['a', 'b', 'c']);
		expect(input[0].id).toBe('c'); // original untouched
	});
});

describe('insertAfterPriority', () => {
	it('takes the midpoint to the next sibling', () => {
		expect(insertAfterPriority(siblings, 'a', 0)).toBe(50);
		expect(insertAfterPriority(siblings, 'b', 100)).toBe(150);
	});

	it('steps +100 past the last sibling', () => {
		expect(insertAfterPriority(siblings, 'c', 200)).toBe(300);
	});

	it('steps +100 past the fallback when the node is absent', () => {
		expect(insertAfterPriority(siblings, 'missing', 500)).toBe(600);
		expect(insertAfterPriority([], 'x', 7)).toBe(107);
	});
});

describe('insertBeforePriority', () => {
	it('takes the midpoint to the previous sibling', () => {
		expect(insertBeforePriority(siblings, 'b', 100)).toBe(50);
		expect(insertBeforePriority(siblings, 'c', 200)).toBe(150);
	});

	it('steps -100 before the first sibling', () => {
		expect(insertBeforePriority(siblings, 'a', 0)).toBe(-100);
	});

	it('steps -100 before the fallback when the node is absent', () => {
		expect(insertBeforePriority(siblings, 'missing', 500)).toBe(400);
	});
});
