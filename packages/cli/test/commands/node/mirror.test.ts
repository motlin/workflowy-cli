import {captureOutput} from '@oclif/test';
import {mirrors, nodeContent, nodeMetadata} from '@workflowy/shared/db';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import {and, eq} from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {MockInstance} from 'vite-plus/test';
import Mirror from '../../../src/commands/node/mirror.js';
import {cleanupTestDatabase, createTestDatabase, seedTestData, type TestDatabase} from '../../db/migration-helper.js';
import {createTestNode} from '../../helpers/node-fixtures.js';

const ORIGIN_ID = '10e2d6c2-d165-b390-9484-d4fdbf4c4afa';
const PARENT_ID = 'a71aed23-b0cc-4000-8000-000000000001';
const MIRROR_ID = 'b82bfe34-c1dd-4000-8000-000000000002';

describe('node:mirror command', () => {
	let originalEnv: typeof process.env;
	let fetchStub: MockInstance;
	let tempDir: string;
	let testDatabase: TestDatabase;

	beforeEach(() => {
		originalEnv = {...process.env};

		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-mirror-test-'));
		const testDbPath = path.join(tempDir, 'test.sqlite');
		testDatabase = createTestDatabase(testDbPath);
		process.env.WORKFLOWY_DB_PATH = testDbPath;
		process.env.WORKFLOWY_API_KEY = 'test-api-key';
		delete process.env.WORKFLOWY_API_URL;

		fetchStub = vi.spyOn(globalThis, 'fetch');

		seedTestData(testDatabase, {
			nodes: [
				createTestNode({id: ORIGIN_ID, name: 'Origin Task', parentId: null}),
				createTestNode({id: PARENT_ID, name: 'Agendas', parentId: null}),
			],
		});
	});

	afterEach(() => {
		process.env = originalEnv;
		fetchStub.mockRestore();
		cleanupTestDatabase(testDatabase);
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, {recursive: true, force: true});
		}
	});

	function stubCreateMirrorApi(): Array<{method: string; url: string; body: unknown}> {
		const calls: Array<{method: string; url: string; body: unknown}> = [];
		fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
			const urlStr = String(url);
			const method = init?.method ?? 'GET';
			calls.push({method, url: urlStr, body: init?.body ? JSON.parse(init.body as string) : undefined});

			if (method === 'POST' && urlStr.endsWith(`/nodes/${ORIGIN_ID}/mirror`)) {
				return new Response(JSON.stringify({item_id: MIRROR_ID, origin_id: ORIGIN_ID}), {status: 200});
			}
			if (method === 'GET' && urlStr.endsWith(`/nodes/${MIRROR_ID}`)) {
				return new Response(
					JSON.stringify({
						node: {
							id: MIRROR_ID,
							name: 'Origin Task',
							parent_id: PARENT_ID,
							priority: 3,
							completed: false,
							createdAt: 1_760_000_000,
							modifiedAt: 1_760_000_000,
							completedAt: null,
							data: {},
						},
					}),
					{status: 200},
				);
			}
			return new Response('unexpected', {status: 500});
		});
		return calls;
	}

	function currentMirrorRows() {
		return testDatabase.db
			.select({originalId: mirrors.originalId, mirrorId: mirrors.mirrorId})
			.from(mirrors)
			.where(eq(mirrors.systemTo, FAR_FUTURE_DATE))
			.all();
	}

	function currentContent(id: string) {
		return testDatabase.db
			.select({
				id: nodeContent.id,
				name: nodeContent.name,
				note: nodeContent.note,
				parentId: nodeContent.parentId,
			})
			.from(nodeContent)
			.where(and(eq(nodeContent.id, id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
			.all();
	}

	describe('flag validation', () => {
		it('requires an origin node', async () => {
			await expect(Mirror.run(['--parent-id', PARENT_ID])).rejects.toThrow(
				'Either --node-id or --node-path is required',
			);
		});

		it('requires a parent when creating', async () => {
			await expect(Mirror.run(['--node-id', ORIGIN_ID])).rejects.toThrow(
				'Either --parent-id or --parent-path is required',
			);
		});

		it('requires WORKFLOWY_API_KEY', async () => {
			delete process.env.WORKFLOWY_API_KEY;
			await expect(Mirror.run(['--node-id', ORIGIN_ID, '--parent-id', PARENT_ID])).rejects.toThrow(
				'WORKFLOWY_API_KEY environment variable is required',
			);
		});
	});

	describe('creating a mirror', () => {
		it('posts to the mirror endpoint with short IDs expanded and position top by default', async () => {
			const calls = stubCreateMirrorApi();

			const {stdout} = await captureOutput(async () => {
				await Mirror.run(['--node-id', 'd4fdbf4c4afa', '--parent-id', '000000000001']);
			});

			expect(calls[0]).toStrictEqual({
				method: 'POST',
				url: `https://workflowy.com/api/v1/nodes/${ORIGIN_ID}/mirror`,
				body: {parent_id: PARENT_ID, position: 'top'},
			});
			expect(stdout).toBe(
				`Mirroring:\n  Origin: Origin Task\n  Into:   Agendas\nSuccessfully created mirror\n  ID: ${MIRROR_ID}\n  Origin: ${ORIGIN_ID}\n`,
			);
		});

		it('passes --position bottom through', async () => {
			const calls = stubCreateMirrorApi();

			await captureOutput(async () => {
				await Mirror.run(['--node-id', ORIGIN_ID, '--parent-id', PARENT_ID, '--position', 'bottom']);
			});

			expect(calls[0].body).toStrictEqual({parent_id: PARENT_ID, position: 'bottom'});
		});

		it('writes the empty mirror node and mirror relationship through to the cache', async () => {
			stubCreateMirrorApi();

			await captureOutput(async () => {
				await Mirror.run(['--node-id', ORIGIN_ID, '--parent-id', PARENT_ID]);
			});

			expect(currentContent(MIRROR_ID)).toStrictEqual([
				{id: MIRROR_ID, name: '', note: null, parentId: PARENT_ID},
			]);
			const metadata = testDatabase.db
				.select({priority: nodeMetadata.priority})
				.from(nodeMetadata)
				.where(and(eq(nodeMetadata.nodeId, MIRROR_ID), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)))
				.all();
			expect(metadata).toStrictEqual([{priority: 3}]);
			expect(currentMirrorRows()).toStrictEqual([{originalId: ORIGIN_ID, mirrorId: MIRROR_ID}]);
		});

		it('emits JSON with --json', async () => {
			stubCreateMirrorApi();

			const {stdout} = await captureOutput(async () => {
				await Mirror.run(['--node-id', ORIGIN_ID, '--parent-id', PARENT_ID, '--json']);
			});

			expect(JSON.parse(stdout)).toStrictEqual({
				action: 'created',
				mirrorId: MIRROR_ID,
				originId: ORIGIN_ID,
				parentId: PARENT_ID,
			});
		});
	});

	describe('deleting a mirror', () => {
		beforeEach(() => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: ORIGIN_ID, name: 'Origin Task', parentId: null}),
					createTestNode({id: PARENT_ID, name: 'Agendas', parentId: null}),
					createTestNode({id: MIRROR_ID, name: '', parentId: PARENT_ID}),
				],
				mirrors: [
					{originalId: ORIGIN_ID, mirrorId: MIRROR_ID, systemFrom: '2026-01-01', systemTo: FAR_FUTURE_DATE},
				],
			});
		});

		it('sends DELETE to the mirror endpoint and removes the mirror from the cache', async () => {
			const calls: Array<{method: string; url: string}> = [];
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				calls.push({method: init?.method ?? 'GET', url: String(url)});
				return new Response(JSON.stringify({status: 'ok'}), {status: 200});
			});

			const {stdout} = await captureOutput(async () => {
				await Mirror.run(['--node-id', '000000000002', '--delete']);
			});

			expect(calls).toStrictEqual([
				{method: 'DELETE', url: `https://workflowy.com/api/v1/nodes/${MIRROR_ID}/mirror`},
			]);
			expect(stdout).toBe(`Successfully deleted mirror ${MIRROR_ID}\n`);
			expect(currentContent(MIRROR_ID)).toStrictEqual([]);
			expect(currentMirrorRows()).toStrictEqual([]);
			expect(currentContent(ORIGIN_ID)).toStrictEqual([
				{id: ORIGIN_ID, name: 'Origin Task', note: null, parentId: null},
			]);
		});

		it('rejects --delete combined with a parent', async () => {
			await expect(Mirror.run(['--node-id', MIRROR_ID, '--delete', '--parent-id', PARENT_ID])).rejects.toThrow();
		});
	});
});
