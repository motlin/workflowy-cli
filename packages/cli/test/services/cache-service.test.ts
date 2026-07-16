import {backlinks, mirrors, nodeContent, nodeMetadata, virtualRootIds} from '@workflowy/shared/db';
import {FAR_FUTURE_DATE, formatTemporalTimestamp} from '@workflowy/shared/temporal';
import {eq} from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CacheService} from '@workflowy/shared/cache';
import {cleanupTestDatabase, createTestDatabase, seedTestData, type TestDatabase} from '../db/migration-helper.js';
import {
	createApiNode,
	createNodeFromContent,
	createTestNode,
	splitNodeIntoContentAndMetadata,
} from '../helpers/node-fixtures.js';
import {expectActiveRecord, expectPhasedOut} from '../helpers/assertion-helpers.js';

describe('CacheService (shared)', () => {
	let tempDir: string;
	let testDatabase: TestDatabase;
	let cacheService: CacheService;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-cache-test-'));
		const testDbPath = path.join(tempDir, 'test.sqlite');
		testDatabase = createTestDatabase(testDbPath);
		cacheService = new CacheService(testDatabase.db);
	});

	afterEach(() => {
		cleanupTestDatabase(testDatabase);
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, {recursive: true, force: true});
		}
	});

	describe('getNode', () => {
		it('returns node by ID', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'node-1', name: 'Test Node'})],
			});

			const node = await cacheService.getNode('node-1');

			expect(node).toBeDefined();
			expect({id: node!.id, name: node!.name}).toStrictEqual({id: 'node-1', name: 'Test Node'});
		});

		it('returns undefined for non-existent node', async () => {
			const node = await cacheService.getNode('non-existent');
			expect(node).toBeUndefined();
		});

		it('only returns active records (systemTo = FAR_FUTURE_DATE)', async () => {
			const now = formatTemporalTimestamp(new Date());
			const earlier = formatTemporalTimestamp(new Date(Date.now() - 1000));
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'node-1', name: 'Historical', systemFrom: earlier, systemTo: now}),
					createTestNode({id: 'node-1', name: 'Current', systemFrom: now, systemTo: FAR_FUTURE_DATE}),
				],
			});

			const node = await cacheService.getNode('node-1');

			expect(node).toBeDefined();
			expect(node!.name).toBe('Current');
		});
	});

	describe('getChildren', () => {
		it('returns children of a parent node', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'parent', name: 'Parent', parentId: null}),
					createTestNode({id: 'child-1', name: 'Child 1', parentId: 'parent', priority: 0}),
					createTestNode({id: 'child-2', name: 'Child 2', parentId: 'parent', priority: 1}),
				],
			});

			const children = await cacheService.getChildren('parent');

			expect(children.map((c) => c.name)).toStrictEqual(['Child 1', 'Child 2']);
		});

		it('returns root nodes when parentId is null', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'root-1', name: 'Root 1', parentId: null, priority: 0}),
					createTestNode({id: 'root-2', name: 'Root 2', parentId: null, priority: 1}),
					createTestNode({id: 'child', name: 'Child', parentId: 'root-1'}),
				],
			});

			const roots = await cacheService.getChildren(null);

			expect(roots.map((r) => r.name)).toStrictEqual(['Root 1', 'Root 2']);
		});

		it('orders children by priority then createdAt', async () => {
			const now = new Date();
			const nowPlusOne = new Date(now.getTime() + 1000);
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'parent', name: 'Parent', parentId: null}),
					createTestNode({id: 'c', name: 'C', parentId: 'parent', priority: 1, createdAt: now}),
					createTestNode({id: 'a', name: 'A', parentId: 'parent', priority: 0, createdAt: nowPlusOne}),
					createTestNode({id: 'b', name: 'B', parentId: 'parent', priority: 0, createdAt: now}),
				],
			});

			const children = await cacheService.getChildren('parent');

			expect(children.map((c) => c.name)).toStrictEqual(['B', 'A', 'C']);
		});

		it('returns empty array for node with no children', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent', name: 'Parent', parentId: null})],
			});

			const children = await cacheService.getChildren('parent');

			expect(children).toStrictEqual([]);
		});

		it('excludes historical records', async () => {
			const now = formatTemporalTimestamp(new Date());
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'parent', name: 'Parent', parentId: null}),
					createTestNode({id: 'child-1', name: 'Active', parentId: 'parent', systemTo: FAR_FUTURE_DATE}),
					createTestNode({id: 'child-2', name: 'Historical', parentId: 'parent', systemTo: now}),
				],
			});

			const children = await cacheService.getChildren('parent');

			expect(children).toHaveLength(1);
			expect(children[0].name).toBe('Active');
		});
	});

	describe('getChildByName', () => {
		it('finds child by exact name', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'parent', name: 'Parent', parentId: null}),
					createTestNode({id: 'child', name: 'Target', parentId: 'parent'}),
				],
			});

			const child = await cacheService.getChildByName('parent', 'Target');

			expect(child).not.toBeNull();
			expect(child!.id).toBe('child');
		});

		it('returns null when name not found', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'parent', name: 'Parent', parentId: null}),
					createTestNode({id: 'child', name: 'Other', parentId: 'parent'}),
				],
			});

			const child = await cacheService.getChildByName('parent', 'Target');

			expect(child).toBeNull();
		});

		it('finds root node by name when parentId is null', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'root', name: 'Root Node', parentId: null})],
			});

			const root = await cacheService.getChildByName(null, 'Root Node');

			expect(root).not.toBeNull();
			expect(root!.id).toBe('root');
		});
	});

	describe('getNodeWithMergedData', () => {
		it('returns node with cache source', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'node-1', name: 'Test'})],
			});

			const result = await cacheService.getNodeWithMergedData('node-1');

			expect(result.node).toBeDefined();
			expect(result.source).toBe('cache');
			expect(result.fetchedAt).toBeInstanceOf(Date);
		});

		it('returns none source for missing node', async () => {
			const result = await cacheService.getNodeWithMergedData('missing');

			expect(result.node).toBeUndefined();
			expect(result.source).toBe('none');
		});
	});

	describe('findNodeByPath', () => {
		it('finds node at simple path', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'root', name: 'Root', parentId: null})],
			});

			const node = await cacheService.findNodeByPath(['Root']);

			expect(node).not.toBeNull();
			expect(node!.id).toBe('root');
		});

		it('finds node at nested path', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'l1', name: 'Level1', parentId: null}),
					createTestNode({id: 'l2', name: 'Level2', parentId: 'l1'}),
					createTestNode({id: 'l3', name: 'Level3', parentId: 'l2'}),
				],
			});

			const node = await cacheService.findNodeByPath(['Level1', 'Level2', 'Level3']);

			expect(node).not.toBeNull();
			expect(node!.id).toBe('l3');
		});

		it('returns null for non-existent path', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'root', name: 'Root', parentId: null})],
			});

			const node = await cacheService.findNodeByPath(['Root', 'Missing']);

			expect(node).toBeNull();
		});

		it('returns null for empty path', async () => {
			const node = await cacheService.findNodeByPath([]);
			expect(node).toBeNull();
		});

		it('returns root node for empty path with rootId', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'root', name: 'Root', parentId: null})],
			});

			const node = await cacheService.findNodeByPath([], 'root');

			expect(node).not.toBeNull();
			expect(node!.id).toBe('root');
		});

		it('matches exactly, never on a substring', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'archive', name: 'Review Archive', parentId: null})],
			});

			// 'Review' is a substring of 'Review Archive' but must not match: this API is exact-only.
			const node = await cacheService.findNodeByPath(['Review']);

			expect(node).toBeNull();
		});
	});

	describe('storeApiResponse', () => {
		it('inserts new nodes', async () => {
			const apiNodes = [
				createApiNode({id: 'node-1', name: 'Node 1', parent_id: null, priority: 0}),
				createApiNode({id: 'node-2', name: 'Node 2', parent_id: null, priority: 1}),
			];

			await cacheService.storeApiResponse(apiNodes, null);

			const stored = testDatabase.db
				.select()
				.from(nodeContent)
				.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
				.all();
			expect(stored.map((s) => s.id).sort()).toStrictEqual(['node-1', 'node-2']);
		});

		it('updates changed nodes with temporal versioning', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'node-1', name: 'Old Name', parentId: null})],
			});

			const apiNodes = [createApiNode({id: 'node-1', name: 'New Name', parent_id: null})];

			await cacheService.storeApiResponse(apiNodes, null);

			const allRecords = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, 'node-1')).all();
			expect(allRecords).toHaveLength(2);

			const activeRecord = allRecords.find((r) => r.systemTo === FAR_FUTURE_DATE)!;
			expect(activeRecord.name).toBe('New Name');

			const historicalRecord = allRecords.find((r) => r.systemTo !== FAR_FUTURE_DATE)!;
			expect(historicalRecord.name).toBe('Old Name');
		});

		it('phases out cached children not in API response', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'parent', name: 'Parent', parentId: null}),
					createTestNode({id: 'child-1', name: 'Keep', parentId: 'parent'}),
					createTestNode({id: 'child-2', name: 'Delete', parentId: 'parent'}),
				],
			});

			const apiNodes = [createApiNode({id: 'child-1', name: 'Keep', parent_id: 'parent'})];

			await cacheService.storeApiResponse(apiNodes, 'parent');

			const child2Content = testDatabase.db
				.select()
				.from(nodeContent)
				.where(eq(nodeContent.id, 'child-2'))
				.get()!;
			const child2 = createNodeFromContent(child2Content);
			expectPhasedOut(child2);
		});

		it('creates placeholder parent if not exists', async () => {
			const apiNodes = [createApiNode({id: 'child', name: 'Child', parent_id: 'parent'})];

			await cacheService.storeApiResponse(apiNodes, 'parent');

			const parent = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, 'parent')).get()!;
			expect(parent.name).toBeNull();
		});

		it('does not affect unchanged nodes', async () => {
			const now = new Date();
			const nowSeconds = Math.floor(now.getTime() / 1000);
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({
						id: 'node-1',
						name: 'Same',
						note: null,
						parentId: null,
						priority: 0,
						createdAt: now,
						modifiedAt: now,
						completedAt: null,
						layoutMode: null,
					}),
				],
			});

			const initialRecord = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, 'node-1')).get()!;

			const apiNodes = [
				createApiNode({
					id: 'node-1',
					name: 'Same',
					note: null,
					parent_id: null,
					priority: 0,
					createdAt: nowSeconds,
					modifiedAt: nowSeconds,
					completedAt: null,
					data: {layoutMode: 'bullets'},
				}),
			];

			await cacheService.storeApiResponse(apiNodes, null);

			const allRecords = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, 'node-1')).all();
			expect(allRecords).toHaveLength(1);
			expect(allRecords[0].systemFrom).toBe(initialRecord.systemFrom);
		});
	});

	describe('insertNode', () => {
		it('inserts new node', async () => {
			const apiNode = createApiNode({id: 'new-node', name: 'New Node', parent_id: null});

			await cacheService.insertNode(apiNode, null);

			const stored = await cacheService.getNode('new-node');
			expect(stored).toBeDefined();
			expect(stored!.name).toBe('New Node');
		});

		it('does not phase out siblings', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'parent', name: 'Parent', parentId: null}),
					createTestNode({id: 'sibling', name: 'Sibling', parentId: 'parent'}),
				],
			});

			const apiNode = createApiNode({id: 'new-node', name: 'New Node', parent_id: 'parent'});

			await cacheService.insertNode(apiNode, 'parent');

			const sibling = await cacheService.getNode('sibling');
			expect(sibling).toBeDefined();
			expectActiveRecord(sibling!);
		});

		it('updates existing node with temporal versioning', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'node-1', name: 'Old', parentId: null})],
			});

			const apiNode = createApiNode({id: 'node-1', name: 'Updated', parent_id: null});

			await cacheService.insertNode(apiNode, null);

			const allRecords = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, 'node-1')).all();
			expect(allRecords).toHaveLength(2);

			const activeRecord = allRecords.find((r) => r.systemTo === FAR_FUTURE_DATE)!;
			expect(activeRecord.name).toBe('Updated');
		});

		it('normalizes layoutMode on a brand-new insert', async () => {
			// 'bullets' is the default layout and normalizes to null (see normalizeLayoutMode).
			const apiNode = createApiNode({id: 'new-node', name: 'New Node', parent_id: null});

			await cacheService.insertNode(apiNode, null);

			const meta = testDatabase.db.select().from(nodeMetadata).where(eq(nodeMetadata.nodeId, 'new-node')).get()!;
			expect(meta.layoutMode).toBeNull();
		});
	});

	describe('deleteNode', () => {
		it('phases out node and descendants', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'parent', name: 'Parent', parentId: null}),
					createTestNode({id: 'child', name: 'Child', parentId: 'parent'}),
					createTestNode({id: 'grandchild', name: 'Grandchild', parentId: 'child'}),
				],
			});

			await cacheService.deleteNode('parent');

			for (const id of ['parent', 'child', 'grandchild']) {
				const content = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, id)).get()!;
				expectPhasedOut(createNodeFromContent(content));
			}
		});

		it('does not affect siblings', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'root', name: 'Root', parentId: null}),
					createTestNode({id: 'node-1', name: 'Node 1', parentId: 'root'}),
					createTestNode({id: 'node-2', name: 'Node 2', parentId: 'root'}),
				],
			});

			await cacheService.deleteNode('node-1');

			const node2 = await cacheService.getNode('node-2');
			expect(node2).toBeDefined();
			expectActiveRecord(node2!);
		});

		it('closes backlinks and virtualRootIds for the deleted subtree', async () => {
			const from = formatTemporalTimestamp(new Date(Date.now() - 1000));
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'parent', name: 'Parent', parentId: null}),
					createTestNode({id: 'child', name: 'Child', parentId: 'parent'}),
				],
				backlinks: [
					{
						nodeId: 'child',
						sourceId: 'child',
						targetId: 'other',
						systemFrom: from,
						systemTo: FAR_FUTURE_DATE,
					},
				],
				virtualRootIds: [
					{nodeId: 'parent', virtualRootId: 'vroot-1', systemFrom: from, systemTo: FAR_FUTURE_DATE},
				],
			});

			await cacheService.deleteNode('parent');

			const bl = testDatabase.db.select().from(backlinks).where(eq(backlinks.nodeId, 'child')).get()!;
			expect(bl.systemTo).not.toBe(FAR_FUTURE_DATE);
			const vr = testDatabase.db.select().from(virtualRootIds).where(eq(virtualRootIds.nodeId, 'parent')).get()!;
			expect(vr.systemTo).not.toBe(FAR_FUTURE_DATE);
		});

		it('closes mirror rows on both sides of a genuine deletion', async () => {
			const from = formatTemporalTimestamp(new Date(Date.now() - 1000));
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'copy', name: '', parentId: null}),
					createTestNode({id: 'orig', name: 'Original', parentId: 'elsewhere'}),
					createTestNode({id: 'copy2', name: '', parentId: null}),
					createTestNode({id: 'orig2', name: 'Original 2', parentId: 'elsewhere'}),
				],
				mirrors: [
					// Deleting the copy must close the row via mirrorId.
					{originalId: 'orig', mirrorId: 'copy', systemFrom: from, systemTo: FAR_FUTURE_DATE},
					// Deleting the original must close the row via originalId.
					{originalId: 'orig2', mirrorId: 'copy2', systemFrom: from, systemTo: FAR_FUTURE_DATE},
				],
			});

			await cacheService.deleteNode('copy');
			await cacheService.deleteNode('orig2');

			const byCopy = testDatabase.db.select().from(mirrors).where(eq(mirrors.mirrorId, 'copy')).get()!;
			expect(byCopy.systemTo).not.toBe(FAR_FUTURE_DATE);
			const byOriginal = testDatabase.db.select().from(mirrors).where(eq(mirrors.originalId, 'orig2')).get()!;
			expect(byOriginal.systemTo).not.toBe(FAR_FUTURE_DATE);
		});

		it('leaves a surviving node backlink that merely targets the deleted node', async () => {
			const from = formatTemporalTimestamp(new Date(Date.now() - 1000));
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'survivor', name: 'Survivor', parentId: null}),
					createTestNode({id: 'target', name: 'Target', parentId: null}),
				],
				// Owned by the survivor (nodeId=survivor), pointing at the deleted node.
				backlinks: [
					{
						nodeId: 'survivor',
						sourceId: 'survivor',
						targetId: 'target',
						systemFrom: from,
						systemTo: FAR_FUTURE_DATE,
					},
				],
			});

			await cacheService.deleteNode('target');

			const bl = testDatabase.db.select().from(backlinks).where(eq(backlinks.nodeId, 'survivor')).get()!;
			expect(bl.systemTo).toBe(FAR_FUTURE_DATE);
		});
	});

	describe('getChildrenWithMergedData', () => {
		it('returns cache nodes with relations', async () => {
			const now = new Date();
			const parentNode = createTestNode({id: 'parent', name: 'Parent', parentId: null});
			const childNode = createTestNode({
				id: 'child',
				name: 'Child',
				note: 'A note',
				parentId: 'parent',
				priority: 0,
				createdAt: now,
				modifiedAt: now,
				layoutMode: 'document',
			});

			const {content: parentContent, metadata: parentMetadata} = splitNodeIntoContentAndMetadata(parentNode);
			const {content: childContent, metadata: childMetadata} = splitNodeIntoContentAndMetadata(childNode);

			seedTestData(testDatabase, {
				nodeContent: [parentContent, childContent],
				nodeMetadata: [parentMetadata, childMetadata],
			});

			const result = await cacheService.getChildrenWithMergedData('parent');

			expect(result).toHaveLength(1);
			expect({
				id: result[0].id,
				name: result[0].name,
				note: result[0].note,
				layoutMode: result[0].layoutMode,
			}).toStrictEqual({
				id: 'child',
				name: 'Child',
				note: 'A note',
				layoutMode: 'document',
			});
		});

		it('returns empty array for no children', async () => {
			const parentNode = createTestNode({id: 'parent', name: 'Parent', parentId: null});
			const {content: parentContent, metadata: parentMetadata} = splitNodeIntoContentAndMetadata(parentNode);

			seedTestData(testDatabase, {
				nodeContent: [parentContent],
				nodeMetadata: [parentMetadata],
			});

			const result = await cacheService.getChildrenWithMergedData('parent');

			expect(result).toStrictEqual([]);
		});
	});

	describe('getChildrenForMultipleParents', () => {
		it('returns children grouped by parent', async () => {
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: 'parent-1', name: 'Parent 1', parentId: null}),
					createTestNode({id: 'parent-2', name: 'Parent 2', parentId: null}),
					createTestNode({id: 'child-1a', name: 'Child 1A', parentId: 'parent-1'}),
					createTestNode({id: 'child-1b', name: 'Child 1B', parentId: 'parent-1'}),
					createTestNode({id: 'child-2a', name: 'Child 2A', parentId: 'parent-2'}),
				],
			});

			const result = await cacheService.getChildrenForMultipleParents(['parent-1', 'parent-2']);

			expect(result.get('parent-1')!.length).toBe(2);
			expect(result.get('parent-2')!.length).toBe(1);
		});

		it('returns empty arrays for parents with no children', async () => {
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: 'parent', name: 'Parent', parentId: null})],
			});

			const result = await cacheService.getChildrenForMultipleParents(['parent', 'missing']);

			expect(result.get('parent')).toStrictEqual([]);
			expect(result.get('missing')).toStrictEqual([]);
		});

		it('returns empty map for empty input', async () => {
			const result = await cacheService.getChildrenForMultipleParents([]);
			expect(result.size).toBe(0);
		});
	});

	describe('resolveShortIdToUuid', () => {
		it('resolves short ID to full UUID', async () => {
			const fullId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
			const shortId = 'eeeeeeeeeeee';
			seedTestData(testDatabase, {
				nodes: [createTestNode({id: fullId, shortId, name: 'Test', parentId: null})],
			});

			const result = await cacheService.resolveShortIdToUuid(shortId);

			expect(result).toBe(fullId);
		});

		it('returns null for non-existent short ID', async () => {
			const result = await cacheService.resolveShortIdToUuid('nonexistent12');
			expect(result).toBeNull();
		});
	});

	describe('resolveMultipleShortIds', () => {
		it('resolves multiple short IDs', async () => {
			const id1 = 'aaaaaaaa-1111-2222-3333-444444444444';
			const id2 = 'bbbbbbbb-1111-2222-3333-555555555555';
			seedTestData(testDatabase, {
				nodes: [
					createTestNode({id: id1, shortId: '444444444444', name: 'Node 1', parentId: null}),
					createTestNode({id: id2, shortId: '555555555555', name: 'Node 2', parentId: null}),
				],
			});

			const result = await cacheService.resolveMultipleShortIds(['444444444444', '555555555555']);

			expect(result.get('444444444444')).toBe(id1);
			expect(result.get('555555555555')).toBe(id2);
		});

		it('returns empty map for empty input', async () => {
			const result = await cacheService.resolveMultipleShortIds([]);
			expect(result.size).toBe(0);
		});
	});
});
