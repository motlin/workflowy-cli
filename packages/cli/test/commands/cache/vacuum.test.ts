import {nodeContent} from '@workflowy/shared/db';
import type {NewNodeContent} from '@workflowy/shared/db';
import {captureOutput} from '@oclif/test';
import {sql} from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Vacuum from '../../../src/commands/cache/vacuum.js';
import {cleanupTestDatabase, createTestDatabase, type TestDatabase} from '../../db/migration-helper.js';

describe('cache:vacuum command', () => {
	let tempDir: string;
	let testDbPath: string;
	let testDatabase: TestDatabase;
	let originalDbPath: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-vacuum-test-'));
		testDbPath = path.join(tempDir, 'test.sqlite');
		testDatabase = createTestDatabase(testDbPath);

		originalDbPath = process.env.WORKFLOWY_DB_PATH;
		process.env.WORKFLOWY_DB_PATH = testDbPath;
	});

	afterEach(() => {
		cleanupTestDatabase(testDatabase);

		if (originalDbPath === undefined) {
			delete process.env.WORKFLOWY_DB_PATH;
		} else {
			process.env.WORKFLOWY_DB_PATH = originalDbPath;
		}

		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, {recursive: true, force: true});
		}
	});

	it('reports a low freelist count after vacuuming a database with dead pages', async () => {
		const rows: NewNodeContent[] = [];
		for (let index = 0; index < 2000; index++) {
			rows.push({
				id: `node-${index}`,
				name: `Node ${index} `.repeat(50),
				note: 'x'.repeat(2000),
				parentId: null,
				systemFrom: '2024-01-01 00:00:00',
				systemTo: '9999-12-31 23:59:59',
			});
		}
		testDatabase.db.insert(nodeContent).values(rows).run();

		testDatabase.sqlite.exec('PRAGMA foreign_keys = OFF');
		testDatabase.db.delete(nodeContent).run();
		testDatabase.sqlite.exec('PRAGMA foreign_keys = ON');

		const freelistBeforeRow = testDatabase.db.get<{freelist_count: number}>(sql.raw('PRAGMA freelist_count'));
		expect(freelistBeforeRow?.freelist_count ?? 0).toBeGreaterThan(0);

		const result = await Vacuum.run(['--json']);

		expect(result.sizeAfterBytes).toBeLessThanOrEqual(result.sizeBeforeBytes);
		expect(result.freelistAfter).toBe(0);

		const freelistAfterRow = testDatabase.db.get<{freelist_count: number}>(sql.raw('PRAGMA freelist_count'));
		expect(freelistAfterRow?.freelist_count ?? 0).toBe(0);
	});

	it('prints a human-readable summary without --json', async () => {
		const {stdout, result} = await captureOutput<VacuumRunResult>(async () => {
			return Vacuum.run([]);
		});

		expect(stdout).toContain('🧹 Vacuuming cache database...');
		expect(stdout).toContain('Size before:');
		expect(stdout).toContain('Size after:');
		expect(stdout).toContain('Freelist pages:');
		expect(result?.freelistAfter).toBe(0);
	});
});

type VacuumRunResult = Awaited<ReturnType<typeof Vacuum.run>>;
