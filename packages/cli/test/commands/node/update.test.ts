import {captureOutput} from '@oclif/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {MockInstance} from 'vite-plus/test';
import Update from '../../../src/commands/node/update.js';
import {cleanupTestDatabase, createTestDatabase, seedTestData, type TestDatabase} from '../../db/migration-helper.js';
import {createTestNode} from '../../helpers/node-fixtures.js';

describe('node update command', () => {
	let originalEnv: typeof process.env;
	let fetchStub: MockInstance;
	let tempDir: string;
	let testDatabase: TestDatabase;

	beforeEach(() => {
		originalEnv = {...process.env};

		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-update-test-'));
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

			await expect(Update.run(['--id', 'node-id', '--name', 'New Name'])).rejects.toThrow(
				'WORKFLOWY_API_KEY environment variable is required',
			);
		});
	});

	describe('flag validation', () => {
		it('requires either --id or --path', async () => {
			await expect(Update.run(['--name', 'New Name'])).rejects.toThrow('Either --id or --path is required');
		});

		it('requires at least one update field', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'node-id', name: 'Test', parentId: null})],
			});

			await expect(Update.run(['--id', 'node-id'])).rejects.toThrow(
				'At least one of --name, --clear-name, --note, --clear-note, or --layout-mode must be provided',
			);
		});
	});

	describe('dry run mode', () => {
		it('shows API call without executing for name update', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'node-id', name: 'Original Name', parentId: null})],
			});

			const {stdout} = await captureOutput(async () => {
				await Update.run(['--id', 'node-id', '--name', 'New Name', '--dry-run']);
			});

			// Dry run outputs human-readable text, not JSON
			expect(stdout).toBe(
				'Would execute API call:\n  Method: POST\n  URL: https://workflowy.com/api/v1/nodes/node-id\n  Headers:\n    Authorization: Bearer <WORKFLOWY_API_KEY>\n    Content-Type: application/json\n  Body:\n    {\n      "name": "New Name"\n    }\n\nNode: Original Name\n',
			);
			expect(fetchStub.mock.calls).toStrictEqual([]);
		});

		it('shows note in dry run output', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'node-id', name: 'Test', parentId: null})],
			});

			const {stdout} = await captureOutput(async () => {
				await Update.run(['--id', 'node-id', '--note', 'New note content', '--dry-run']);
			});

			expect(stdout).toBe(
				'Would execute API call:\n  Method: POST\n  URL: https://workflowy.com/api/v1/nodes/node-id\n  Headers:\n    Authorization: Bearer <WORKFLOWY_API_KEY>\n    Content-Type: application/json\n  Body:\n    {\n      "note": "New note content"\n    }\n\nNode: Test\n',
			);
		});

		it('shows layout mode in dry run output', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'node-id', name: 'Test', parentId: null})],
			});

			const {stdout} = await captureOutput(async () => {
				await Update.run(['--id', 'node-id', '--layout-mode', 'board', '--dry-run']);
			});

			expect(stdout).toBe(
				'Would execute API call:\n  Method: POST\n  URL: https://workflowy.com/api/v1/nodes/node-id\n  Headers:\n    Authorization: Bearer <WORKFLOWY_API_KEY>\n    Content-Type: application/json\n  Body:\n    {\n      "layoutMode": "board"\n    }\n\nNode: Test\n',
			);
		});

		it('shows clear-note in dry run output', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'node-id', name: 'Test', note: 'Old note', parentId: null})],
			});

			const {stdout} = await captureOutput(async () => {
				await Update.run(['--id', 'node-id', '--clear-note', '--dry-run']);
			});

			expect(stdout).toBe(
				'Would execute API call:\n  Method: POST\n  URL: https://workflowy.com/api/v1/nodes/node-id\n  Headers:\n    Authorization: Bearer <WORKFLOWY_API_KEY>\n    Content-Type: application/json\n  Body:\n    {\n      "note": ""\n    }\n\nNode: Test\n',
			);
		});
	});

	describe('updating by ID', () => {
		it('sends correct request body for name update', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'update-id', name: 'Old Name', parentId: null})],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				if (init?.body) {
					capturedBody = init.body as string;
				}
				return new Response(JSON.stringify({node: {id: 'update-id', name: 'New Name'}}), {status: 200});
			});

			await captureOutput(async () => {
				try {
					await Update.run(['--id', 'update-id', '--name', 'New Name']);
				} catch {
					// Ignore errors from cache update
				}
			});

			const body = JSON.parse(capturedBody!);
			expect(body).toStrictEqual({name: 'New Name'});
		});

		it('sends correct request body for note update', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'update-id', name: 'Test', parentId: null})],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				if (init?.body) {
					capturedBody = init.body as string;
				}
				return new Response(JSON.stringify({node: {id: 'update-id', name: 'Test', note: 'New note'}}), {
					status: 200,
				});
			});

			await captureOutput(async () => {
				try {
					await Update.run(['--id', 'update-id', '--note', 'New note']);
				} catch {
					// Ignore errors from cache update
				}
			});

			const body = JSON.parse(capturedBody!);
			expect(body).toStrictEqual({note: 'New note'});
		});

		it('sends empty note to clear with --clear-note', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'update-id', name: 'Test', note: 'Old note', parentId: null})],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				if (init?.body) {
					capturedBody = init.body as string;
				}
				return new Response(JSON.stringify({node: {id: 'update-id', name: 'Test', note: ''}}), {status: 200});
			});

			await captureOutput(async () => {
				try {
					await Update.run(['--id', 'update-id', '--clear-note']);
				} catch {
					// Ignore errors from cache update
				}
			});

			const body = JSON.parse(capturedBody!);
			expect(body).toStrictEqual({note: ''});
		});

		it('sends empty name to clear with --clear-name', async () => {
			// A mirror node must inherit its text from the original. When a write accidentally
			// gives it a name of its own, the cache refuses to read the whole subtree, and
			// --name cannot undo it because oclif rejects an empty string.
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'mirror-id', name: ' #write', parentId: null})],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				if (init?.body) {
					capturedBody = init.body as string;
				}
				return new Response(JSON.stringify({node: {id: 'mirror-id', name: ''}}), {status: 200});
			});

			await captureOutput(async () => {
				try {
					await Update.run(['--id', 'mirror-id', '--clear-name']);
				} catch {
					// Ignore errors from cache update
				}
			});

			const body = JSON.parse(capturedBody!);
			expect(body).toStrictEqual({name: ''});
		});

		it('sends correct request body for layout mode update', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'update-id', name: 'Test', parentId: null})],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				if (init?.body) {
					capturedBody = init.body as string;
				}
				return new Response(
					JSON.stringify({node: {id: 'update-id', name: 'Test', data: {layoutMode: 'document'}}}),
					{
						status: 200,
					},
				);
			});

			await captureOutput(async () => {
				try {
					await Update.run(['--id', 'update-id', '--layout-mode', 'document']);
				} catch {
					// Ignore errors from cache update
				}
			});

			const body = JSON.parse(capturedBody!);
			expect(body).toStrictEqual({layoutMode: 'document'});
		});

		it('sends all fields when updating multiple', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'update-id', name: 'Old Name', parentId: null})],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				if (init?.body) {
					capturedBody = init.body as string;
				}
				return new Response(JSON.stringify({node: {id: 'update-id', name: 'New Name', note: 'New note'}}), {
					status: 200,
				});
			});

			await captureOutput(async () => {
				try {
					await Update.run([
						'--id',
						'update-id',
						'--name',
						'New Name',
						'--note',
						'New note',
						'--layout-mode',
						'board',
					]);
				} catch {
					// Ignore errors from cache update
				}
			});

			const body = JSON.parse(capturedBody!);
			expect(body).toStrictEqual({
				name: 'New Name',
				note: 'New note',
				layoutMode: 'board',
			});
		});
	});

	describe('--expect-name precondition', () => {
		it('refuses to update when current name does not match --expect-name', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({
						id: 'guard-id',
						name: 'Long current text the user expanded later',
						parentId: null,
					}),
				],
			});

			await expect(
				Update.run(['--id', 'guard-id', '--name', 'Short stub', '--expect-name', 'Stale original text']),
			).rejects.toThrow(/does not match --expect-name/);

			expect(fetchStub.mock.calls).toStrictEqual([]);
		});

		it('proceeds with the update when current name matches --expect-name', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'guard-id', name: 'Exact current name', parentId: null})],
			});

			let called = false;
			fetchStub.mockImplementation(async (_url: RequestInfo | URL, _init?: RequestInit) => {
				called = true;
				return new Response(JSON.stringify({node: {id: 'guard-id', name: 'New Name'}}), {status: 200});
			});

			await captureOutput(async () => {
				try {
					await Update.run(['--id', 'guard-id', '--name', 'New Name', '--expect-name', 'Exact current name']);
				} catch {
					// Ignore errors from cache update
				}
			});

			expect(called).toBe(true);
		});

		it('refuses when the node no longer exists in the cache', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'other-id', name: 'Other', parentId: null})],
			});

			await expect(
				Update.run(['--id', 'missing-id', '--name', 'New Name', '--expect-name', 'Anything']),
			).rejects.toThrow(/does not match --expect-name/);

			expect(fetchStub.mock.calls).toStrictEqual([]);
		});
	});

	describe('updating by path', () => {
		it('resolves path to correct node ID', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'work-id', name: 'Work', parentId: null}),
					createTestNode({id: 'tasks-id', name: 'Tasks', parentId: 'work-id'}),
					createTestNode({id: 'target-id', name: 'My Task', parentId: 'tasks-id'}),
				],
			});

			let capturedUrl: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, _init?: RequestInit) => {
				capturedUrl = url instanceof Request ? url.url : String(url);
				return new Response(JSON.stringify({node: {id: 'target-id', name: 'Updated Task'}}), {status: 200});
			});

			await captureOutput(async () => {
				try {
					await Update.run(['--path', 'Work,Tasks,My Task', '--name', 'Updated Task']);
				} catch {
					// Ignore errors from cache update
				}
			});

			expect(capturedUrl).toBe('https://workflowy.com/api/v1/nodes/target-id');
		});

		it('errors when path not found', async () => {
			// Cache is empty, API returns empty children for root (path not found)
			fetchStub.mockResolvedValue(new Response(JSON.stringify({nodes: []}), {status: 200}));

			await expect(Update.run(['--path', 'Missing,Path', '--name', 'New Name'])).rejects.toThrow(
				'Node not found at path: Missing > Path',
			);
		});
	});

	describe('output', () => {
		// Note: Full output with success message requires integration testing
		// due to command creating separate DB connections. API calls and path
		// display are tested here; success message tested via integration tests.

		it('displays full path when updating', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'work-id', name: 'Work', parentId: null}),
					createTestNode({id: 'target-id', name: 'Target', parentId: 'work-id'}),
				],
			});

			fetchStub.mockResolvedValue(new Response(JSON.stringify({}), {status: 200}));

			const {stdout} = await captureOutput(async () => {
				try {
					await Update.run(['--id', 'target-id', '--name', 'Updated']);
				} catch {
					// Ignore errors from cache update
				}
			});

			expect(stdout).toBe('Updating node: Work > Target\n');
		});
	});

	describe('command metadata', () => {
		it('has correct description', () => {
			expect(Update.description).toBe('Update a Workflowy node');
		});

		it('has examples', () => {
			expect(Update.examples).toStrictEqual([
				'# Update node name by ID',
				'<%= config.bin %> <%= command.id %> --id abc123 --name "Updated Task"',
				'',
				'# Update node by path',
				'<%= config.bin %> <%= command.id %> --path "Work,Tasks,Old Name" --name "New Name"',
				'',
				'# Update note only',
				'<%= config.bin %> <%= command.id %> --id abc123 --note "Additional details"',
				'',
				'# Update both name and note',
				'<%= config.bin %> <%= command.id %> --id abc123 --name "Updated" --note "With note"',
				'',
				'# Clear the note from a node',
				'<%= config.bin %> <%= command.id %> --id abc123 --clear-note',
				'',
				"# Clear a mirror's own name so it inherits from the original again",
				'<%= config.bin %> <%= command.id %> --id abc123 --clear-name',
				'',
				'# Preview the API call without updating',
				'<%= config.bin %> <%= command.id %> --id abc123 --name "Updated" --dry-run',
			]);
		});
	});
});
