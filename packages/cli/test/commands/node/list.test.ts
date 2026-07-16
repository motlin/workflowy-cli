import {nodeContent, nodeMetadata} from '@workflowy/shared/db';
import {captureOutput} from '@oclif/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import List from '../../../src/commands/node/list.js';
import {cleanupTestDatabase, createTestDatabase, type TestDatabase} from '../../db/migration-helper.js';

describe('node:list command', () => {
	let originalEnv: typeof process.env;
	let mockFetch: typeof globalThis.fetch;
	let tempDir: string;
	let testDatabase: TestDatabase;

	beforeEach(async () => {
		originalEnv = process.env;
		mockFetch = globalThis.fetch;

		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-test-'));
		const testDbPath = path.join(tempDir, 'test.sqlite');
		testDatabase = createTestDatabase(testDbPath);
		process.env.WORKFLOWY_DB_PATH = testDbPath;

		testDatabase.db.run('PRAGMA foreign_keys = OFF');
		testDatabase.db.delete(nodeContent).run();
		testDatabase.db.delete(nodeMetadata).run();
		testDatabase.db.run('PRAGMA foreign_keys = ON');
	});

	afterEach(() => {
		process.env = originalEnv;
		globalThis.fetch = mockFetch;

		cleanupTestDatabase(testDatabase);

		if (fs.existsSync(tempDir)) {
			try {
				if (fs.existsSync(testDatabase.path)) {
					fs.unlinkSync(testDatabase.path);
				}
				fs.rmdirSync(tempDir);
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	describe('environment variable validation', () => {
		it('works without WORKFLOWY_API_KEY when cache is available', async () => {
			delete process.env.WORKFLOWY_API_KEY;

			const {stdout} = await captureOutput(async () => {
				await List.run(['--parent-id', 'nonexistent-id']);
			});

			expect(stdout).toContain('No nodes found in cache. Set WORKFLOWY_API_KEY to fetch from API.');
		});

		it('works with empty WORKFLOWY_API_KEY string', async () => {
			process.env.WORKFLOWY_API_KEY = '';

			const {stdout} = await captureOutput(async () => {
				await List.run(['--parent-id', 'nonexistent-id']);
			});

			expect(stdout).toContain('No nodes found in cache. Set WORKFLOWY_API_KEY to fetch from API.');
		});
	});

	describe('API request handling', () => {
		beforeEach(() => {
			process.env.WORKFLOWY_API_KEY = 'test-api-key';
		});

		it('makes request to correct URL without parent-id flag', async () => {
			let capturedUrl: string | undefined;
			globalThis.fetch = async (url: RequestInfo | URL) => {
				capturedUrl = url instanceof Request ? url.url : String(url);
				return new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'First node',
								priority: 0,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
							{
								id: 'node2',
								name: 'Second node',
								priority: 1,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
						],
					}),
					{status: 200},
				);
			};

			await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(capturedUrl).toBe('https://workflowy.com/api/v1/nodes');
		});

		it('makes request to correct URL with parent-id flag', async () => {
			let capturedUrl: string | undefined;
			globalThis.fetch = async (url: RequestInfo | URL) => {
				capturedUrl = url instanceof Request ? url.url : String(url);
				return new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'child1',
								name: 'Child node 1',
								priority: 0,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
							{
								id: 'child2',
								name: 'Child node 2',
								priority: 1,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
						],
					}),
					{status: 200},
				);
			};

			await captureOutput(async () => {
				await List.run(['--parent-id', 'parent123']);
			});

			expect(capturedUrl).toBe('https://workflowy.com/api/v1/nodes?parent_id=parent123');
		});

		it('sends correct Authorization header', async () => {
			const capturedHeaders: Record<string, string> = {};
			globalThis.fetch = async (url: RequestInfo | URL, options?: globalThis.RequestInit) => {
				const headers = new Headers(options?.headers);
				for (const [key, value] of headers.entries()) {
					capturedHeaders[key] = value;
				}
				return new Response(JSON.stringify({nodes: []}), {status: 200});
			};

			await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(capturedHeaders).toStrictEqual({
				authorization: 'Bearer test-api-key',
				'content-type': 'application/json',
			});
		});
	});

	describe('successful responses', () => {
		beforeEach(() => {
			process.env.WORKFLOWY_API_KEY = 'test-api-key';
		});

		it('displays nodes correctly when API returns array', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'First node',
								priority: 0,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
							{
								id: 'node2',
								name: 'Second node with special chars: áéíóú',
								priority: 1,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('Fetched fresh data from API');
			expect(stdout).toContain('Nodes (2):');
			expect(stdout).toContain('  First node');
			expect(stdout).toContain('  Second node with special chars: áéíóú');
			expect(stdout).toContain('https://workflowy.com/#/node1');
			expect(stdout).toContain('https://workflowy.com/#/node2');
		});

		it('displays empty list when API returns empty array', async () => {
			globalThis.fetch = async () => new Response(JSON.stringify({nodes: []}), {status: 200});

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('Fetched fresh data from API');
			expect(stdout).toContain('No nodes found');
		});

		it('handles nodes with empty name property', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'Valid name',
								priority: 0,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
							{
								id: 'node2',
								name: '',
								priority: 1,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('Fetched fresh data from API');
			expect(stdout).toContain('Nodes (2):');
			expect(stdout).toContain('  Valid name');
			expect(stdout).toContain('  ');
		});

		it('displays emoji indicators for nodes with notes', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'Node with note',
								note: 'This is a note',
								priority: 0,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
							{
								id: 'node2',
								name: 'Node without note',
								note: null,
								priority: 1,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('📝 Node with note');
			expect(stdout).toContain('  Node without note');
		});

		it('displays emoji indicators for nodes with non-default layoutMode', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'Todo node',
								priority: 0,
								completed: false,
								data: {layoutMode: 'todo'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
							{
								id: 'node2',
								name: 'Headings node',
								priority: 1,
								completed: false,
								data: {layoutMode: 'headings'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
							{
								id: 'node3',
								name: 'Bullets node',
								priority: 2,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('☑️ Todo node');
			expect(stdout).toContain('📋 Headings node');
			expect(stdout).toContain('  Bullets node');
		});

		it('displays multiple emoji indicators when node has note and non-default layoutMode', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'Todo with note',
								note: 'Important note',
								priority: 0,
								completed: false,
								data: {layoutMode: 'todo'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('📝 ☑️ Todo with note');
		});

		it('displays completion indicator along with note and layoutMode indicators', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'Completed todo with note',
								note: 'Done!',
								priority: 0,
								completed: true,
								data: {layoutMode: 'todo'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: Date.now(),
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('✓ 📝 ☑️ Completed todo with note');
		});

		it('displays backlinks indicator when node contains links to other nodes in name', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'Node with backlink <a href="https://workflowy.com/#/abc123">link</a>',
								priority: 0,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
							{
								id: 'node2',
								name: 'Node without backlink',
								priority: 1,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('↗️ Node with backlink');
			expect(stdout).toContain('  Node without backlink');
		});

		it('displays backlinks indicator when node contains links to other nodes in note', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'Node with backlink in note',
								note: 'See also <a href="https://workflowy.com/#/xyz789">related node</a>',
								priority: 0,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('📝 ↗️ Node with backlink in note');
		});

		it('displays backlinks indicator along with other indicators', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'Completed task with backlink <a href="https://workflowy.com/#/ref123">ref</a>',
								note: 'Important note',
								priority: 0,
								completed: true,
								data: {layoutMode: 'todo'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: Date.now(),
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('✓ 📝 ☑️ ↗️ Completed task with backlink');
		});
	});

	describe('API error responses', () => {
		beforeEach(() => {
			process.env.WORKFLOWY_API_KEY = 'test-api-key';
		});

		it('falls back to cache when API returns 401 Unauthorized', async () => {
			globalThis.fetch = async () => new Response('Unauthorized', {status: 401, statusText: 'Unauthorized'});

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('No nodes found');
		});

		it('falls back to cache when API returns 404 Not Found', async () => {
			globalThis.fetch = async () => new Response('Not Found', {status: 404, statusText: 'Not Found'});

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('No nodes found');
		});

		it('falls back to cache when API returns 500 Internal Server Error', async () => {
			globalThis.fetch = async () =>
				new Response('Internal Server Error', {status: 500, statusText: 'Internal Server Error'});

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('No nodes found');
		});
	});

	describe('network and parsing errors', () => {
		beforeEach(() => {
			process.env.WORKFLOWY_API_KEY = 'test-api-key';
		});

		it('falls back to cache when network request fails', async () => {
			globalThis.fetch = async () => {
				throw new Error('Network error: ECONNREFUSED');
			};

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('No nodes found');
		});

		it('falls back to cache when response JSON is malformed', async () => {
			globalThis.fetch = async () => new Response('invalid json{', {status: 200});

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('No nodes found');
		});

		it('falls back to cache when fetch times out', async () => {
			globalThis.fetch = async () => {
				throw new Error('Request timeout');
			};

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('No nodes found');
		});
	});

	describe('flag parsing', () => {
		beforeEach(() => {
			process.env.WORKFLOWY_API_KEY = 'test-api-key';
			globalThis.fetch = async () => new Response(JSON.stringify({nodes: []}), {status: 200});
		});

		it('accepts short flag -p for parent-id', async () => {
			let capturedUrl: string | undefined;
			globalThis.fetch = async (url: RequestInfo | URL) => {
				capturedUrl = url instanceof Request ? url.url : String(url);
				return new Response(JSON.stringify({nodes: []}), {status: 200});
			};

			await captureOutput(async () => {
				await List.run(['-p', 'parent456']);
			});

			expect(capturedUrl).toBe('https://workflowy.com/api/v1/nodes?parent_id=parent456');
		});

		it('handles parent-id with special characters', async () => {
			let capturedUrl: string | undefined;
			globalThis.fetch = async (url: RequestInfo | URL) => {
				capturedUrl = url instanceof Request ? url.url : String(url);
				return new Response(JSON.stringify({nodes: []}), {status: 200});
			};

			const specialParentId = 'parent-with-dashes_and_underscores.and.dots';

			await captureOutput(async () => {
				await List.run(['--parent-id', specialParentId]);
			});

			expect(capturedUrl).toBe(`https://workflowy.com/api/v1/nodes?parent_id=${specialParentId}`);
		});

		it('handles UUID parent-id format', async () => {
			let capturedUrl: string | undefined;
			globalThis.fetch = async (url: RequestInfo | URL) => {
				capturedUrl = url instanceof Request ? url.url : String(url);
				return new Response(JSON.stringify({nodes: []}), {status: 200});
			};

			const uuidParentId = '61111c3a-e939-d4dc-1a8c-6bf42551caa3';

			await captureOutput(async () => {
				await List.run(['--parent-id', uuidParentId]);
			});

			expect(capturedUrl).toBe(`https://workflowy.com/api/v1/nodes?parent_id=${uuidParentId}`);
		});
	});

	describe('command metadata', () => {
		it('has correct description', () => {
			expect(List.description).toBe('List Workflowy nodes by parent node ID');
		});

		it('has correct examples', () => {
			expect(List.examples).toStrictEqual([
				'<%= config.bin %> <%= command.id %>',
				'<%= config.bin %> <%= command.id %> --parent-id abc123',
				'<%= config.bin %> <%= command.id %> --parent-id abc123 --force-refresh',
			]);
		});

		it('has correct flag configuration', () => {
			expect(List.flags).toHaveProperty('parent-id');
			expect(List.flags['parent-id'].char).toBe('p');
			expect(List.flags['parent-id'].description).toBe('Parent node ID (omit for root nodes)');

			expect(List.flags).toHaveProperty('force-refresh');
			expect(List.flags['force-refresh'].char).toBe('f');
			expect(List.flags['force-refresh'].default).toBe(false);
			expect(List.flags['force-refresh'].description).toBe('Force refresh from API, ignoring cache');

			expect(List.flags).toHaveProperty('json');
			expect(List.flags.json.char).toBe('j');
			expect(List.flags.json.default).toBe(false);
			expect(List.flags.json.description).toBe('Output all node details in JSON format');
		});
	});

	describe('--incomplete flag', () => {
		beforeEach(() => {
			process.env.WORKFLOWY_API_KEY = 'test-api-key';
		});

		it('filters out completed nodes when --incomplete is set', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'Incomplete task',
								priority: 0,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
							{
								id: 'node2',
								name: 'Completed task',
								priority: 1,
								completed: true,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: Date.now(),
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh', '--incomplete']);
			});

			expect(stdout).toContain('Nodes (1):');
			expect(stdout).toContain('Incomplete task');
			expect(stdout).not.toContain('Completed task');
		});

		it('shows all nodes when --incomplete is not set', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'Incomplete task',
								priority: 0,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: null,
							},
							{
								id: 'node2',
								name: 'Completed task',
								priority: 1,
								completed: true,
								data: {layoutMode: 'bullets'},
								createdAt: Date.now(),
								modifiedAt: Date.now(),
								completedAt: Date.now(),
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh']);
			});

			expect(stdout).toContain('Nodes (2):');
			expect(stdout).toContain('Incomplete task');
			expect(stdout).toContain('Completed task');
		});
	});

	describe('JSON output', () => {
		beforeEach(() => {
			process.env.WORKFLOWY_API_KEY = 'test-api-key';
		});

		it('outputs nodes as JSON when --json flag is set', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'First node',
								note: 'Test note',
								priority: 0,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: 1_234_567_890,
								modifiedAt: 1_234_567_900,
								completedAt: null,
							},
							{
								id: 'node2',
								name: 'Second node',
								note: null,
								priority: 1,
								completed: true,
								data: {layoutMode: 'todo'},
								createdAt: 1_234_567_800,
								modifiedAt: 1_234_567_850,
								completedAt: 1_234_567_860,
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh', '--json']);
			});

			const lines = stdout.split('\n');
			const jsonStart = lines.indexOf('[');
			const jsonLines = lines.slice(jsonStart);
			const jsonOutput = jsonLines.join('\n');
			const parsed = JSON.parse(jsonOutput);

			expect(parsed).toHaveLength(2);

			// Delete dynamic systemFrom field before deep equality comparison
			for (const node of parsed) {
				delete node.systemFrom;
			}

			expect(parsed[0]).toStrictEqual({
				id: 'node1',
				shortId: 'node1',
				name: 'First node',
				note: 'Test note',
				parentId: null,
				priority: 0,
				createdAt: '2009-02-13T23:31:30.000Z',
				modifiedAt: '2009-02-13T23:31:40.000Z',
				completedAt: null,
				layoutMode: null,
				collapsed: false,
				mirror: {isMirror: false, originalNodeId: null},
				systemTo: '9999-12-31 23:59:59',
				inChat: false,
				hasReferencesRoot: false,
			});
			expect(parsed[1]).toStrictEqual({
				id: 'node2',
				shortId: 'node2',
				name: 'Second node',
				note: null,
				parentId: null,
				priority: 1,
				createdAt: '2009-02-13T23:30:00.000Z',
				modifiedAt: '2009-02-13T23:30:50.000Z',
				completedAt: '2009-02-13T23:31:00.000Z',
				layoutMode: 'todo',
				collapsed: false,
				mirror: {isMirror: false, originalNodeId: null},
				systemTo: '9999-12-31 23:59:59',
				inChat: false,
				hasReferencesRoot: false,
			});
		});

		it('accepts short flag -j for JSON output', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'Test node',
								note: null,
								priority: 0,
								completed: false,
								data: {layoutMode: 'bullets'},
								createdAt: 1_234_567_890,
								modifiedAt: 1_234_567_900,
								completedAt: null,
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh', '-j']);
			});

			const lines = stdout.split('\n');
			const jsonStart = lines.indexOf('[');
			const jsonLines = lines.slice(jsonStart);
			const jsonOutput = jsonLines.join('\n');
			const parsed = JSON.parse(jsonOutput);

			expect(parsed).toHaveLength(1);
			expect(parsed[0].id).toBe('node1');
		});

		it('does not include emoji indicators in JSON output', async () => {
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						nodes: [
							{
								id: 'node1',
								name: 'Completed todo with note',
								note: 'Done!',
								priority: 0,
								completed: true,
								data: {layoutMode: 'todo'},
								createdAt: 1_234_567_890,
								modifiedAt: 1_234_567_900,
								completedAt: 1_234_567_910,
							},
						],
					}),
					{status: 200},
				);

			const {stdout} = await captureOutput(async () => {
				await List.run(['--force-refresh', '--json']);
			});

			expect(stdout).not.toContain('✓');
			expect(stdout).not.toContain('📝');
			expect(stdout).not.toContain('☑️');

			const lines = stdout.split('\n');
			const jsonStart = lines.indexOf('[');
			const jsonLines = lines.slice(jsonStart);
			const jsonOutput = jsonLines.join('\n');
			const parsed = JSON.parse(jsonOutput);

			expect(parsed[0].name).toBe('Completed todo with note');
		});
	});
});
