import DatabaseConstructor from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {eq} from 'drizzle-orm';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WorkflowyApiClient} from '../src/api/workflowy-client.js';
import {CacheService} from '../src/cache/cache-service.js';
import {WorkflowyWriteThroughClient} from '../src/cache/workflowy-write-through-client.js';
import * as schema from '../src/db/schema.js';
import {mirrors, nodeContent} from '../src/db/schema.js';
import {FAR_FUTURE_DATE} from '../src/temporal/constants.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
const SEEDED_AT = '2026-01-01 00:00:00.000';

/*
 * projects
 *   mirror-in       (mirror of other-original, which lives outside)
 *   task-a          (original of mirror-out and mirror-nested)
 *     task-a1
 *   task-b
 *     mirror-nested (mirror of task-a, whose original is inside projects too)
 * agendas
 *   mirror-out      (mirror of task-a)
 * other
 *   other-original
 */
const TREE: Array<[id: string, parentId: string | null]> = [
	['projects', null],
	['mirror-in', 'projects'],
	['task-a', 'projects'],
	['task-a1', 'task-a'],
	['task-b', 'projects'],
	['mirror-nested', 'task-b'],
	['agendas', null],
	['mirror-out', 'agendas'],
	['other', null],
	['other-original', 'other'],
];
const MIRRORS: Array<[originalId: string, mirrorId: string]> = [
	['other-original', 'mirror-in'],
	['task-a', 'mirror-nested'],
	['task-a', 'mirror-out'],
];

function setup(failMirrorDeleteOf?: string) {
	const sqlite = new DatabaseConstructor(':memory:');
	const database = drizzle(sqlite, {schema});
	migrate(database, {migrationsFolder});
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

	const calls: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const path = url.replace('https://workflowy.test/api/v1', '');
			calls.push(`${init?.method ?? 'GET'} ${path}`);
			if (failMirrorDeleteOf !== undefined && path === `/nodes/${failMirrorDeleteOf}/mirror`) {
				return new Response('{"code":"server_error"}', {status: 500, statusText: 'Internal Server Error'});
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

	const cacheState = () => ({
		nodeIds: database
			.select({id: nodeContent.id})
			.from(nodeContent)
			.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
			.orderBy(nodeContent.id)
			.all()
			.map((row) => row.id),
		mirrors: database
			.select({originalId: mirrors.originalId, mirrorId: mirrors.mirrorId})
			.from(mirrors)
			.where(eq(mirrors.systemTo, FAR_FUTURE_DATE))
			.orderBy(mirrors.mirrorId)
			.all(),
	});

	return {client, calls, cacheState};
}

describe('WorkflowyWriteThroughClient.deleteNode with mirrors', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('removes a mirror through the mirror endpoint, which also drops it from its original', async () => {
		const {client, calls, cacheState} = setup();

		const plan = await client.deleteNode('mirror-out');

		expect({plan, calls, cache: cacheState()}).toStrictEqual({
			plan: {mirrorIds: ['mirror-out'], nodeId: null, outsideMirrorIds: []},
			calls: ['DELETE /nodes/mirror-out/mirror'],
			cache: {
				nodeIds: [
					'agendas',
					'mirror-in',
					'mirror-nested',
					'other',
					'other-original',
					'projects',
					'task-a',
					'task-a1',
					'task-b',
				],
				mirrors: [
					{originalId: 'other-original', mirrorId: 'mirror-in'},
					{originalId: 'task-a', mirrorId: 'mirror-nested'},
				],
			},
		});
	});

	it('removes every mirror inside a subtree through the mirror endpoint before deleting the subtree', async () => {
		const {client, calls, cacheState} = setup();

		const plan = await client.deleteNode('projects');

		expect({plan, calls, cache: cacheState()}).toStrictEqual({
			plan: {mirrorIds: ['mirror-in', 'mirror-nested'], nodeId: 'projects', outsideMirrorIds: ['mirror-out']},
			calls: ['DELETE /nodes/mirror-in/mirror', 'DELETE /nodes/mirror-nested/mirror', 'DELETE /nodes/projects'],
			cache: {nodeIds: ['agendas', 'mirror-out', 'other', 'other-original'], mirrors: []},
		});
	});

	it('leaves mirrors outside the subtree alone when deleting their original', async () => {
		const {client, calls, cacheState} = setup();

		const plan = await client.deleteNode('task-a');

		expect({plan, calls, cache: cacheState()}).toStrictEqual({
			plan: {mirrorIds: [], nodeId: 'task-a', outsideMirrorIds: ['mirror-nested', 'mirror-out']},
			calls: ['DELETE /nodes/task-a'],
			cache: {
				nodeIds: [
					'agendas',
					'mirror-in',
					'mirror-nested',
					'mirror-out',
					'other',
					'other-original',
					'projects',
					'task-b',
				],
				mirrors: [{originalId: 'other-original', mirrorId: 'mirror-in'}],
			},
		});
	});

	it('deletes a node without mirrors through the generic endpoint only', async () => {
		const {client, calls} = setup();

		const plan = await client.deleteNode('task-a1');

		expect({plan, calls}).toStrictEqual({
			plan: {mirrorIds: [], nodeId: 'task-a1', outsideMirrorIds: []},
			calls: ['DELETE /nodes/task-a1'],
		});
	});

	it('plans a delete without calling the API or touching the cache', async () => {
		const {client, calls, cacheState} = setup();
		const before = cacheState();

		const plan = await client.planDelete('projects');

		expect({plan, calls, cache: cacheState()}).toStrictEqual({
			plan: {mirrorIds: ['mirror-in', 'mirror-nested'], nodeId: 'projects', outsideMirrorIds: ['mirror-out']},
			calls: [],
			cache: before,
		});
	});

	it('does not send the generic delete when removing an inner mirror fails, so no dead reference is left', async () => {
		const {client, calls, cacheState} = setup('mirror-nested');

		await expect(client.deleteNode('projects')).rejects.toThrow(
			'Failed to delete mirror: 500 Internal Server Error\n{"code":"server_error"}',
		);

		expect({calls, cache: cacheState()}).toStrictEqual({
			calls: ['DELETE /nodes/mirror-in/mirror', 'DELETE /nodes/mirror-nested/mirror'],
			cache: {
				nodeIds: [
					'agendas',
					'mirror-nested',
					'mirror-out',
					'other',
					'other-original',
					'projects',
					'task-a',
					'task-a1',
					'task-b',
				],
				mirrors: [
					{originalId: 'task-a', mirrorId: 'mirror-nested'},
					{originalId: 'task-a', mirrorId: 'mirror-out'},
				],
			},
		});
	});
});
