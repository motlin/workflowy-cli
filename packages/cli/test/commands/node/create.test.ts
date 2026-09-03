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

		vi.useFakeTimers({shouldAdvanceTime: true});
		vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
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

			expect(fetchStub.mock.calls).toStrictEqual([]);
			expect(stdout).toBe(
				'Would execute API call:\n  Method: POST\n  URL: https://workflowy.com/api/v1/nodes/\n  Headers:\n    Authorization: Bearer <WORKFLOWY_API_KEY>\n    Content-Type: application/json\n  Body:\n    {\n      "parent_id": "parent-id",\n      "name": "Test Node"\n    }\n\nParent: Parent\n',
			);
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

			expect(stdout).toBe(
				'Would execute API call:\n  Method: POST\n  URL: https://workflowy.com/api/v1/nodes/\n  Headers:\n    Authorization: Bearer <WORKFLOWY_API_KEY>\n    Content-Type: application/json\n  Body:\n    {\n      "parent_id": "parent-id",\n      "name": "Test Node",\n      "note": "This is a note"\n    }\n\nParent: Parent\n',
			);
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

			expect(stdout).toBe(
				'Would execute API call:\n  Method: POST\n  URL: https://workflowy.com/api/v1/nodes/\n  Headers:\n    Authorization: Bearer <WORKFLOWY_API_KEY>\n    Content-Type: application/json\n  Body:\n    {\n      "parent_id": "parent-id",\n      "name": "Test Node",\n      "layoutMode": "document"\n    }\n\nParent: Parent\n',
			);
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

			expect(stdout).toBe(
				'Creating node: Test Node\nParent: Parent\n\nSuccessfully created node\n  ID: new-node-id\n  Name: Test Node\n  Created: 2026-01-01T00:00:00.000Z\n  URL: https://workflowy.com/#/newnodeid\n',
			);
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
			expect(body).toStrictEqual({parent_id: 'specific-parent-id', name: 'Test'});
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
			expect(body).toStrictEqual({parent_id: 'projects-id', name: 'Test'});
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

			expect(stdout).toBe(
				'Creating node: Test\nParent: \n\nSuccessfully created node\n  ID: new-id\n  Name: Test\n  Created: 2026-01-01T00:00:00.000Z\n  URL: https://workflowy.com/#/newid\n',
			);
			const body = JSON.parse(capturedBody!);
			expect(body).toStrictEqual({parent_id: 'inbox', name: 'Test'});
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

			expect(stdout).toBe(
				'Creating node tree...\nParent: Parent\n\nSuccessfully created node tree:\n- JSON Node\n  ID: new-id\n  URL: https://workflowy.com/#/newid\n\nCreated node IDs (JSON):\n[\n  {\n    "id": "new-id",\n    "name": "JSON Node",\n    "parentId": null\n  }\n]\n',
			);
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
			expect(stdout).toBe(
				'Creating node tree...\nParent: Parent\n\nSuccessfully created node tree:\n- Project\n  ID: node-1\n  URL: https://workflowy.com/#/node1\n  - Task 1\n    ID: node-2\n    URL: https://workflowy.com/#/node2\n  - Task 2\n    ID: node-3\n    URL: https://workflowy.com/#/node3\n\nCreated node IDs (JSON):\n[\n  {\n    "id": "node-1",\n    "name": "Project",\n    "parentId": null\n  },\n  {\n    "id": "node-2",\n    "name": "Task 1",\n    "parentId": "node-1"\n  },\n  {\n    "id": "node-3",\n    "name": "Task 2",\n    "parentId": "node-1"\n  }\n]\n',
			);
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

			expect(stdout).toBe(
				'Would create the following node tree:\n\nParent: Parent\n\n- Project\n  - Task 1\n  - Task 2\n\nAPI calls that would be made:\n  3 POST requests to https://workflowy.com/api/v1/nodes/\n',
			);
			expect(fetchStub.mock.calls).toStrictEqual([]);
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

			expect(stdout).toBe(
				'Creating node tree...\nParent: Parent\n\nSuccessfully created node tree:\n- File Node\n  ID: new-id\n  URL: https://workflowy.com/#/newid\n\nCreated node IDs (JSON):\n[\n  {\n    "id": "new-id",\n    "name": "File Node",\n    "parentId": null\n  }\n]\n',
			);
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

			expect(stdout).toBe(
				'Creating node: Test Node\nParent: Parent\n\nSuccessfully created node\n  ID: created-node-id\n  Name: Test Node\n  Created: 2026-01-01T00:00:00.000Z\n  URL: https://workflowy.com/#/reatednodeid\n',
			);
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

			expect(stdout).toBe(
				'Creating node: Test\nParent: Work > Projects\n\nSuccessfully created node\n  ID: new-id\n  Name: Test\n  Created: 2026-01-01T00:00:00.000Z\n  URL: https://workflowy.com/#/newid\n',
			);
		});
	});

	describe('command metadata', () => {
		it('has correct description', () => {
			expect(Create.description).toBe('Create a new Workflowy node or tree of nodes from JSON');
		});

		it('has examples', () => {
			expect(Create.examples).toStrictEqual([
				'# Create node in inbox (system target)',
				'<%= config.bin %> <%= command.id %> --parent-id inbox --name "New Task"',
				'',
				'# Create node under a parent by ID',
				'<%= config.bin %> <%= command.id %> --parent-id abc123 --name "Subtask"',
				'',
				'# Create node under a parent by path',
				'<%= config.bin %> <%= command.id %> --parent-path "Work,Projects" --name "Subtask"',
				'',
				'# Create node with a specific layout mode',
				'<%= config.bin %> <%= command.id %> --parent-id abc123 --name "Notes" --layout-mode document',
				'',
				'# Create from stdin (use - for name)',
				String.raw`echo "## Section 1\n\nParagraph text" | <%= config.bin %> <%= command.id %> --parent-id abc123 --name -`,
				'',
				'# Import article content via clean-mark',
				'npx clean-mark https://example.com/article --stdout | <%= config.bin %> <%= command.id %> --parent-id abc123 --name -',
				'',
				'# Preview the API call without creating',
				'<%= config.bin %> <%= command.id %> --parent-id inbox --name "New Task" --dry-run',
				'',
				'# Create nested nodes from inline JSON',
				'<%= config.bin %> <%= command.id %> --parent-id abc123 --json \'{"name": "Project", "children": [{"name": "Task 1"}, {"name": "Task 2"}]}\'',
				'',
				'# Create nested nodes from a JSON file',
				'<%= config.bin %> <%= command.id %> --parent-id abc123 --json-file ./project-template.json',
				'',
				'# Create node under a path, creating missing segments (like mkdir -p)',
				'<%= config.bin %> <%= command.id %> --parent-path "Metadata,Scanner State,my-scanner" --name "state.json" --create-path',
			]);
		});
	});
});
