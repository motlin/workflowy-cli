import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {WorkflowyApiClient} from '@workflowy/shared/api';
import type {MockInstance} from 'vite-plus/test';
import {CacheService} from '../../src/services/cache.js';
import {
	resolveNodeId,
	resolveOptionalNodeId,
	resolveOptionalParent,
	resolveOrCreateNodePath,
	resolveParent,
} from '@workflowy/shared/utils';
import {cleanupTestDatabase, createTestDatabase, seedTestData, type TestDatabase} from '../db/migration-helper.js';
import {createApiNode, createTestNode} from '../helpers/node-fixtures.js';

describe('node-resolver service', () => {
	let tempDir: string;
	let testDatabase: TestDatabase;
	let cacheService: CacheService;
	let mockApiClient: {
		findNodeByPath: MockInstance<WorkflowyApiClient['findNodeByPath']>;
		createNode: MockInstance<WorkflowyApiClient['createNode']>;
	};

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-resolver-test-'));
		const testDbPath = path.join(tempDir, 'test.sqlite');
		testDatabase = createTestDatabase(testDbPath);
		cacheService = new CacheService(testDatabase.db);

		mockApiClient = {
			findNodeByPath: vi.fn<WorkflowyApiClient['findNodeByPath']>(),
			createNode: vi.fn<WorkflowyApiClient['createNode']>(),
		};
	});

	afterEach(() => {
		cleanupTestDatabase(testDatabase);
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, {recursive: true, force: true});
		}
	});

	describe('resolveNodeId', () => {
		it('returns id directly when provided', async () => {
			const result = await resolveNodeId({id: 'direct-id'}, cacheService, mockApiClient as never);

			expect(result).toBe('direct-id');
			expect(mockApiClient.findNodeByPath).not.toHaveBeenCalled();
		});

		it('resolves a short ID from the cache', async () => {
			const fullId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: fullId, shortId: 'eeeeeeeeeeee', name: 'Test node', parentId: null})],
			});

			const result = await resolveNodeId({id: 'eeeeeeeeeeee'}, cacheService, mockApiClient as never);

			expect(result).toBe(fullId);
			expect(mockApiClient.findNodeByPath).not.toHaveBeenCalled();
		});

		it('throws an error when a short ID is not in the cache', async () => {
			await expect(resolveNodeId({id: 'aaaaaaaaaaaa'}, cacheService, mockApiClient as never)).rejects.toThrow(
				'No node found for short ID: aaaaaaaaaaaa',
			);
		});

		it('resolves path from cache', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'root-id', name: 'Root', parentId: null}),
					createTestNode({id: 'child-id', name: 'Child', parentId: 'root-id'}),
				],
			});

			const result = await resolveNodeId({path: 'Root,Child'}, cacheService, mockApiClient as never);

			expect(result).toBe('child-id');
			expect(mockApiClient.findNodeByPath).not.toHaveBeenCalled();
		});

		it('falls back to API when not in cache', async () => {
			mockApiClient.findNodeByPath.mockResolvedValue(createApiNode({id: 'api-resolved-id'}));

			const result = await resolveNodeId({path: 'Missing,Path'}, cacheService, mockApiClient as never);

			expect(result).toBe('api-resolved-id');
			expect(mockApiClient.findNodeByPath).toHaveBeenCalledTimes(1);
			expect(mockApiClient.findNodeByPath.mock.calls[0][0]).toStrictEqual(['Missing', 'Path']);
		});

		it('throws error when node not found', async () => {
			mockApiClient.findNodeByPath.mockResolvedValue(null);

			await expect(resolveNodeId({path: 'Missing,Path'}, cacheService, mockApiClient as never)).rejects.toThrow(
				'Node not found at path: Missing > Path',
			);
		});

		it('trims whitespace from path segments', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'target', name: 'Target', parentId: null})],
			});

			const result = await resolveNodeId({path: '  Target  '}, cacheService, mockApiClient as never);

			expect(result).toBe('target');
		});
	});

	describe('resolveOptionalNodeId', () => {
		it('returns undefined when no id or path provided', async () => {
			const result = await resolveOptionalNodeId({}, cacheService, mockApiClient as never);
			expect(result).toBeUndefined();
		});

		it('resolves id when provided', async () => {
			const result = await resolveOptionalNodeId({id: 'my-id'}, cacheService, mockApiClient as never);
			expect(result).toBe('my-id');
		});

		it('resolves path when provided', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'resolved-id', name: 'Target', parentId: null})],
			});

			const result = await resolveOptionalNodeId({path: 'Target'}, cacheService, mockApiClient as never);
			expect(result).toBe('resolved-id');
		});
	});

	describe('resolveParent', () => {
		it('returns id directly when provided', async () => {
			const result = await resolveParent({id: 'parent-id'}, cacheService, mockApiClient as never);
			expect(result).toBe('parent-id');
		});

		it('returns system target key directly when passed via id', async () => {
			const result = await resolveParent({id: 'inbox'}, cacheService, mockApiClient as never);
			expect(result).toBe('inbox');
		});

		it('resolves a short ID from the cache', async () => {
			const fullId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: fullId, shortId: 'eeeeeeeeeeee', name: 'Parent', parentId: null})],
			});

			const result = await resolveParent({id: 'eeeeeeeeeeee'}, cacheService, mockApiClient as never);

			expect(result).toBe(fullId);
			expect(mockApiClient.findNodeByPath).not.toHaveBeenCalled();
		});

		it('throws an error when a short ID is not in the cache', async () => {
			await expect(resolveParent({id: 'aaaaaaaaaaaa'}, cacheService, mockApiClient as never)).rejects.toThrow(
				'No node found for short ID: aaaaaaaaaaaa',
			);
		});

		it('resolves path from cache', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'root-id', name: 'Root', parentId: null}),
					createTestNode({id: 'parent-id', name: 'Parent', parentId: 'root-id'}),
				],
			});

			const result = await resolveParent({path: 'Root,Parent'}, cacheService, mockApiClient as never);
			expect(result).toBe('parent-id');
		});

		it('falls back to API for path resolution', async () => {
			mockApiClient.findNodeByPath.mockResolvedValue(createApiNode({id: 'api-parent-id'}));

			const result = await resolveParent({path: 'Missing,Parent'}, cacheService, mockApiClient as never);

			expect(result).toBe('api-parent-id');
			expect(mockApiClient.findNodeByPath).toHaveBeenCalledTimes(1);
		});

		it('throws error when no flags provided', async () => {
			await expect(resolveParent({}, cacheService, mockApiClient as never)).rejects.toThrow(
				'One of --parent-id or --parent-path is required',
			);
		});

		it('throws error when multiple flags provided', async () => {
			await expect(resolveParent({id: 'id', path: 'path'}, cacheService, mockApiClient as never)).rejects.toThrow(
				'Only one of --parent-id or --parent-path can be specified',
			);
		});

		it('throws error when path not found', async () => {
			mockApiClient.findNodeByPath.mockResolvedValue(null);

			await expect(resolveParent({path: 'Missing,Node'}, cacheService, mockApiClient as never)).rejects.toThrow(
				'Node not found at path: Missing > Node',
			);
		});
	});

	describe('resolveOptionalParent', () => {
		it('returns undefined when no flags provided', async () => {
			const result = await resolveOptionalParent({}, cacheService, mockApiClient as never);
			expect(result).toBeUndefined();
		});

		it('resolves id when provided', async () => {
			const result = await resolveOptionalParent({id: 'parent-id'}, cacheService, mockApiClient as never);
			expect(result).toBe('parent-id');
		});

		it('resolves system target when passed via id', async () => {
			const result = await resolveOptionalParent({id: 'inbox'}, cacheService, mockApiClient as never);
			expect(result).toBe('inbox');
		});

		it('resolves path when provided', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'target-id', name: 'Target', parentId: null})],
			});

			const result = await resolveOptionalParent({path: 'Target'}, cacheService, mockApiClient as never);
			expect(result).toBe('target-id');
		});
	});

	describe('resolveOrCreateNodePath', () => {
		it('resolves existing path without creating', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'root-id', name: 'Root', parentId: null}),
					createTestNode({id: 'leaf-id', name: 'Leaf', parentId: 'root-id'}),
				],
			});

			const result = await resolveOrCreateNodePath('Root,Leaf', cacheService, mockApiClient as never);

			expect(result).toBe('leaf-id');
			expect(mockApiClient.createNode).not.toHaveBeenCalled();
		});

		it('creates missing path segments', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'root-id', name: 'Root', parentId: null})],
			});

			const now = Date.now();
			mockApiClient.createNode.mockResolvedValue(
				createApiNode({id: 'new-child-id', name: 'NewChild', parent_id: 'root-id', createdAt: now}),
			);

			const result = await resolveOrCreateNodePath('Root,NewChild', cacheService, mockApiClient as never);

			expect(result).toBe('new-child-id');
			expect(mockApiClient.createNode).toHaveBeenCalledTimes(1);
			expect(mockApiClient.createNode.mock.calls[0][0]).toStrictEqual({
				parent_id: 'root-id',
				name: 'NewChild',
			});
		});

		it('creates multiple missing segments', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'root-id', name: 'Root', parentId: null})],
			});

			const now = Date.now();
			mockApiClient.createNode.mockResolvedValueOnce(
				createApiNode({id: 'level2-id', name: 'Level2', parent_id: 'root-id', createdAt: now}),
			);
			mockApiClient.createNode.mockResolvedValueOnce(
				createApiNode({id: 'level3-id', name: 'Level3', parent_id: 'level2-id', createdAt: now}),
			);

			const result = await resolveOrCreateNodePath('Root,Level2,Level3', cacheService, mockApiClient as never);

			expect(result).toBe('level3-id');
			expect(mockApiClient.createNode).toHaveBeenCalledTimes(2);
		});

		it('throws error for root-level creation', async () => {
			mockApiClient.findNodeByPath.mockResolvedValue(null);

			await expect(
				resolveOrCreateNodePath('NewRoot,Child', cacheService, mockApiClient as never),
			).rejects.toThrow(
				'Cannot create path "NewRoot,Child": first segment "NewRoot" does not exist. Root-level node creation is not supported.',
			);
		});

		it('deduplicates created nodes within same call', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'root-id', name: 'Root', parentId: null})],
			});

			const now = Date.now();
			mockApiClient.createNode.mockResolvedValue(
				createApiNode({id: 'new-id', name: 'New', parent_id: 'root-id', createdAt: now}),
			);

			// This shouldn't happen in real usage, but tests the dedup logic
			const result = await resolveOrCreateNodePath('Root,New', cacheService, mockApiClient as never);

			expect(result).toBe('new-id');
			expect(mockApiClient.createNode).toHaveBeenCalledTimes(1);
		});

		it('caches created nodes in database', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'root-id', name: 'Root', parentId: null})],
			});

			const now = Date.now();
			mockApiClient.createNode.mockResolvedValue(
				createApiNode({id: 'cached-id', name: 'Cached', parent_id: 'root-id', createdAt: now}),
			);

			await resolveOrCreateNodePath('Root,Cached', cacheService, mockApiClient as never);

			// Verify node was cached
			const cached = await cacheService.getNode('cached-id');
			expect(cached).toBeDefined();
			expect(cached!.name).toBe('Cached');
		});
	});
});
