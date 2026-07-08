import {captureOutput} from '@oclif/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {MockInstance} from 'vite-plus/test';
import Create from '../../../src/commands/node/create.js';
import {cleanupTestDatabase, createTestDatabase, seedTestData, type TestDatabase} from '../../db/migration-helper.js';
import {createTestNode} from '../../helpers/node-fixtures.js';

describe('node create command', () => {
	let originalEnv: typeof process.env;
	let fetchStub: MockInstance;
	let tempDir: string;
	let testDatabase: TestDatabase;

	beforeEach(() => {
		originalEnv = {...process.env};

		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-create-test-'));
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

			await expect(Create.run(['--parent-id', 'inbox', '--name', 'Test'])).rejects.toThrow(
				'WORKFLOWY_API_KEY environment variable is required',
			);
		});
	});

	describe('flag validation', () => {
		it('requires either --name, --json, or --json-file', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			await expect(Create.run(['--parent-id', 'parent-id'])).rejects.toThrow(
				'Either --name, --json, or --json-file is required',
			);
		});

		it('requires parent specifier', async () => {
			await expect(Create.run(['--name', 'Test Node'])).rejects.toThrow('Parent node is required');
		});
	});

	describe('dry run mode', () => {
		it('shows API call without executing for single node', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			const {stdout} = await captureOutput(async () => {
				await Create.run(['--parent-id', 'parent-id', '--name', 'Test Node', '--dry-run']);
			});

			expect(stdout).toContain('Would execute API call');
			expect(stdout).toContain('POST');
			expect(stdout).toContain('https://workflowy.com/api/v1/nodes/');
			expect(stdout).toContain('Test Node');
			expect(fetchStub).not.toHaveBeenCalled();
		});

		it('includes note in dry run output', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			const {stdout} = await captureOutput(async () => {
				await Create.run([
					'--parent-id',
					'parent-id',
					'--name',
					'Test Node',
					'--note',
					'This is a note',
					'--dry-run',
				]);
			});

			expect(stdout).toContain('This is a note');
		});

		it('includes layout mode in dry run output', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			const {stdout} = await captureOutput(async () => {
				await Create.run([
					'--parent-id',
					'parent-id',
					'--name',
					'Test Node',
					'--layout-mode',
					'document',
					'--dry-run',
				]);
			});

			expect(stdout).toContain('document');
		});
	});

	describe('single node creation', () => {
		it('creates node via API and updates cache', async () => {
			const createdNodeId = 'new-node-id';

			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			// API returns just {item_id: "..."}, client constructs full node
			fetchStub.mockResolvedValue(new Response(JSON.stringify({item_id: createdNodeId}), {status: 200}));

			const {stdout} = await captureOutput(async () => {
				await Create.run(['--parent-id', 'parent-id', '--name', 'Test Node']);
			});

			expect(stdout).toContain('Successfully created node');
			expect(stdout).toContain(createdNodeId);
			expect(fetchStub).toHaveBeenCalledTimes(1);
		});

		it('sends correct request body', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				capturedBody = init?.body as string;
				return new Response(JSON.stringify({item_id: 'new-id'}), {status: 200});
			});

			await captureOutput(async () => {
				await Create.run([
					'--parent-id',
					'parent-id',
					'--name',
					'Test Node',
					'--note',
					'A note',
					'--layout-mode',
					'document',
				]);
			});

			const body = JSON.parse(capturedBody!);
			expect(body).toStrictEqual({
				parent_id: 'parent-id',
				name: 'Test Node',
				note: 'A note',
				layoutMode: 'document',
			});
		});
	});

	describe('parent resolution', () => {
		it('resolves parent by ID', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'specific-parent-id', name: 'Parent', parentId: null})],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				capturedBody = init?.body as string;
				return new Response(JSON.stringify({item_id: 'new-id'}), {status: 200});
			});

			await captureOutput(async () => {
				await Create.run(['--parent-id', 'specific-parent-id', '--name', 'Test']);
			});

			const body = JSON.parse(capturedBody!);
			expect(body.parent_id).toBe('specific-parent-id');
		});

		it('resolves parent by path', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'work-id', name: 'Work', parentId: null}),
					createTestNode({id: 'projects-id', name: 'Projects', parentId: 'work-id'}),
				],
			});

			let capturedBody: string | undefined;
			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				capturedBody = init?.body as string;
				return new Response(JSON.stringify({item_id: 'new-id'}), {status: 200});
			});

			await captureOutput(async () => {
				await Create.run(['--parent-path', 'Work,Projects', '--name', 'Test']);
			});

			const body = JSON.parse(capturedBody!);
			expect(body.parent_id).toBe('projects-id');
		});

		it('resolves system target via --parent-id', async () => {
			// System targets like 'inbox' are passed directly to the API via --parent-id
			// No targets API call is made - the API accepts 'inbox' as parent_id
			let capturedBody: string | undefined;
			const now = Math.floor(Date.now() / 1000);

			fetchStub.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
				const urlStr = url instanceof Request ? url.url : String(url);
				const method = init?.method ?? 'GET';

				if (method === 'POST' && urlStr.endsWith('/nodes/')) {
					capturedBody = init?.body as string;
					return new Response(JSON.stringify({item_id: 'new-id'}), {status: 200});
				}

				// GET request for parent node
				if (method === 'GET' && urlStr.includes('/nodes/inbox')) {
					return new Response(
						JSON.stringify({
							node: {
								id: 'inbox-uuid',
								name: 'Inbox',
								priority: 0,
								completed: false,
								createdAt: now,
								modifiedAt: now,
								completedAt: null,
								data: {layoutMode: 'bullets'},
							},
						}),
						{status: 200},
					);
				}

				return new Response(JSON.stringify({}), {status: 404});
			});

			const {stdout} = await captureOutput(async () => {
				await Create.run(['--parent-id', 'inbox', '--name', 'Test']);
			});

			expect(stdout).toContain('Successfully created node');
			const body = JSON.parse(capturedBody!);
			expect(body.parent_id).toBe('inbox');
		});
	});

	describe('JSON mode', () => {
		it('creates single node from JSON', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			fetchStub.mockResolvedValue(new Response(JSON.stringify({item_id: 'new-id'}), {status: 200}));

			const {stdout} = await captureOutput(async () => {
				await Create.run(['--parent-id', 'parent-id', '--json', '{"name": "JSON Node"}']);
			});

			expect(stdout).toContain('Successfully created node tree');
			expect(stdout).toContain('JSON Node');
		});

		it('creates nested tree from JSON', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			let callCount = 0;
			fetchStub.mockImplementation(async () => {
				callCount++;
				return new Response(JSON.stringify({item_id: `node-${callCount}`}), {status: 200});
			});

			const json = JSON.stringify({
				name: 'Project',
				children: [{name: 'Task 1'}, {name: 'Task 2'}],
			});

			const {stdout} = await captureOutput(async () => {
				await Create.run(['--parent-id', 'parent-id', '--json', json]);
			});

			expect(fetchStub).toHaveBeenCalledTimes(3);
			expect(stdout).toContain('Successfully created node tree');
		});

		it('dry run shows node tree preview for JSON', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			const json = JSON.stringify({
				name: 'Project',
				children: [{name: 'Task 1'}, {name: 'Task 2'}],
			});

			const {stdout} = await captureOutput(async () => {
				await Create.run(['--parent-id', 'parent-id', '--json', json, '--dry-run']);
			});

			expect(stdout).toContain('Would create the following node tree');
			expect(stdout).toContain('Project');
			expect(stdout).toContain('Task 1');
			expect(stdout).toContain('Task 2');
			expect(stdout).toContain('3 POST requests');
			expect(fetchStub).not.toHaveBeenCalled();
		});

		it('handles invalid JSON in --json flag', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			await expect(Create.run(['--parent-id', 'parent-id', '--json', 'not valid json'])).rejects.toThrow(
				'Invalid JSON',
			);
		});

		it('validates JSON structure', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			await expect(
				Create.run(['--parent-id', 'parent-id', '--json', '{"invalid": "structure"}']),
			).rejects.toThrow('Invalid JSON structure');
		});
	});

	describe('JSON file mode', () => {
		it('creates nodes from JSON file', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			const jsonPath = path.join(tempDir, 'nodes.json');
			fs.writeFileSync(jsonPath, JSON.stringify({name: 'File Node'}));

			fetchStub.mockResolvedValue(new Response(JSON.stringify({item_id: 'new-id'}), {status: 200}));

			const {stdout} = await captureOutput(async () => {
				await Create.run(['--parent-id', 'parent-id', '--json-file', jsonPath]);
			});

			expect(stdout).toContain('Successfully created node tree');
			expect(stdout).toContain('File Node');
		});

		it('handles non-existent JSON file', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			await expect(
				Create.run(['--parent-id', 'parent-id', '--json-file', '/nonexistent/file.json']),
			).rejects.toThrow('File not found');
		});
	});

	describe('output', () => {
		it('displays node ID and URL after creation', async () => {
			const newNodeId = 'created-node-id';

			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent-id', name: 'Parent', parentId: null})],
			});

			fetchStub.mockResolvedValue(new Response(JSON.stringify({item_id: newNodeId}), {status: 200}));

			const {stdout} = await captureOutput(async () => {
				await Create.run(['--parent-id', 'parent-id', '--name', 'Test Node']);
			});

			expect(stdout).toContain(`ID: ${newNodeId}`);
			expect(stdout).toContain('workflowy.com');
		});

		it('displays parent path in output', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'work-id', name: 'Work', parentId: null}),
					createTestNode({id: 'projects-id', name: 'Projects', parentId: 'work-id'}),
				],
			});

			fetchStub.mockResolvedValue(new Response(JSON.stringify({item_id: 'new-id'}), {status: 200}));

			const {stdout} = await captureOutput(async () => {
				await Create.run(['--parent-path', 'Work,Projects', '--name', 'Test']);
			});

			expect(stdout).toContain('Work');
			expect(stdout).toContain('Projects');
		});
	});

	describe('command metadata', () => {
		it('has correct description', () => {
			expect(Create.description).toBe('Create a new Workflowy node or tree of nodes from JSON');
		});

		it('has examples', () => {
			expect(Create.examples!.length).toBeGreaterThan(0);
		});
	});
});
