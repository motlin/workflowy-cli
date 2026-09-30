import DatabaseConstructor from 'better-sqlite3';
import {and, eq} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WorkflowyApiClient} from '../src/api/workflowy-client.js';
import {CacheService} from '../src/cache/cache-service.js';
import {createNodeTree} from '../src/cache/create-node-tree.js';
import {WorkflowyWriteThroughClient} from '../src/cache/workflowy-write-through-client.js';
import * as schema from '../src/db/schema.js';
import {nodeContent, nodeMetadata} from '../src/db/schema.js';
import {FAR_FUTURE_DATE} from '../src/temporal/constants.js';
import {resolveOrCreateNodePath} from '../src/utils/node-resolver.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
const SEEDED_AT = '2026-01-01 00:00:00.000';

/**
 * A cache holding `home` (a root) with one child, `existing`, at priority 100,
 * and a fake Workflowy that numbers new children the way the live API was seen
 * to: 50 below the first on a top create, 100 above the last otherwise.
 */
function setup() {
	const sqlite = new DatabaseConstructor(':memory:');
	const database = drizzle(sqlite, {schema});
	migrate(database, {migrationsFolder});
	const seed: Array<[id: string, parentId: string | null, priority: number]> = [
		['home', null, 0],
		['existing', 'home', 100],
	];
	database
		.insert(nodeContent)
		.values(
			seed.map(([id, parentId]) => ({
				id,
				name: id,
				note: null,
				parentId,
				systemFrom: SEEDED_AT,
				systemTo: FAR_FUTURE_DATE,
			})),
		)
		.run();
	database
		.insert(nodeMetadata)
		.values(
			seed.map(([id, , priority]) => ({
				nodeId: id,
				priority,
				systemFrom: SEEDED_AT,
				systemTo: FAR_FUTURE_DATE,
			})),
		)
		.run();

	const server = new Map(seed.map(([id, parentId, priority]) => [id, {name: id, parentId, priority}]));
	const calls: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			const path = url.replace('https://workflowy.test/api/v1', '');
			calls.push(`${method} ${path}`);
			if (method === 'POST' && path === '/nodes/') {
				const body = JSON.parse(init?.body as string) as {parent_id: string; name: string; position?: string};
				const siblings = [...server.values()]
					.filter((node) => node.parentId === body.parent_id)
					.map((node) => node.priority);
				const priority =
					siblings.length === 0
						? 100
						: body.position === 'top'
							? Math.min(...siblings) - 50
							: Math.max(...siblings) + 100;
				const id = `${body.name}-id`;
				server.set(id, {name: body.name, parentId: body.parent_id, priority});
				return new Response(JSON.stringify({item_id: id}), {status: 200});
			}
			const toApi = (id: string) => {
				const node = server.get(id)!;
				return {
					id,
					name: node.name,
					note: null,
					parent_id: node.parentId,
					priority: node.priority,
					completed: false,
					createdAt: 0,
					modifiedAt: 0,
					completedAt: null,
				};
			};
			if (path.startsWith('/nodes?') || path === '/nodes') {
				const parentId = new URLSearchParams(path.split('?')[1] ?? '').get('parent_id');
				const nodes = [...server].filter(([, node]) => node.parentId === parentId).map(([id]) => toApi(id));
				return new Response(JSON.stringify({nodes}), {status: 200});
			}
			return new Response(JSON.stringify({node: toApi(path.split('/')[2])}), {status: 200});
		}),
	);
	const apiClient = new WorkflowyApiClient('test-key', undefined, 'https://workflowy.test', {
		maxRetries: 0,
		baseDelayMs: 0,
		maxDelayMs: 0,
	});
	const cacheService = new CacheService(database);
	const client = new WorkflowyWriteThroughClient(apiClient, cacheService);

	/** Every current cached node with its parent and priority, ordered by id. */
	const cached = () =>
		database
			.select({id: nodeContent.id, parentId: nodeContent.parentId, priority: nodeMetadata.priority})
			.from(nodeContent)
			.innerJoin(
				nodeMetadata,
				and(eq(nodeMetadata.nodeId, nodeContent.id), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)),
			)
			.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
			.orderBy(nodeContent.id)
			.all();

	return {client, apiClient, cacheService, calls, cached};
}

describe('WorkflowyWriteThroughClient.createNode priorities', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("caches each created node at Workflowy's priority, not a placeholder, so cached sibling order matches", async () => {
		const {client, calls, cached} = setup();

		await client.createNode({parent_id: 'home', name: 'a1', position: 'top'});
		await client.createNode({parent_id: 'home', name: 'a2', position: 'bottom'});
		await client.createNode({parent_id: 'home', name: 'a3', position: 'bottom'});

		expect({calls, cached: cached()}).toStrictEqual({
			calls: [
				'POST /nodes/',
				'GET /nodes/a1-id',
				'POST /nodes/',
				'GET /nodes/a2-id',
				'POST /nodes/',
				'GET /nodes/a3-id',
			],
			cached: [
				{id: 'a1-id', parentId: 'home', priority: 50},
				{id: 'a2-id', parentId: 'home', priority: 200},
				{id: 'a3-id', parentId: 'home', priority: 300},
				{id: 'existing', parentId: 'home', priority: 100},
				{id: 'home', parentId: null, priority: 0},
			],
		});
	});

	it('caches every node of a created tree at its real priority', async () => {
		const {client, cached} = setup();

		await createNodeTree({name: 'tree', children: [{name: 'leaf1'}, {name: 'leaf2'}]}, 'home', client, 'top');

		expect(cached()).toStrictEqual([
			{id: 'existing', parentId: 'home', priority: 100},
			{id: 'home', parentId: null, priority: 0},
			{id: 'leaf1-id', parentId: 'tree-id', priority: 100},
			{id: 'leaf2-id', parentId: 'tree-id', priority: 200},
			{id: 'tree-id', parentId: 'home', priority: 50},
		]);
	});

	it('caches path segments created by resolveOrCreateNodePath at their real priority', async () => {
		const {apiClient, cacheService, cached} = setup();

		const id = await resolveOrCreateNodePath('home,made', cacheService, apiClient);

		expect({id, cached: cached()}).toStrictEqual({
			id: 'made-id',
			cached: [
				{id: 'existing', parentId: 'home', priority: 100},
				{id: 'home', parentId: null, priority: 0},
				{id: 'made-id', parentId: 'home', priority: 200},
			],
		});
	});
});
