import {FAR_FUTURE_DATE, formatTemporalTimestamp} from '@workflowy/shared/temporal';
import {captureOutput} from '@oclif/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Get from '../../src/commands/node/get.js';
import {cleanupTestDatabase, createTestDatabase, seedTestData, type TestDatabase} from '../db/migration-helper.js';
import {createTestNode} from '../helpers/node-fixtures.js';

describe('node get command', () => {
	let originalEnv: typeof process.env;
	let tempDir: string;
	let testDatabase: TestDatabase;

	beforeEach(() => {
		originalEnv = {...process.env};

		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-read-test-'));
		const testDbPath = path.join(tempDir, 'test.sqlite');
		testDatabase = createTestDatabase(testDbPath);
		process.env.WORKFLOWY_DB_PATH = testDbPath;
		process.env.WORKFLOWY_API_KEY = 'test-api-key';

		vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		process.env = originalEnv;

		cleanupTestDatabase(testDatabase);

		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, {recursive: true, force: true});
		}
	});

	describe('flag validation', () => {
		it('requires either --id or --path', async () => {
			await expect(Get.run([])).rejects.toThrow('Either --id or --path is required');
		});
	});

	describe('reading by ID', () => {
		it('reads a node by full UUID', async () => {
			const nodeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
			const now = new Date();
			const oneHourAgo = new Date(now.getTime() - 3600 * 1000);

			seedTestData(testDatabase, {
				nodes: [
					createTestNode({
						id: nodeId,
						name: 'Test Node',
						note: 'A test note',
						parentId: null,
						createdAt: oneHourAgo,
						modifiedAt: now,
					}),
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Get.run(['--id', nodeId, '--json']);
			});

			const output = JSON.parse(stdout);
			expect(output.id).toBe(nodeId);
			expect(output.name).toBe('Test Node');
			expect(output.note).toBe('A test note');
		});

		// Short ID resolution is tested at the CacheService level (test/shared/cache-service.test.ts)
		// Command-level testing has environment isolation issues with separate DB connections

		it('errors when node not found', async () => {
			await expect(Get.run(['--id', 'nonexistent-id'])).rejects.toThrow('Node not found with ID: nonexistent-id');
		});
	});

	describe('reading by path', () => {
		it('reads a node by path from cache', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'work-id', name: 'Work', parentId: null}),
					createTestNode({
						id: 'projects-id',
						name: 'Projects',
						parentId: 'work-id',
					}),
					createTestNode({
						id: 'target-id',
						name: 'My Project',
						note: 'Project notes',
						parentId: 'projects-id',
					}),
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Get.run(['--path', 'Work,Projects,My Project', '--json']);
			});

			const output = JSON.parse(stdout);
			expect(output.id).toBe('target-id');
			expect(output.name).toBe('My Project');
			expect(output.note).toBe('Project notes');
		});

		it('errors when path not found', async () => {
			await expect(Get.run(['--path', 'Missing,Path'])).rejects.toThrow('Node not found at path: Missing > Path');
		});
	});

	describe('children and depth', () => {
		it('fetches children with depth', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'parent-id', name: 'Parent', parentId: null}),
					createTestNode({
						id: 'child-1',
						name: 'Child 1',
						parentId: 'parent-id',
						priority: 0,
					}),
					createTestNode({
						id: 'child-2',
						name: 'Child 2',
						parentId: 'parent-id',
						priority: 1,
					}),
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Get.run(['--id', 'parent-id', '--depth', '1', '--json']);
			});

			const output = JSON.parse(stdout);
			expect(output.id).toBe('parent-id');
			expect(output.name).toBe('Parent');
			expect(output.children).toHaveLength(2);
			expect(output.children[0].id).toBe('child-1');
			expect(output.children[0].name).toBe('Child 1');
			expect(output.children[1].id).toBe('child-2');
			expect(output.children[1].name).toBe('Child 2');
		});

		it('returns node without children property when node has none', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'leaf-id', name: 'Leaf Node', parentId: null})],
			});

			const {stdout} = await captureOutput(async () => {
				await Get.run(['--id', 'leaf-id', '--depth', '1', '--json']);
			});

			const output = JSON.parse(stdout);
			expect(output.id).toBe('leaf-id');
			expect(output.name).toBe('Leaf Node');
			expect(output.children).toBeUndefined();
		});
	});

	describe('JSON output', () => {
		it('outputs correct JSON structure', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({
						id: 'json-node-id',
						name: 'JSON Node',
						note: 'Test note',
						parentId: null,
					}),
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Get.run(['--id', 'json-node-id', '--json']);
			});

			const output = JSON.parse(stdout);
			expect(output).toMatchObject({
				id: 'json-node-id',
				name: 'JSON Node',
				note: 'Test note',
			});
		});

		it('filters to only requested fields', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({
						id: 'filter-node-id',
						name: 'Filter Node',
						note: 'Note to filter',
						parentId: null,
					}),
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Get.run(['--id', 'filter-node-id', '--json', '--fields', 'id,name']);
			});

			const output = JSON.parse(stdout);
			expect(output).toStrictEqual({id: 'filter-node-id', name: 'Filter Node'});
		});
	});

	describe('mirror handling', () => {
		it('includes mirror info in JSON output', async () => {
			const systemFrom = formatTemporalTimestamp(new Date());

			seedTestData(testDatabase, {
				nodes: [
					createTestNode({
						id: 'original-id',
						name: 'Original Node',
						parentId: null,
						systemFrom,
					}),
					// A mirror carries no content of its own; it inherits the original's.
					createTestNode({
						id: 'mirror-id',
						name: '',
						parentId: null,
						systemFrom,
					}),
				],
				mirrors: [
					{
						mirrorId: 'mirror-id',
						originalId: 'original-id',
						systemFrom,
						systemTo: FAR_FUTURE_DATE,
					},
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Get.run(['--id', 'mirror-id', '--json']);
			});

			const output = JSON.parse(stdout);
			expect(output.id).toBe('mirror-id');
			expect(output.name).toBe('Original Node');
			expect(output.mirror).toStrictEqual({
				isMirror: true,
				originalNodeId: 'original-id',
			});
		});

		it('follows mirror to original with --follow-mirror', async () => {
			const systemFrom = formatTemporalTimestamp(new Date());

			seedTestData(testDatabase, {
				nodes: [
					createTestNode({
						id: 'original-id',
						name: 'Original Node',
						note: 'Original note',
						parentId: null,
						systemFrom,
					}),
					createTestNode({
						id: 'mirror-id',
						name: 'Mirror Node',
						parentId: null,
						systemFrom,
					}),
				],
				mirrors: [
					{
						mirrorId: 'mirror-id',
						originalId: 'original-id',
						systemFrom,
						systemTo: FAR_FUTURE_DATE,
					},
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Get.run(['--id', 'mirror-id', '--follow-mirror', '--json']);
			});

			const output = JSON.parse(stdout);
			expect(output.id).toBe('original-id');
			expect(output.name).toBe('Original Node');
			expect(output.note).toBe('Original note');
		});
	});

	describe('mirror resolution in children', () => {
		it('resolves mirror child content from original node', async () => {
			const systemFrom = formatTemporalTimestamp(new Date());

			seedTestData(testDatabase, {
				nodes: [
					createTestNode({
						id: 'parent-id',
						name: 'Parent',
						parentId: null,
						systemFrom,
					}),
					createTestNode({
						id: 'mirror-child-id',
						name: '',
						parentId: 'parent-id',
						priority: 0,
						systemFrom,
					}),
					createTestNode({
						id: 'original-node-id',
						name: 'Original Content',
						note: 'Original note',
						parentId: 'some-other-parent',
						systemFrom,
					}),
				],
				mirrors: [
					{
						mirrorId: 'mirror-child-id',
						originalId: 'original-node-id',
						systemFrom,
						systemTo: FAR_FUTURE_DATE,
					},
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Get.run(['--id', 'parent-id', '--depth', '1', '--json']);
			});

			const output = JSON.parse(stdout);
			expect(output.children).toHaveLength(1);
			expect(output.children[0].name).toBe('Original Content');
			expect(output.children[0].note).toBe('Original note');
			expect(output.children[0].mirror.isMirror).toBe(true);
			expect(output.children[0].mirror.originalNodeId).toBe('original-node-id');
		});

		it('resolves mirror children with filtered fields', async () => {
			const systemFrom = formatTemporalTimestamp(new Date());

			seedTestData(testDatabase, {
				nodes: [
					createTestNode({
						id: 'parent-id',
						name: 'Parent',
						parentId: null,
						systemFrom,
					}),
					createTestNode({
						id: 'mirror-child-id',
						name: '',
						parentId: 'parent-id',
						priority: 0,
						systemFrom,
					}),
					createTestNode({
						id: 'original-node-id',
						name: 'Original Content',
						parentId: 'some-other-parent',
						systemFrom,
					}),
				],
				mirrors: [
					{
						mirrorId: 'mirror-child-id',
						originalId: 'original-node-id',
						systemFrom,
						systemTo: FAR_FUTURE_DATE,
					},
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Get.run(['--id', 'parent-id', '--depth', '1', '--json', '--fields', 'id,name,children']);
			});

			const output = JSON.parse(stdout);
			expect(output.children).toHaveLength(1);
			expect(output.children[0].name).toBe('Original Content');
			expect(output.children[0].mirror.isMirror).toBe(true);
			expect(output.children[0].mirror.originalNodeId).toBe('original-node-id');
		});

		it('fetches children of original node for mirror children', async () => {
			const systemFrom = formatTemporalTimestamp(new Date());

			seedTestData(testDatabase, {
				nodes: [
					createTestNode({
						id: 'parent-id',
						name: 'Parent',
						parentId: null,
						systemFrom,
					}),
					createTestNode({
						id: 'mirror-child-id',
						name: '',
						parentId: 'parent-id',
						priority: 0,
						systemFrom,
					}),
					createTestNode({
						id: 'original-node-id',
						name: 'Original Content',
						parentId: 'some-other-parent',
						systemFrom,
					}),
					createTestNode({
						id: 'grandchild-1',
						name: 'Grandchild 1',
						parentId: 'original-node-id',
						priority: 0,
						systemFrom,
					}),
					createTestNode({
						id: 'grandchild-2',
						name: 'Grandchild 2',
						parentId: 'original-node-id',
						priority: 1,
						systemFrom,
					}),
				],
				mirrors: [
					{
						mirrorId: 'mirror-child-id',
						originalId: 'original-node-id',
						systemFrom,
						systemTo: FAR_FUTURE_DATE,
					},
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Get.run(['--id', 'parent-id', '--depth', '2', '--json']);
			});

			const output = JSON.parse(stdout);
			expect(output.children).toHaveLength(1);
			const mirrorChild = output.children[0];
			expect(mirrorChild.name).toBe('Original Content');
			expect(mirrorChild.mirror.isMirror).toBe(true);
			expect(mirrorChild.children).toHaveLength(2);
			expect(mirrorChild.children[0].name).toBe('Grandchild 1');
			expect(mirrorChild.children[1].name).toBe('Grandchild 2');
		});

		it('throws when a mirror child carries its own content (inverted relationship)', async () => {
			const systemFrom = formatTemporalTimestamp(new Date());

			// Invalid mirror data: the mirror row carries the display name while the
			// original is empty. A mirror must never hold its own content — this means
			// the relationship is recorded backwards, so the read must fail loudly.
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({
						id: 'parent-id',
						name: 'Parent',
						parentId: null,
						systemFrom,
					}),
					createTestNode({
						id: 'mirror-child-id',
						name: '⏰ Tasks (due dates) (work)',
						parentId: 'parent-id',
						priority: 0,
						systemFrom,
					}),
					createTestNode({
						id: 'original-node-id',
						name: '',
						note: null,
						parentId: 'some-other-parent',
						systemFrom,
					}),
				],
				mirrors: [
					{
						mirrorId: 'mirror-child-id',
						originalId: 'original-node-id',
						systemFrom,
						systemTo: FAR_FUTURE_DATE,
					},
				],
			});

			await expect(Get.run(['--id', 'parent-id', '--depth', '1', '--json'])).rejects.toThrow(/has its own name/);
		});
	});

	describe('completed status', () => {
		it('returns completedAt timestamp in JSON', async () => {
			// Use fixed dates for deterministic deep equality comparison
			const completedAt = new Date('2024-06-15T10:30:00.000Z');
			const createdAt = new Date('2024-06-15T08:00:00.000Z');
			const modifiedAt = new Date('2024-06-15T10:30:00.000Z');

			seedTestData(testDatabase, {
				nodes: [
					createTestNode({
						id: 'completed-node',
						name: 'Completed Task',
						parentId: null,
						completedAt,
						createdAt,
						modifiedAt,
					}),
				],
			});

			const {stdout} = await captureOutput(async () => {
				await Get.run(['--id', 'completed-node', '--json']);
			});

			const output = JSON.parse(stdout);

			// Delete dynamic fields before deep equality comparison
			delete output.systemFrom;
			delete output.path;

			expect(output).toStrictEqual({
				id: 'completed-node',
				shortId: 'ompletednode', // getShortId removes dashes and takes last 12 chars
				name: 'Completed Task',
				note: null,
				parentId: null,
				priority: 0, // default from createTestNode
				createdAt: '2024-06-15T08:00:00.000Z',
				modifiedAt: '2024-06-15T10:30:00.000Z',
				completedAt: '2024-06-15T10:30:00.000Z',
				layoutMode: 'bullets', // default from createTestNode
				collapsed: false,
				mirror: {isMirror: false, originalNodeId: null},
				systemTo: FAR_FUTURE_DATE,
				inChat: false,
				hasReferencesRoot: false,
			});
		});
	});

	describe('command metadata', () => {
		it('has correct description', () => {
			expect(Get.description).toBe('Read a single Workflowy node with optional children');
		});

		it('has examples', () => {
			expect(Array.isArray(Get.examples)).toBe(true);
			expect(Get.examples!.length).toBeGreaterThan(0);
		});
	});
});
