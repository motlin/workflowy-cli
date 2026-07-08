import * as schema from '@workflowy/shared/db';
import type {
	NewAiMetadata,
	NewBacklink,
	NewBackupImport,
	NewChangesMetadata,
	NewMirror,
	NewNodeContent,
	NewNodeMetadata,
	NewReferencesRoot,
	NewS3File,
	NewVirtualRootId,
} from '@workflowy/shared/db';
import {splitNodeIntoContentAndMetadata, type TestNode} from '../helpers/node-fixtures.js';
import type Database from 'better-sqlite3';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import {createDatabase} from '../../src/db/index.js';

export interface TestDatabase {
	db: BetterSQLite3Database<typeof schema>;
	sqlite: Database.Database;
	path: string;
}

/**
 * Test fixtures for seeding test data.
 *
 * @deprecated Use `nodeContent` and `nodeMetadata` directly instead of `nodes`.
 * The `nodes` property is kept for backward compatibility and will be converted
 * to nodeContent/nodeMetadata automatically.
 */
export interface TestFixtures {
	/**
	 * @deprecated Use `nodeContent` and `nodeMetadata` instead.
	 * This property is converted to nodeContent/nodeMetadata automatically.
	 */
	nodes?: TestNode[];
	nodeContent?: NewNodeContent[];
	nodeMetadata?: NewNodeMetadata[];
	mirrors?: NewMirror[];
	backlinks?: NewBacklink[];
	virtualRootIds?: NewVirtualRootId[];
	aiMetadata?: NewAiMetadata[];
	s3Files?: NewS3File[];
	changesMetadata?: NewChangesMetadata[];
	referencesRoots?: NewReferencesRoot[];
	backupImports?: NewBackupImport[];
}

/**
 * Create a test database with migrations applied
 */
export function createTestDatabase(dbPath: string = ':memory:'): TestDatabase {
	const db = createDatabase(dbPath);

	return {db, sqlite: db.$client, path: dbPath};
}

/**
 * Create an in-memory test database
 */
export function createInMemoryTestDatabase(): TestDatabase {
	return createTestDatabase(':memory:');
}

/**
 * Clean up a test database
 */
export function cleanupTestDatabase(testDb: TestDatabase): void {
	testDb.sqlite.close();
	if (testDb.path !== ':memory:' && fs.existsSync(testDb.path)) {
		fs.unlinkSync(testDb.path);
	}
}

/**
 * Clear all tables in the test database.
 * Disables foreign keys temporarily to avoid constraint violations.
 */
function clearAllTables(testDb: TestDatabase): void {
	testDb.sqlite.exec('PRAGMA foreign_keys = OFF');

	testDb.db.delete(schema.nodeEmbeddings).run();
	testDb.db.delete(schema.backlinks).run();
	testDb.db.delete(schema.virtualRootIds).run();
	testDb.db.delete(schema.aiMetadata).run();
	testDb.db.delete(schema.s3Files).run();
	testDb.db.delete(schema.changesMetadata).run();
	testDb.db.delete(schema.referencesRoots).run();
	testDb.db.delete(schema.mirrors).run();
	testDb.db.delete(schema.nodeContent).run();
	testDb.db.delete(schema.nodeMetadata).run();
	testDb.db.delete(schema.backupImports).run();

	testDb.sqlite.exec('PRAGMA foreign_keys = ON');
}

/**
 * Seed test data into the database.
 * Clears existing data first, then inserts fixtures.
 *
 * Supports backward compatibility: if `nodes` is provided, it will be
 * automatically converted to nodeContent/nodeMetadata entries.
 */
export function seedTestData(testDb: TestDatabase, fixtures: TestFixtures): void {
	clearAllTables(testDb);

	// Convert deprecated nodes to nodeContent/nodeMetadata
	if (fixtures.nodes && fixtures.nodes.length > 0) {
		const contents: NewNodeContent[] = [];
		const metadatas: NewNodeMetadata[] = [];

		for (const node of fixtures.nodes) {
			const {content, metadata} = splitNodeIntoContentAndMetadata(node);
			contents.push(content);
			metadatas.push(metadata);
		}

		testDb.db.insert(schema.nodeContent).values(contents).run();
		testDb.db.insert(schema.nodeMetadata).values(metadatas).run();
	}

	if (fixtures.nodeContent && fixtures.nodeContent.length > 0) {
		testDb.db.insert(schema.nodeContent).values(fixtures.nodeContent).run();
	}

	if (fixtures.nodeMetadata && fixtures.nodeMetadata.length > 0) {
		testDb.db.insert(schema.nodeMetadata).values(fixtures.nodeMetadata).run();
	}

	if (fixtures.mirrors && fixtures.mirrors.length > 0) {
		testDb.db.insert(schema.mirrors).values(fixtures.mirrors).run();
	}

	if (fixtures.backlinks && fixtures.backlinks.length > 0) {
		testDb.db.insert(schema.backlinks).values(fixtures.backlinks).run();
	}

	if (fixtures.virtualRootIds && fixtures.virtualRootIds.length > 0) {
		testDb.db.insert(schema.virtualRootIds).values(fixtures.virtualRootIds).run();
	}

	if (fixtures.aiMetadata && fixtures.aiMetadata.length > 0) {
		testDb.db.insert(schema.aiMetadata).values(fixtures.aiMetadata).run();
	}

	if (fixtures.s3Files && fixtures.s3Files.length > 0) {
		testDb.db.insert(schema.s3Files).values(fixtures.s3Files).run();
	}

	if (fixtures.changesMetadata && fixtures.changesMetadata.length > 0) {
		testDb.db.insert(schema.changesMetadata).values(fixtures.changesMetadata).run();
	}

	if (fixtures.referencesRoots && fixtures.referencesRoots.length > 0) {
		testDb.db.insert(schema.referencesRoots).values(fixtures.referencesRoots).run();
	}

	if (fixtures.backupImports && fixtures.backupImports.length > 0) {
		testDb.db.insert(schema.backupImports).values(fixtures.backupImports).run();
	}
}
