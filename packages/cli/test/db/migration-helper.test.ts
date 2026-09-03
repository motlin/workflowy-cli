import {nodeContent} from '@workflowy/shared/db';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTestNode} from '../helpers/node-fixtures.js';
import {cleanupTestDatabase, createInMemoryTestDatabase, createTestDatabase, seedTestData} from './migration-helper.js';

/**
 * Guards the contract every database-backed test leans on. The helper reuses a
 * migrated template file rather than replaying the migrations per test, so these
 * assertions pin down that the reused schema is complete, empty, and isolated.
 */
describe('migration-helper', () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-helper-test-'));
	});

	afterEach(() => {
		fs.rmSync(tempDir, {recursive: true, force: true});
	});

	function tableNames(database: ReturnType<typeof createTestDatabase>): string[] {
		return database.sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
			.all()
			.map((row) => (row as {name: string}).name);
	}

	it('applies every migration to a file database', () => {
		const database = createTestDatabase(path.join(tempDir, 'schema.sqlite'));

		try {
			const names = tableNames(database);
			expect(names).toContain('node_content');
			expect(names).toContain('node_metadata');
			expect(names).toContain('s3_files');
			expect(names).toContain('mirrors');
			// A vec0 virtual table: proves the sqlite-vec extension loaded against
			// the reused schema, not just that the tables were copied.
			expect(names).toContain('node_embeddings');
			expect(database.db.select().from(nodeContent).all()).toStrictEqual([]);
		} finally {
			cleanupTestDatabase(database);
		}
	});

	it('applies every migration to an in-memory database', () => {
		const database = createInMemoryTestDatabase();

		try {
			expect(tableNames(database)).toContain('node_content');
			expect(database.db.select().from(nodeContent).all()).toStrictEqual([]);
		} finally {
			cleanupTestDatabase(database);
		}
	});

	it('isolates each database from the others', () => {
		const first = createTestDatabase(path.join(tempDir, 'first.sqlite'));
		const second = createTestDatabase(path.join(tempDir, 'second.sqlite'));

		try {
			seedTestData(first, {nodes: [createTestNode({id: 'only-in-first', name: 'First', parentId: null})]});

			expect(
				first.db
					.select()
					.from(nodeContent)
					.all()
					.map((row) => row.id),
			).toStrictEqual(['only-in-first']);
			expect(second.db.select().from(nodeContent).all()).toStrictEqual([]);
		} finally {
			cleanupTestDatabase(first);
			cleanupTestDatabase(second);
		}
	});

	it('leaves no journal sidecar files behind after cleanup', () => {
		const database = createTestDatabase(path.join(tempDir, 'sidecars.sqlite'));
		seedTestData(database, {nodes: [createTestNode({id: 'node', name: 'Node', parentId: null})]});
		cleanupTestDatabase(database);

		expect(fs.readdirSync(tempDir)).toStrictEqual([]);
	});
});
