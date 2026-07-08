import {nodeContent, nodeMetadata} from '@workflowy/shared/db';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import type {WorkflowyNode} from '@workflowy/shared/types';
import {eq} from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {importFromApi} from '../../src/services/cache-import-api.js';
import {cleanupTestDatabase, createTestDatabase, type TestDatabase} from '../db/migration-helper.js';
import {createApiNode, createNodeFromContent} from '../helpers/node-fixtures.js';
import {expectActiveRecord} from '../helpers/assertion-helpers.js';

function expectImportStats(
	result: Awaited<ReturnType<typeof importFromApi>>,
	expected: {
		totalNodes: number;
		nodesAdded: number;
		nodesUpdated: number;
		nodesUnchanged: number;
		nodesDeleted: number;
		nodesPhasedOut: number;
		contentUpdated: number;
		metadataUpdated: number;
		priorityUpdated: number;
	},
) {
	expect(result.importTimestamp).toBeInstanceOf(Date);
	const {
		totalNodes,
		nodesAdded,
		nodesUpdated,
		nodesUnchanged,
		nodesDeleted,
		nodesPhasedOut,
		contentUpdated,
		metadataUpdated,
		priorityUpdated,
	} = result;
	const stats = {
		totalNodes,
		nodesAdded,
		nodesUpdated,
		nodesUnchanged,
		nodesDeleted,
		nodesPhasedOut,
		contentUpdated,
		metadataUpdated,
		priorityUpdated,
	};
	expect(stats).toStrictEqual(expected);
}

describe('cache-import-api service', () => {
	let tempDir: string;
	let testDatabase: TestDatabase;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-api-import-test-'));
		const testDbPath = path.join(tempDir, 'test.sqlite');
		testDatabase = createTestDatabase(testDbPath);
	});

	afterEach(() => {
		cleanupTestDatabase(testDatabase);
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, {recursive: true, force: true});
		}
	});

	describe('import into empty database', () => {
		it('imports a single API node', async () => {
			const apiNodes: WorkflowyNode[] = [createApiNode({id: 'node-1', name: 'Test Node'})];

			const result = await importFromApi(testDatabase.db, apiNodes);

			expectImportStats(result, {
				totalNodes: 1,
				nodesAdded: 1,
				nodesUpdated: 0,
				nodesUnchanged: 0,
				nodesDeleted: 0,
				nodesPhasedOut: 0,
				contentUpdated: 0,
				metadataUpdated: 0,
				priorityUpdated: 0,
			});

			const allNodes = testDatabase.db.select().from(nodeContent).all();
			const {id, name, note, parentId, systemTo} = allNodes[0];
			expect({id, name, note, parentId, systemTo}).toStrictEqual({
				id: 'node-1',
				name: 'Test Node',
				note: null,
				parentId: null,
				systemTo: FAR_FUTURE_DATE,
			});
			expectActiveRecord(createNodeFromContent(allNodes[0]));
		});

		it('imports multiple API nodes', async () => {
			const apiNodes: WorkflowyNode[] = [
				createApiNode({id: 'node-1', name: 'First Node', priority: 0}),
				createApiNode({id: 'node-2', name: 'Second Node', priority: 1}),
				createApiNode({id: 'node-3', name: 'Third Node', priority: 2}),
			];

			const result = await importFromApi(testDatabase.db, apiNodes);

			expectImportStats(result, {
				totalNodes: 3,
				nodesAdded: 3,
				nodesUpdated: 0,
				nodesUnchanged: 0,
				nodesDeleted: 0,
				nodesPhasedOut: 0,
				contentUpdated: 0,
				metadataUpdated: 0,
				priorityUpdated: 0,
			});

			const allNodes = testDatabase.db
				.select()
				.from(nodeContent)
				.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
				.all();
			expect(allNodes.map((n) => n.id).sort()).toStrictEqual(['node-1', 'node-2', 'node-3']);
		});

		it('imports nodes with parent relationships', async () => {
			const apiNodes: WorkflowyNode[] = [
				createApiNode({id: 'parent-1', name: 'Parent', parent_id: null, priority: 0}),
				createApiNode({id: 'child-1', name: 'First Child', parent_id: 'parent-1', priority: 0}),
				createApiNode({id: 'child-2', name: 'Second Child', parent_id: 'parent-1', priority: 1}),
			];

			const result = await importFromApi(testDatabase.db, apiNodes);

			expectImportStats(result, {
				totalNodes: 3,
				nodesAdded: 3,
				nodesUpdated: 0,
				nodesUnchanged: 0,
				nodesDeleted: 0,
				nodesPhasedOut: 0,
				contentUpdated: 0,
				metadataUpdated: 0,
				priorityUpdated: 0,
			});

			const records = ['parent-1', 'child-1', 'child-2'].map(
				(id) => testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, id)).get()!,
			);
			expect(records.map((r) => ({id: r.id, parentId: r.parentId}))).toStrictEqual([
				{id: 'parent-1', parentId: null},
				{id: 'child-1', parentId: 'parent-1'},
				{id: 'child-2', parentId: 'parent-1'},
			]);
		});

		it('imports node with all metadata fields', async () => {
			const createdAt = 1_700_000_000;
			const modifiedAt = 1_700_086_400;
			const completedAt = 1_700_082_800;
			const apiNodes: WorkflowyNode[] = [
				createApiNode({
					id: 'full-node',
					name: 'Full Node',
					note: 'This is a note',
					completed: true,
					completedAt,
					createdAt,
					modifiedAt,
					data: {layoutMode: 'board'},
				}),
			];

			const result = await importFromApi(testDatabase.db, apiNodes);

			expectImportStats(result, {
				totalNodes: 1,
				nodesAdded: 1,
				nodesUpdated: 0,
				nodesUnchanged: 0,
				nodesDeleted: 0,
				nodesPhasedOut: 0,
				contentUpdated: 0,
				metadataUpdated: 0,
				priorityUpdated: 0,
			});

			const content = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, 'full-node')).get()!;
			const {id, name, note, parentId, systemTo} = content;
			expect({id, name, note, parentId, systemTo}).toStrictEqual({
				id: 'full-node',
				name: 'Full Node',
				note: 'This is a note',
				parentId: null,
				systemTo: FAR_FUTURE_DATE,
			});

			const metadata = testDatabase.db
				.select()
				.from(nodeMetadata)
				.where(eq(nodeMetadata.nodeId, 'full-node'))
				.get()!;
			expect({completedAt: metadata.completedAt, layoutMode: metadata.layoutMode}).toStrictEqual({
				completedAt: new Date(completedAt * 1000),
				layoutMode: 'board',
			});
		});
	});

	describe('re-import identical data', () => {
		it('leaves unchanged nodes untouched', async () => {
			const apiNodes: WorkflowyNode[] = [createApiNode({id: 'node-1', name: 'Test Node', priority: 0})];

			const t0 = new Date('2024-01-01T00:00:00Z');
			const t1 = new Date('2024-01-01T00:01:00Z');

			await importFromApi(testDatabase.db, apiNodes, false, t0);

			const firstImportNode = testDatabase.db
				.select()
				.from(nodeContent)
				.where(eq(nodeContent.id, 'node-1'))
				.get()!;
			const firstSystemFrom = firstImportNode.systemFrom;

			const result = await importFromApi(testDatabase.db, apiNodes, false, t1);

			expectImportStats(result, {
				totalNodes: 1,
				nodesAdded: 0,
				nodesUpdated: 0,
				nodesUnchanged: 1,
				nodesDeleted: 0,
				nodesPhasedOut: 0,
				contentUpdated: 0,
				metadataUpdated: 0,
				priorityUpdated: 0,
			});

			const allNodes = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, 'node-1')).all();
			expect(allNodes.map((n) => ({systemFrom: n.systemFrom, systemTo: n.systemTo}))).toStrictEqual([
				{systemFrom: firstSystemFrom, systemTo: FAR_FUTURE_DATE},
			]);
		});
	});

	describe('temporal timestamps', () => {
		it('sets systemTo to FAR_FUTURE_DATE for active records', async () => {
			const apiNodes: WorkflowyNode[] = [createApiNode({id: 'node-1', name: 'Test Node'})];

			await importFromApi(testDatabase.db, apiNodes);

			const node = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, 'node-1')).get()!;
			expect(node.systemTo).toBe(FAR_FUTURE_DATE);
		});
	});

	describe('node_content and node_metadata tables', () => {
		it('creates content records', async () => {
			const apiNodes: WorkflowyNode[] = [
				createApiNode({
					id: 'node-1',
					name: 'Test Name',
					note: 'Test Note',
					parent_id: null,
				}),
			];

			await importFromApi(testDatabase.db, apiNodes);

			const content = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, 'node-1')).get()!;
			// oxlint-disable-next-line @typescript-eslint/no-unused-vars
			const {systemFrom, ...contentRest} = content;
			expect(contentRest).toStrictEqual({
				id: 'node-1',
				name: 'Test Name',
				note: 'Test Note',
				parentId: null,
				systemTo: FAR_FUTURE_DATE,
			});
		});

		it('creates metadata records', async () => {
			const createdAtTimestamp = 1_700_000_000;
			const modifiedAtTimestamp = 1_700_086_400;
			const apiNodes: WorkflowyNode[] = [
				createApiNode({
					id: 'node-1',
					name: 'Test',
					priority: 5,
					createdAt: createdAtTimestamp,
					modifiedAt: modifiedAtTimestamp,
					data: {layoutMode: 'document'},
				}),
			];

			await importFromApi(testDatabase.db, apiNodes);

			const metadata = testDatabase.db
				.select()
				.from(nodeMetadata)
				.where(eq(nodeMetadata.nodeId, 'node-1'))
				.get()!;
			// oxlint-disable-next-line @typescript-eslint/no-unused-vars
			const {systemFrom, ...metaRest} = metadata;
			expect(metaRest).toStrictEqual({
				nodeId: 'node-1',
				shortId: 'node1',
				priority: 5,
				createdAt: new Date(createdAtTimestamp * 1000),
				modifiedAt: new Date(modifiedAtTimestamp * 1000),
				completedAt: null,
				layoutMode: 'document',
				systemTo: FAR_FUTURE_DATE,
			});
		});
	});

	describe('empty API response', () => {
		it('handles empty node list', async () => {
			const apiNodes: WorkflowyNode[] = [];

			const result = await importFromApi(testDatabase.db, apiNodes);

			expectImportStats(result, {
				totalNodes: 0,
				nodesAdded: 0,
				nodesUpdated: 0,
				nodesUnchanged: 0,
				nodesDeleted: 0,
				nodesPhasedOut: 0,
				contentUpdated: 0,
				metadataUpdated: 0,
				priorityUpdated: 0,
			});
		});
	});

	describe('batch processing', () => {
		it('handles large number of nodes', async () => {
			const apiNodes: WorkflowyNode[] = [];
			for (let i = 0; i < 2500; i++) {
				apiNodes.push(createApiNode({id: `node-${i}`, name: `Node ${i}`, priority: i}));
			}

			const result = await importFromApi(testDatabase.db, apiNodes);

			expectImportStats(result, {
				totalNodes: 2500,
				nodesAdded: 2500,
				nodesUpdated: 0,
				nodesUnchanged: 0,
				nodesDeleted: 0,
				nodesPhasedOut: 0,
				contentUpdated: 0,
				metadataUpdated: 0,
				priorityUpdated: 0,
			});

			const count = testDatabase.db
				.select()
				.from(nodeContent)
				.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
				.all().length;
			expect(count).toBe(2500);
		});
	});

	describe('special characters', () => {
		it('handles special characters in node names', async () => {
			const apiNodes: WorkflowyNode[] = [
				createApiNode({id: 'node-1', name: 'Hello <b>World</b> & "Quotes"'}),
				createApiNode({id: 'node-2', name: 'Unicode: 日本語 🎉 émojis'}),
			];

			const result = await importFromApi(testDatabase.db, apiNodes);

			expectImportStats(result, {
				totalNodes: 2,
				nodesAdded: 2,
				nodesUpdated: 0,
				nodesUnchanged: 0,
				nodesDeleted: 0,
				nodesPhasedOut: 0,
				contentUpdated: 0,
				metadataUpdated: 0,
				priorityUpdated: 0,
			});

			const node1 = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, 'node-1')).get()!;
			expect(node1.name).toBe('Hello <b>World</b> & "Quotes"');

			const node2 = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, 'node-2')).get()!;
			expect(node2.name).toBe('Unicode: 日本語 🎉 émojis');
		});
	});

	describe('node deletion detection', () => {
		it('phases out nodes that no longer exist in incoming data', async () => {
			const node1 = createApiNode({id: 'node-1', name: 'Node 1', priority: 0});
			const node2 = createApiNode({id: 'node-2', name: 'Node 2', priority: 1});
			const node3 = createApiNode({id: 'node-3', name: 'Node 3', priority: 2});

			const result1 = await importFromApi(testDatabase.db, [node1, node2, node3]);
			expect(result1.nodesAdded).toBe(3);

			const result2 = await importFromApi(testDatabase.db, [node1, node3]);
			expectImportStats(result2, {
				totalNodes: 2,
				nodesAdded: 0,
				nodesUpdated: 0,
				nodesUnchanged: 2,
				nodesDeleted: 1,
				nodesPhasedOut: 1,
				contentUpdated: 0,
				metadataUpdated: 0,
				priorityUpdated: 0,
			});

			const activeNodes = testDatabase.db
				.select()
				.from(nodeContent)
				.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
				.all();
			expect(activeNodes.map((n) => n.id).sort()).toStrictEqual(['node-1', 'node-3']);

			const node2Active = testDatabase.db
				.select()
				.from(nodeContent)
				.where(eq(nodeContent.id, 'node-2'))
				.all()
				.filter((n) => n.systemTo === FAR_FUTURE_DATE);
			expect(node2Active).toStrictEqual([]);
		});
	});

	describe('node update detection', () => {
		it('creates new version when node content changes', async () => {
			const firstImport: WorkflowyNode[] = [createApiNode({id: 'node-1', name: 'Original Name', priority: 0})];

			await importFromApi(testDatabase.db, firstImport);

			const secondImport: WorkflowyNode[] = [createApiNode({id: 'node-1', name: 'Updated Name', priority: 0})];

			const result = await importFromApi(testDatabase.db, secondImport);
			expect(result.nodesUpdated).toBe(1);
			expect(result.nodesUnchanged).toBe(0);

			const allNode1Records = testDatabase.db
				.select()
				.from(nodeContent)
				.where(eq(nodeContent.id, 'node-1'))
				.all();
			expect(allNode1Records.map((n) => ({name: n.name, active: n.systemTo === FAR_FUTURE_DATE}))).toStrictEqual([
				{name: 'Original Name', active: false},
				{name: 'Updated Name', active: true},
			]);
		});
	});

	describe('per-node REST adapter writes unconditionally', () => {
		const DATE_EARLIER = new Date('2026-04-01T00:00:00Z');
		const DATE_LATER = new Date('2026-04-10T00:00:00Z');
		const T_EARLIER = Math.floor(DATE_EARLIER.getTime() / 1000);
		const T_LATER = Math.floor(DATE_LATER.getTime() / 1000);

		it('imports even when incoming timestamps predate the local cache', async () => {
			// Seed the cache with a write timestamped at T_LATER.
			const seedNodes: WorkflowyNode[] = [
				createApiNode({id: 'node-1', name: 'Seed', createdAt: T_LATER, modifiedAt: T_LATER}),
			];
			await importFromApi(testDatabase.db, seedNodes, false, DATE_LATER);

			// A per-node REST response is authoritative regardless of relative
			// timestamps: the watermark guard belongs to the bulk-export path only.
			const staleNodes: WorkflowyNode[] = [
				createApiNode({id: 'node-2', name: 'Stale', createdAt: T_EARLIER, modifiedAt: T_EARLIER}),
			];
			const result = await importFromApi(testDatabase.db, staleNodes, false, DATE_LATER);

			expect(result.nodesAdded).toBe(1);
			const node2 = testDatabase.db.select().from(nodeContent).where(eq(nodeContent.id, 'node-2')).get()!;
			expectActiveRecord(node2);
		});
	});
});
