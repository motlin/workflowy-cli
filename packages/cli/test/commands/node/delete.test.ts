import {captureOutput} from '@oclif/test';
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

			expect(stdout).toContain('Would execute API call');
			expect(stdout).toContain('Method: DELETE');
			expect(stdout).toContain('https://workflowy.com/api/v1/nodes/node-id');
			expect(stdout).toContain('WARNING: This will permanently delete the node and all its children!');
			expect(fetchStub).not.toHaveBeenCalled();
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

			expect(stdout).toContain('Node: Work > Tasks');
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

			expect(stdout).toContain('Deleting node: Work > Target');
		});
	});

	describe('command metadata', () => {
		it('has correct description', () => {
			expect(Delete.description).toBe('Delete a Workflowy node');
		});

		it('has examples', () => {
			expect(Delete.examples!.length).toBeGreaterThan(0);
		});
	});
});
