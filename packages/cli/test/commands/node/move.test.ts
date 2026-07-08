import {captureOutput} from '@oclif/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {MockInstance} from 'vite-plus/test';
import Move from '../../../src/commands/node/move.js';
import {cleanupTestDatabase, createTestDatabase, seedTestData, type TestDatabase} from '../../db/migration-helper.js';
import {createTestNode} from '../../helpers/node-fixtures.js';

describe('node:move command', () => {
	let originalEnv: typeof process.env;
	let fetchStub: MockInstance;
	let tempDir: string;
	let testDatabase: TestDatabase;

	beforeEach(() => {
		originalEnv = {...process.env};

		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-move-test-'));
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
				nodes: [
					createTestNode({id: 'source-id', name: 'Source', parentId: null}),
					createTestNode({id: 'target-id', name: 'Target', parentId: null}),
				],
			});

			await expect(Move.run(['--node-id', 'source-id', '--parent-id', 'target-id'])).rejects.toThrow(
				'WORKFLOWY_API_KEY environment variable is required',
			);
		});
	});

	describe('flag validation', () => {
		it('requires either --node-id or --node-path', async () => {
			await expect(Move.run(['--parent-id', 'target-id'])).rejects.toThrow(
				'Either --node-id or --node-path is required',
			);
		});

		it('requires a parent flag', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'source-id', name: 'Source', parentId: null})],
			});

			await expect(Move.run(['--node-id', 'source-id'])).rejects.toThrow(
				'Either --parent-id or --parent-path is required',
			);
		});
	});

	describe('dry run mode', () => {
		it('shows move preview without executing', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'source-id', name: 'Source Node', parentId: null}),
					createTestNode({id: 'target-id', name: 'Target Folder', parentId: null}),
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Move.run(['--node-id', 'source-id', '--parent-id', 'target-id', '--dry-run']);
			});

			// Dry run outputs human-readable text
			expect(stdout).toContain('Would move');
			expect(stdout).toContain('Source Node');
			expect(stdout).toContain('Target Folder');
			expect(stdout).toContain('--parent-id');
			expect(fetchStub).not.toHaveBeenCalled();
		});

		it('shows position in dry run output', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'source-id', name: 'Source', parentId: null}),
					createTestNode({id: 'target-id', name: 'Target', parentId: null}),
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Move.run([
					'--node-id',
					'source-id',
					'--parent-id',
					'target-id',
					'--position',
					'bottom',
					'--dry-run',
				]);
			});

			expect(stdout).toContain('Position: bottom');
		});
	});

	describe('moving by ID', () => {
		it('moves node via API', async () => {
			const now = Math.floor(Date.now() / 1000);
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'source-id', name: 'Source', parentId: null}),
					createTestNode({id: 'target-id', name: 'Target', parentId: null}),
				],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				const urlStr = url instanceof Request ? url.url : String(url);
				const method = init?.method ?? 'GET';

				if (method === 'POST') {
					capturedBody = init?.body as string;
					return new Response(JSON.stringify({}), {status: 200});
				}

				if (method === 'GET' && urlStr.includes('/nodes/source-id')) {
					return new Response(
						JSON.stringify({
							node: {
								id: 'source-id',
								name: 'Source',
								parent_id: 'target-id',
								priority: 0,
								completed: false,
								createdAt: now * 1000,
								modifiedAt: now * 1000,
								completedAt: null,
								data: {},
							},
						}),
						{status: 200},
					);
				}

				return new Response(JSON.stringify({}), {status: 404});
			});

			const {stdout} = await captureOutput(async () => {
				await Move.run(['--node-id', 'source-id', '--parent-id', 'target-id']);
			});

			expect(stdout).toContain('Successfully moved');
			const body = JSON.parse(capturedBody!);
			expect(body).toStrictEqual({parent_id: 'target-id'});
		});

		it('includes position in API request for top', async () => {
			const now = Math.floor(Date.now() / 1000);
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'source-id', name: 'Source', parentId: null}),
					createTestNode({id: 'target-id', name: 'Target', parentId: null}),
				],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				const urlStr = url instanceof Request ? url.url : String(url);
				const method = init?.method ?? 'GET';

				if (method === 'POST') {
					capturedBody = init?.body as string;
					return new Response(JSON.stringify({}), {status: 200});
				}

				if (method === 'GET' && urlStr.includes('/nodes/source-id')) {
					return new Response(
						JSON.stringify({
							node: {
								id: 'source-id',
								name: 'Source',
								parent_id: 'target-id',
								priority: -1,
								completed: false,
								createdAt: now * 1000,
								modifiedAt: now * 1000,
								completedAt: null,
								data: {},
							},
						}),
						{status: 200},
					);
				}

				return new Response(JSON.stringify({}), {status: 404});
			});

			await captureOutput(async () => {
				await Move.run(['--node-id', 'source-id', '--parent-id', 'target-id', '--position', 'top']);
			});

			const body = JSON.parse(capturedBody!);
			expect(body.position).toBe('top');
		});

		it('includes position in API request for bottom', async () => {
			const now = Math.floor(Date.now() / 1000);
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'source-id', name: 'Source', parentId: null}),
					createTestNode({id: 'target-id', name: 'Target', parentId: null}),
				],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				const urlStr = url instanceof Request ? url.url : String(url);
				const method = init?.method ?? 'GET';

				if (method === 'POST') {
					capturedBody = init?.body as string;
					return new Response(JSON.stringify({}), {status: 200});
				}

				if (method === 'GET' && urlStr.includes('/nodes/source-id')) {
					return new Response(
						JSON.stringify({
							node: {
								id: 'source-id',
								name: 'Source',
								parent_id: 'target-id',
								priority: 0,
								completed: false,
								createdAt: now * 1000,
								modifiedAt: now * 1000,
								completedAt: null,
								data: {},
							},
						}),
						{status: 200},
					);
				}

				return new Response(JSON.stringify({}), {status: 404});
			});

			await captureOutput(async () => {
				await Move.run(['--node-id', 'source-id', '--parent-id', 'target-id', '--position', 'bottom']);
			});

			const body = JSON.parse(capturedBody!);
			expect(body.position).toBe('bottom');
		});
	});

	describe('moving by path', () => {
		it('resolves source and target paths', async () => {
			const now = Math.floor(Date.now() / 1000);
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'work-id', name: 'Work', parentId: null}),
					createTestNode({id: 'tasks-id', name: 'Tasks', parentId: 'work-id'}),
					createTestNode({id: 'source-id', name: 'My Task', parentId: 'tasks-id'}),
					createTestNode({id: 'archive-id', name: 'Archive', parentId: 'work-id'}),
				],
			});

			let capturedUrl: string | undefined;
			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				const urlStr = url instanceof Request ? url.url : String(url);
				const method = init?.method ?? 'GET';
				capturedUrl = urlStr;

				if (method === 'POST') {
					capturedBody = init?.body as string;
					return new Response(JSON.stringify({}), {status: 200});
				}

				if (method === 'GET' && urlStr.includes('/nodes/source-id')) {
					return new Response(
						JSON.stringify({
							node: {
								id: 'source-id',
								name: 'My Task',
								parent_id: 'archive-id',
								priority: 0,
								completed: false,
								createdAt: now * 1000,
								modifiedAt: now * 1000,
								completedAt: null,
								data: {},
							},
						}),
						{status: 200},
					);
				}

				return new Response(JSON.stringify({}), {status: 404});
			});

			const {stdout} = await captureOutput(async () => {
				await Move.run(['--node-path', 'Work,Tasks,My Task', '--parent-path', 'Work,Archive']);
			});

			expect(stdout).toContain('Successfully moved');
			expect(capturedUrl).toBe('https://workflowy.com/api/v1/nodes/source-id');
			const body = JSON.parse(capturedBody!);
			expect(body.parent_id).toBe('archive-id');
		});
	});

	describe('system targets', () => {
		it('moves to inbox system target via --parent-id', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'source-id', name: 'Source', parentId: null})],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				if (init?.body) {
					capturedBody = init.body as string;
				}
				return new Response(JSON.stringify({}), {status: 200});
			});

			await captureOutput(async () => {
				try {
					await Move.run(['--node-id', 'source-id', '--parent-id', 'inbox']);
				} catch {
					// Ignore errors from cache update
				}
			});

			const body = JSON.parse(capturedBody!);
			expect(body).toStrictEqual({parent_id: 'inbox'});
		});
	});

	describe('output', () => {
		it('displays from and to paths', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'work-id', name: 'Work', parentId: null}),
					createTestNode({id: 'source-id', name: 'Source', parentId: 'work-id'}),
					createTestNode({id: 'target-id', name: 'Target', parentId: null}),
				],
			});

			fetchStub.mockResolvedValue(new Response(JSON.stringify({}), {status: 200}));

			const {stdout} = await captureOutput(async () => {
				await Move.run(['--node-id', 'source-id', '--parent-id', 'target-id']);
			});

			expect(stdout).toContain('From:');
			expect(stdout).toContain('To:');
			expect(stdout).toContain('Work');
			expect(stdout).toContain('Source');
			expect(stdout).toContain('Target');
		});
	});

	describe('command metadata', () => {
		it('has correct description', () => {
			expect(Move.description).toBe('Move a single node to a new location by ID or path');
		});

		it('has examples', () => {
			expect(Move.examples!.length).toBeGreaterThan(0);
		});
	});
});
