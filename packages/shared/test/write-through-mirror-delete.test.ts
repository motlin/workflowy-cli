import DatabaseConstructor from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {and, eq} from 'drizzle-orm';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WorkflowyApiClient} from '../src/api/workflowy-client.js';
import {CacheService} from '../src/cache/cache-service.js';
import {deletePlanCalls} from '../src/cache/delete-plan.js';
import {WorkflowyWriteThroughClient} from '../src/cache/workflowy-write-through-client.js';
import * as schema from '../src/db/schema.js';
import {mirrors, nodeContent, nodeMetadata} from '../src/db/schema.js';
import {FAR_FUTURE_DATE} from '../src/temporal/constants.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
const SEEDED_AT = '2026-01-01 00:00:00.000';

/*
 * Siblings are listed in priority order.
 *
 * projects
 *   task-y          (original of mirror-y, whose only mirror sits inside task-a)
 *   mirror-in       (mirror of other-original, which lives outside)
 *   task-a          (original of mirror-nested and mirror-out)
 *     task-a1       (original of mirror-a1)
 *     mirror-y      (mirror of task-y)
 *   task-b
 *     mirror-nested (mirror of task-a, inside projects too)
 * agendas
 *   agenda-1
 *   mirror-out      (mirror of task-a)
 *   agenda-2
 *   agenda-3
 * other
 *   other-original
 *   mirror-a1       (mirror of task-a1)
 */
const TREE: Array<[id: string, parentId: string | null]> = [
	['projects', null],
	['task-y', 'projects'],
	['mirror-in', 'projects'],
	['task-a', 'projects'],
	['task-a1', 'task-a'],
	['mirror-y', 'task-a'],
	['task-b', 'projects'],
	['mirror-nested', 'task-b'],
	['agendas', null],
	['agenda-1', 'agendas'],
	['mirror-out', 'agendas'],
	['agenda-2', 'agendas'],
	['agenda-3', 'agendas'],
	['other', null],
	['other-original', 'other'],
	['mirror-a1', 'other'],
];
const MIRRORS: Array<[originalId: string, mirrorId: string]> = [
	['other-original', 'mirror-in'],
	['task-a', 'mirror-nested'],
	['task-a', 'mirror-out'],
	['task-a1', 'mirror-a1'],
	['task-y', 'mirror-y'],
];

/** Each parent's children in TREE order, which is also their priority order. */
function childLists(): Map<string | null, string[]> {
	const lists = new Map<string | null, string[]>();
	for (const [id, parentId] of TREE) lists.set(parentId, [...(lists.get(parentId) ?? []), id]);
	return lists;
}

const INITIAL_OUTLINE = {
	root: ['projects', 'agendas', 'other'],
	projects: ['task-y', 'mirror-in', 'task-a', 'task-b'],
	'task-a': ['task-a1', 'mirror-y'],
	'task-b': ['mirror-nested'],
	agendas: ['agenda-1', 'mirror-out', 'agenda-2', 'agenda-3'],
	other: ['other-original', 'mirror-a1'],
};

/**
 * @param failCall A `METHOD /path` call the fake server answers with a 500.
 */
function setup(failCall?: string) {
	const sqlite = new DatabaseConstructor(':memory:');
	const database = drizzle(sqlite, {schema});
	migrate(database, {migrationsFolder});
	const seededLists = childLists();
	database
		.insert(nodeContent)
		.values(
			TREE.map(([id, parentId]) => ({
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
			TREE.map(([id, parentId]) => ({
				nodeId: id,
				priority: seededLists.get(parentId)!.indexOf(id),
				systemFrom: SEEDED_AT,
				systemTo: FAR_FUTURE_DATE,
			})),
		)
		.run();
	database
		.insert(mirrors)
		.values(
			MIRRORS.map(([originalId, mirrorId]) => ({
				originalId,
				mirrorId,
				systemFrom: SEEDED_AT,
				systemTo: FAR_FUTURE_DATE,
			})),
		)
		.run();

	// A fake Workflowy that tracks each parent's ordered children, so moves and GETs agree.
	const server = childLists();
	const parentOf = (id: string) => [...server].find(([, ids]) => ids.includes(id))?.[0] ?? null;
	const detach = (id: string) => {
		for (const ids of server.values()) {
			const index = ids.indexOf(id);
			if (index !== -1) ids.splice(index, 1);
		}
	};

	const calls: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			const path = url.replace('https://workflowy.test/api/v1', '');
			const call = `${method} ${path}`;
			calls.push(init?.body === undefined ? call : `${call} ${init.body as string}`);
			if (call === failCall) {
				return new Response('{"code":"server_error"}', {status: 500, statusText: 'Internal Server Error'});
			}
			const id = path.split('/')[2];
			if (method === 'DELETE') {
				detach(id);
			} else if (method === 'POST' && path.endsWith('/move')) {
				const body = JSON.parse(init?.body as string) as {parent_id: string; position: 'top' | 'bottom'};
				detach(id);
				const siblings = server.get(body.parent_id) ?? [];
				server.set(body.parent_id, body.position === 'top' ? [id, ...siblings] : [...siblings, id]);
			} else if (method === 'GET') {
				const parentId = parentOf(id);
				const node = {
					id,
					name: id,
					note: null,
					parent_id: parentId,
					priority: server.get(parentId)!.indexOf(id),
					completed: false,
					createdAt: 0,
					modifiedAt: 0,
					completedAt: null,
				};
				return new Response(JSON.stringify({node}), {status: 200});
			}
			return new Response('{"status":"ok"}', {status: 200});
		}),
	);
	const apiClient = new WorkflowyApiClient('test-key', undefined, 'https://workflowy.test', {
		maxRetries: 0,
		baseDelayMs: 0,
		maxDelayMs: 0,
	});
	const client = new WorkflowyWriteThroughClient(apiClient, new CacheService(database));

	/** Each cached parent's current children in priority order (roots under `root`), and the current mirrors. */
	const cacheState = () => {
		const rows = database
			.select({id: nodeContent.id, parentId: nodeContent.parentId, priority: nodeMetadata.priority})
			.from(nodeContent)
			.innerJoin(
				nodeMetadata,
				and(eq(nodeMetadata.nodeId, nodeContent.id), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)),
			)
			.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
			.all()
			.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));
		const outline: Record<string, string[]> = {};
		for (const row of rows) (outline[row.parentId ?? 'root'] ??= []).push(row.id);
		return {
			outline,
			mirrors: database
				.select({originalId: mirrors.originalId, mirrorId: mirrors.mirrorId})
				.from(mirrors)
				.where(eq(mirrors.systemTo, FAR_FUTURE_DATE))
				.orderBy(mirrors.mirrorId)
				.all(),
		};
	};

	return {client, calls, cacheState};
}

const PROJECTS_PLAN = {
	mirrorIds: ['mirror-in', 'mirror-nested'],
	promotions: [
		{originalId: 'task-a', mirrorId: 'mirror-out', parentId: 'agendas', position: 'top', siblingIds: ['agenda-1']},
		{originalId: 'task-y', mirrorId: 'mirror-y', parentId: 'task-a', position: 'bottom', siblingIds: []},
	],
	nodeId: 'projects',
};

describe('WorkflowyWriteThroughClient.deleteNode with mirrors', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('removes a mirror through the mirror endpoint, which also drops it from its original', async () => {
		const {client, calls, cacheState} = setup();

		const plan = await client.deleteNode('mirror-out');

		expect({plan, calls, cache: cacheState()}).toStrictEqual({
			plan: {mirrorIds: ['mirror-out'], promotions: [], nodeId: null},
			calls: ['DELETE /nodes/mirror-out/mirror'],
			cache: {
				outline: {...INITIAL_OUTLINE, agendas: ['agenda-1', 'agenda-2', 'agenda-3']},
				mirrors: [
					{originalId: 'task-a1', mirrorId: 'mirror-a1'},
					{originalId: 'other-original', mirrorId: 'mirror-in'},
					{originalId: 'task-a', mirrorId: 'mirror-nested'},
					{originalId: 'task-y', mirrorId: 'mirror-y'},
				],
			},
		});
	});

	it('keeps originals with mirrors elsewhere by moving them into a mirror slot, as the web app does, before deleting the rest', async () => {
		const {client, calls, cacheState} = setup();

		const plan = await client.deleteNode('projects');

		expect({plan, calls, cache: cacheState()}).toStrictEqual({
			plan: PROJECTS_PLAN,
			calls: [
				'DELETE /nodes/mirror-in/mirror',
				'DELETE /nodes/mirror-nested/mirror',
				'DELETE /nodes/mirror-out/mirror',
				'POST /nodes/task-a/move {"parent_id":"agendas","position":"top"}',
				'GET /nodes/task-a',
				'POST /nodes/agenda-1/move {"parent_id":"agendas","position":"top"}',
				'GET /nodes/agenda-1',
				'GET /nodes/task-a',
				'DELETE /nodes/mirror-y/mirror',
				'POST /nodes/task-y/move {"parent_id":"task-a","position":"bottom"}',
				'GET /nodes/task-y',
				'DELETE /nodes/projects',
			],
			cache: {
				outline: {
					root: ['agendas', 'other'],
					agendas: ['agenda-1', 'task-a', 'agenda-2', 'agenda-3'],
					'task-a': ['task-a1', 'task-y'],
					other: ['other-original', 'mirror-a1'],
				},
				mirrors: [{originalId: 'task-a1', mirrorId: 'mirror-a1'}],
			},
		});
	});

	it('moves a target with several mirrors elsewhere into the first one in outline order, leaves the others mirroring it, and deletes nothing', async () => {
		const {client, calls, cacheState} = setup();

		const plan = await client.deleteNode('task-a');

		expect({plan, calls, cache: cacheState()}).toStrictEqual({
			plan: {
				mirrorIds: [],
				promotions: [
					{
						originalId: 'task-a',
						mirrorId: 'mirror-nested',
						parentId: 'task-b',
						position: 'top',
						siblingIds: [],
					},
				],
				nodeId: null,
			},
			calls: [
				'DELETE /nodes/mirror-nested/mirror',
				'POST /nodes/task-a/move {"parent_id":"task-b","position":"top"}',
				'GET /nodes/task-a',
			],
			cache: {
				outline: {
					...INITIAL_OUTLINE,
					projects: ['task-y', 'mirror-in', 'task-b'],
					'task-b': ['task-a'],
				},
				mirrors: [
					{originalId: 'task-a1', mirrorId: 'mirror-a1'},
					{originalId: 'other-original', mirrorId: 'mirror-in'},
					{originalId: 'task-a', mirrorId: 'mirror-out'},
					{originalId: 'task-y', mirrorId: 'mirror-y'},
				],
			},
		});
	});

	it('deletes a node without mirrors through the generic endpoint only', async () => {
		const {client, calls} = setup();

		const plan = await client.deleteNode('agenda-2');

		expect({plan, calls}).toStrictEqual({
			plan: {mirrorIds: [], promotions: [], nodeId: 'agenda-2'},
			calls: ['DELETE /nodes/agenda-2'],
		});
	});

	it('plans a delete without calling the API or touching the cache', async () => {
		const {client, calls, cacheState} = setup();
		const before = cacheState();

		const plan = await client.planDelete('projects');

		expect({plan, calls, cache: cacheState()}).toStrictEqual({plan: PROJECTS_PLAN, calls: [], cache: before});
	});

	it('lists the API calls of a plan in the order they are made', () => {
		expect(deletePlanCalls(PROJECTS_PLAN as Parameters<typeof deletePlanCalls>[0])).toStrictEqual([
			{method: 'DELETE', path: '/nodes/mirror-in/mirror'},
			{method: 'DELETE', path: '/nodes/mirror-nested/mirror'},
			{method: 'DELETE', path: '/nodes/mirror-out/mirror'},
			{method: 'POST', path: '/nodes/task-a/move', body: {parent_id: 'agendas', position: 'top'}},
			{method: 'POST', path: '/nodes/agenda-1/move', body: {parent_id: 'agendas', position: 'top'}},
			{method: 'DELETE', path: '/nodes/mirror-y/mirror'},
			{method: 'POST', path: '/nodes/task-y/move', body: {parent_id: 'task-a', position: 'bottom'}},
			{method: 'DELETE', path: '/nodes/projects'},
		]);
	});

	it('does not send the generic delete when removing an inner mirror fails, so no dead reference is left', async () => {
		const {client, calls, cacheState} = setup('DELETE /nodes/mirror-nested/mirror');

		await expect(client.deleteNode('projects')).rejects.toThrow(
			'Failed to delete mirror: 500 Internal Server Error\n{"code":"server_error"}',
		);

		expect({calls, cache: cacheState()}).toStrictEqual({
			calls: ['DELETE /nodes/mirror-in/mirror', 'DELETE /nodes/mirror-nested/mirror'],
			cache: {
				outline: {...INITIAL_OUTLINE, projects: ['task-y', 'task-a', 'task-b']},
				mirrors: [
					{originalId: 'task-a1', mirrorId: 'mirror-a1'},
					{originalId: 'task-a', mirrorId: 'mirror-nested'},
					{originalId: 'task-a', mirrorId: 'mirror-out'},
					{originalId: 'task-y', mirrorId: 'mirror-y'},
				],
			},
		});
	});

	it('does not send the generic delete when moving a kept original fails, so its content survives', async () => {
		const {client, calls, cacheState} = setup('POST /nodes/task-a/move');

		await expect(client.deleteNode('projects')).rejects.toThrow(
			'Failed to move node: 500 Internal Server Error\n{"code":"server_error"}',
		);

		expect({calls, cache: cacheState()}).toStrictEqual({
			calls: [
				'DELETE /nodes/mirror-in/mirror',
				'DELETE /nodes/mirror-nested/mirror',
				'DELETE /nodes/mirror-out/mirror',
				'POST /nodes/task-a/move {"parent_id":"agendas","position":"top"}',
			],
			cache: {
				outline: {
					root: ['projects', 'agendas', 'other'],
					projects: ['task-y', 'task-a', 'task-b'],
					'task-a': ['task-a1', 'mirror-y'],
					agendas: ['agenda-1', 'agenda-2', 'agenda-3'],
					other: ['other-original', 'mirror-a1'],
				},
				mirrors: [
					{originalId: 'task-a1', mirrorId: 'mirror-a1'},
					{originalId: 'task-y', mirrorId: 'mirror-y'},
				],
			},
		});
	});
});
