import {captureOutput} from '@oclif/test';
import {mirrors, nodeContent} from '@workflowy/shared/db';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import {eq} from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {MockInstance} from 'vite-plus/test';
import Delete from '../../../src/commands/node/delete.js';
import {cleanupTestDatabase, createTestDatabase, seedTestData, type TestDatabase} from '../../db/migration-helper.js';
import {createTestNode} from '../../helpers/node-fixtures.js';

describe('node delete command', () => {
	let originalEnv: typeof process.env;
	let fetchStub: MockInstance;
	let tempDir: string;
	let testDatabase: TestDatabase;

	beforeEach(() => {
		originalEnv = {...process.env};

		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-delete-test-'));
		const testDbPath = path.join(tempDir, 'test.sqlite');
		testDatabase = createTestDatabase(testDbPath);
		process.env.WORKFLOWY_DB_PATH = testDbPath;
		process.env.WORKFLOWY_API_KEY = 'test-api-key';

		fetchStub = vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		process.env = originalEnv;

		cleanupTestDatabase(testDatabase);

		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, {recursive: true, force: true});
		}
	});

	describe('environment variable validation', () => {
		it('requires WORKFLOWY_API_KEY', async () => {
			delete process.env.WORKFLOWY_API_KEY;

			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'node-id', name: 'Test', parentId: null})],
			});

			await expect(Delete.run(['--id', 'node-id'])).rejects.toThrow(
				'WORKFLOWY_API_KEY environment variable is required',
			);
		});
	});

	describe('flag validation', () => {
		it('requires either --id or --path', async () => {
			await expect(Delete.run([])).rejects.toThrow('Either --id or --path is required');
		});
	});

	describe('dry run mode', () => {
		it('shows API call without executing', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'node-id', name: 'Test Node', parentId: null})],
			});

			const {stdout} = await captureOutput(async () => {
				await Delete.run(['--id', 'node-id', '--dry-run']);
			});

			expect(stdout).toBe(
				'Would execute API calls:\n  DELETE https://workflowy.com/api/v1/nodes/node-id\n  Headers:\n    Authorization: Bearer <WORKFLOWY_API_KEY>\n\nNode: Test Node\n\nWARNING: This will permanently delete the node and all its children!\n',
			);
			expect(fetchStub.mock.calls).toStrictEqual([]);
		});

		it('shows full path in dry run output', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'work-id', name: 'Work', parentId: null}),
					createTestNode({id: 'tasks-id', name: 'Tasks', parentId: 'work-id'}),
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Delete.run(['--id', 'tasks-id', '--dry-run']);
			});

			expect(stdout).toBe(
				'Would execute API calls:\n  DELETE https://workflowy.com/api/v1/nodes/tasks-id\n  Headers:\n    Authorization: Bearer <WORKFLOWY_API_KEY>\n\nNode: Work > Tasks\n\nWARNING: This will permanently delete the node and all its children!\n',
			);
		});
	});

	describe('deleting by ID', () => {
		it('sends DELETE request to correct URL', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'delete-id', name: 'To Delete', parentId: null})],
			});

			let capturedUrl: string | undefined;
			let capturedMethod: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				capturedUrl = url instanceof Request ? url.url : String(url);
				capturedMethod = init?.method;
				return new Response(JSON.stringify({}), {status: 200});
			});

			await captureOutput(async () => {
				try {
					await Delete.run(['--id', 'delete-id']);
				} catch {
					// Ignore errors from cache update
				}
			});

			expect(capturedUrl).toBe('https://workflowy.com/api/v1/nodes/delete-id');
			expect(capturedMethod).toBe('DELETE');
		});
	});

	describe('deleting by path', () => {
		it('resolves path to correct node ID', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'work-id', name: 'Work', parentId: null}),
					createTestNode({id: 'tasks-id', name: 'Tasks', parentId: 'work-id'}),
					createTestNode({id: 'target-id', name: 'Old Task', parentId: 'tasks-id'}),
				],
			});

			let capturedUrl: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, _init?: RequestInit) => {
				capturedUrl = url instanceof Request ? url.url : String(url);
				return new Response(JSON.stringify({}), {status: 200});
			});

			await captureOutput(async () => {
				try {
					await Delete.run(['--path', 'Work,Tasks,Old Task']);
				} catch {
					// Ignore errors from cache update
				}
			});

			expect(capturedUrl).toBe('https://workflowy.com/api/v1/nodes/target-id');
		});

		it('errors when path not found', async () => {
			// Cache is empty, API returns empty children for root (path not found)
			fetchStub.mockResolvedValue(new Response(JSON.stringify({nodes: []}), {status: 200}));

			await expect(Delete.run(['--path', 'Missing,Path'])).rejects.toThrow(
				'Node not found at path: Missing > Path',
			);
		});
	});

	describe('output', () => {
		it('displays full path when deleting', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'work-id', name: 'Work', parentId: null}),
					createTestNode({id: 'target-id', name: 'Target', parentId: 'work-id'}),
				],
			});

			fetchStub.mockResolvedValue(new Response(JSON.stringify({}), {status: 200}));

			const {stdout} = await captureOutput(async () => {
				try {
					await Delete.run(['--id', 'target-id']);
				} catch {
					// Ignore errors from cache update
				}
			});

			expect(stdout).toBe(
				'Deleting node: Work > Target\n\nWARNING: This will permanently delete the node and all its children!\n\nSuccessfully deleted node\n',
			);
		});
	});

	describe('mirrors', () => {
		beforeEach(() => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'projects-id', name: 'Projects', parentId: null}),
					createTestNode({id: 'mirror-in-id', name: '', parentId: 'projects-id'}),
					createTestNode({id: 'task-a-id', name: 'Task A', parentId: 'projects-id'}),
					createTestNode({id: 'task-b-id', name: 'Task B', parentId: 'projects-id'}),
					createTestNode({id: 'mirror-nested-id', name: '', parentId: 'task-b-id'}),
					createTestNode({id: 'agendas-id', name: 'Agendas', parentId: null}),
					createTestNode({id: 'mirror-out-id', name: '', parentId: 'agendas-id'}),
					createTestNode({id: 'other-id', name: 'Other', parentId: null}),
					createTestNode({id: 'other-original-id', name: 'Other Original', parentId: 'other-id'}),
				],
				mirrors: [
					{
						originalId: 'other-original-id',
						mirrorId: 'mirror-in-id',
						systemFrom: '2026-01-01',
						systemTo: FAR_FUTURE_DATE,
					},
					{
						originalId: 'task-a-id',
						mirrorId: 'mirror-nested-id',
						systemFrom: '2026-01-01',
						systemTo: FAR_FUTURE_DATE,
					},
					{
						originalId: 'task-a-id',
						mirrorId: 'mirror-out-id',
						systemFrom: '2026-01-01',
						systemTo: FAR_FUTURE_DATE,
					},
				],
			});
		});

		function recordCalls(): string[] {
			const calls: string[] = [];
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				calls.push(`${init?.method ?? 'GET'} ${url instanceof Request ? url.url : url.toString()}`);
				return new Response(JSON.stringify({status: 'ok'}), {status: 200});
			});
			return calls;
		}

		function cacheState() {
			return {
				nodeIds: testDatabase.db
					.select({id: nodeContent.id})
					.from(nodeContent)
					.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
					.orderBy(nodeContent.id)
					.all()
					.map((row) => row.id),
				mirrors: testDatabase.db
					.select({originalId: mirrors.originalId, mirrorId: mirrors.mirrorId})
					.from(mirrors)
					.where(eq(mirrors.systemTo, FAR_FUTURE_DATE))
					.orderBy(mirrors.mirrorId)
					.all(),
			};
		}

		it('dry run shows inner mirrors removed through the mirror endpoint first, and mirrors left elsewhere', async () => {
			const calls = recordCalls();

			const {stdout} = await captureOutput(async () => {
				await Delete.run(['--id', 'projects-id', '--dry-run']);
			});

			expect({stdout, calls}).toStrictEqual({
				stdout: [
					'Would execute API calls:',
					'  DELETE https://workflowy.com/api/v1/nodes/mirror-in-id/mirror',
					'  DELETE https://workflowy.com/api/v1/nodes/mirror-nested-id/mirror',
					'  DELETE https://workflowy.com/api/v1/nodes/projects-id',
					'  Headers:',
					'    Authorization: Bearer <WORKFLOWY_API_KEY>',
					'',
					'Node: Projects',
					'',
					'Mirrors removed first through the mirror endpoint, so their originals drop the reference:',
					'  Projects > Other Original',
					'  Projects > Task B > Task A',
					'',
					'Mirrors elsewhere of nodes being deleted, left in place:',
					'  Agendas > Task A',
					'',
					'WARNING: This will permanently delete the node and all its children!',
					'',
				].join('\n'),
				calls: [],
			});
		});

		it('dry run on a mirror shows only the mirror endpoint call', async () => {
			const calls = recordCalls();

			const {stdout} = await captureOutput(async () => {
				await Delete.run(['--id', 'mirror-out-id', '--dry-run']);
			});

			expect({stdout, calls}).toStrictEqual({
				stdout: [
					'Would execute API calls:',
					'  DELETE https://workflowy.com/api/v1/nodes/mirror-out-id/mirror',
					'  Headers:',
					'    Authorization: Bearer <WORKFLOWY_API_KEY>',
					'',
					'Node: Agendas > Task A',
					'',
					"WARNING: This removes only this mirror; its original and the original's children are kept.",
					'',
				].join('\n'),
				calls: [],
			});
		});

		it('removes inner mirrors through the mirror endpoint before deleting the node, and updates the cache', async () => {
			const calls = recordCalls();

			const {stdout} = await captureOutput(async () => {
				await Delete.run(['--id', 'projects-id']);
			});

			expect({stdout, calls, cache: cacheState()}).toStrictEqual({
				stdout: [
					'Deleting node: Projects',
					'',
					'Mirrors removed first through the mirror endpoint, so their originals drop the reference:',
					'  Projects > Other Original',
					'  Projects > Task B > Task A',
					'',
					'Mirrors elsewhere of nodes being deleted, left in place:',
					'  Agendas > Task A',
					'',
					'WARNING: This will permanently delete the node and all its children!',
					'',
					'Successfully deleted node',
					'',
				].join('\n'),
				calls: [
					'DELETE https://workflowy.com/api/v1/nodes/mirror-in-id/mirror',
					'DELETE https://workflowy.com/api/v1/nodes/mirror-nested-id/mirror',
					'DELETE https://workflowy.com/api/v1/nodes/projects-id',
				],
				cache: {nodeIds: ['agendas-id', 'mirror-out-id', 'other-id', 'other-original-id'], mirrors: []},
			});
		});

		it('removes a mirror through the mirror endpoint', async () => {
			const calls = recordCalls();

			const {stdout} = await captureOutput(async () => {
				await Delete.run(['--id', 'mirror-out-id']);
			});

			expect({stdout, calls, cache: cacheState()}).toStrictEqual({
				stdout: [
					'Removing mirror: Agendas > Task A',
					'',
					"WARNING: This removes only this mirror; its original and the original's children are kept.",
					'',
					'Successfully removed mirror',
					'',
				].join('\n'),
				calls: ['DELETE https://workflowy.com/api/v1/nodes/mirror-out-id/mirror'],
				cache: {
					nodeIds: [
						'agendas-id',
						'mirror-in-id',
						'mirror-nested-id',
						'other-id',
						'other-original-id',
						'projects-id',
						'task-a-id',
						'task-b-id',
					],
					mirrors: [
						{originalId: 'other-original-id', mirrorId: 'mirror-in-id'},
						{originalId: 'task-a-id', mirrorId: 'mirror-nested-id'},
					],
				},
			});
		});
	});

	describe('command metadata', () => {
		it('has correct description', () => {
			expect(Delete.description).toBe('Delete a Workflowy node');
		});

		it('has examples', () => {
			expect(Delete.examples).toStrictEqual([
				'# Delete node by ID',
				'<%= config.bin %> <%= command.id %> --id abc123',
				'',
				'# Delete node by path',
				'<%= config.bin %> <%= command.id %> --path "Work,Tasks,Completed Task"',
				'',
				'# Preview the API calls without deleting',
				'<%= config.bin %> <%= command.id %> --id abc123 --dry-run',
			]);
		});
	});
});
