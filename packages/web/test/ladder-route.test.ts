import {describe, expect, it, vi} from 'vitest';
import {Hono} from 'hono';
import {createLadderRouter} from '../src/server/routes/ladder.js';
import type {AppEnv} from '../src/server/context.js';

function makeApp(service: unknown) {
	const app = new Hono<AppEnv>();
	app.use('/*', async (c, next) => {
		c.set('ctx', {} as never);
		await next();
	});
	app.route('/api/v1/ladder', createLadderRouter({createService: () => service as never}));
	return app;
}

const ladders = {
	work: {
		root: 'work',
		bucketId: 'wb',
		tiers: [{tier: 1, label: '1st', id: 'w1', capacity: 2, state: 'room', items: []}],
	},
};

describe('GET /api/v1/ladder', () => {
	it('returns both ladders as JSON', async () => {
		const app = makeApp({read: async () => ladders});
		const res = await app.fetch(new Request('http://x/api/v1/ladder'));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ladders});
	});
});

describe('POST /api/v1/ladder/move', () => {
	it('passes root, node and destination tier through to the service', async () => {
		const move = vi.fn(async () => ({
			verb: 'move',
			nodeId: 'a',
			name: 'A',
			fromTier: '1st',
			toTier: '2nd',
			at: 'T',
		}));
		const app = makeApp({move});
		const res = await app.fetch(
			new Request('http://x/api/v1/ladder/move', {
				method: 'POST',
				headers: {'content-type': 'application/json'},
				body: JSON.stringify({root: 'work', node_id: 'a', to_tier: '2nd'}),
			}),
		);
		expect(res.status).toBe(200);
		expect(move).toHaveBeenCalledWith({root: 'work', nodeId: 'a', toTier: '2nd'});
		await expect(res.json()).resolves.toMatchObject({event: {verb: 'move', toTier: '2nd'}});
	});

	it('rejects a body missing to_tier instead of guessing a destination', async () => {
		const move = vi.fn();
		const app = makeApp({move});
		const res = await app.fetch(
			new Request('http://x/api/v1/ladder/move', {
				method: 'POST',
				headers: {'content-type': 'application/json'},
				body: JSON.stringify({root: 'work', node_id: 'a'}),
			}),
		);
		expect(res.status).toBe(400);
		expect(move).not.toHaveBeenCalled();
	});

	it('reports a rejected move as 400 with the reason, not a 500', async () => {
		const app = makeApp({
			move: async () => {
				throw new Error('no tier 9th on the work ladder');
			},
		});
		const res = await app.fetch(
			new Request('http://x/api/v1/ladder/move', {
				method: 'POST',
				headers: {'content-type': 'application/json'},
				body: JSON.stringify({root: 'work', node_id: 'a', to_tier: '9th'}),
			}),
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({error: 'no tier 9th on the work ladder'});
	});
});

describe('POST /api/v1/ladder/complete', () => {
	it('completes through the service', async () => {
		const complete = vi.fn(async () => ({
			verb: 'complete',
			nodeId: 'a',
			name: 'A',
			fromTier: '1st',
			toTier: null,
			at: 'T',
		}));
		const app = makeApp({complete});
		const res = await app.fetch(
			new Request('http://x/api/v1/ladder/complete', {
				method: 'POST',
				headers: {'content-type': 'application/json'},
				body: JSON.stringify({root: 'work', node_id: 'a'}),
			}),
		);
		expect(res.status).toBe(200);
		expect(complete).toHaveBeenCalledWith({root: 'work', nodeId: 'a'});
	});
});
