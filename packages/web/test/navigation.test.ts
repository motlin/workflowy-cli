import {describe, expect, it} from 'vitest';
import {nodeRoute} from '../src/client/navigation.js';

describe('nodeRoute', () => {
	it('routes on the full node UUID, not a shortened id', () => {
		const uuid = '5168a562-9286-03ac-7cbc-166badb860f8';
		// Guard against reintroducing short-id routing (which breaks zoomed-node id
		// comparisons): the route must contain the hyphenated full UUID.
		expect(nodeRoute(uuid)).toBe(`/node/${uuid}`);
	});
});
