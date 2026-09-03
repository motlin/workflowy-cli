import {calendarLevels, calendarMetadata} from '@workflowy/shared/db';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import {eq} from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {importBackup} from '../../src/services/cache-import.js';
import {cleanupTestDatabase, createTestDatabase, type TestDatabase} from '../db/migration-helper.js';

/**
 * 📅 Calendar `level` vs `levels` invariant.
 *
 * Investigation (2026-05-21, plan Phase 1d) established that Workflowy's
 * `CalendarSchema` emits both `level` (text) and `levels` (boolean flags), but a
 * given node populates only one:
 *   - the calendar *root* node (root=1) carries `levels`, never `level`;
 *   - individual *date* nodes carry `level`, never `levels`.
 * Backup data confirmed 270 nodes with `level` only and 1 root with `levels` only,
 * zero nodes carrying both.
 *
 * These tests pin that complementary semantics so a future import change that
 * starts writing both fields on one node fails loudly.
 */
describe('calendar level/levels invariant', () => {
	let tempDir: string;
	let testDatabase: TestDatabase;
	let originalEpoch: string | undefined;

	beforeEach(() => {
		originalEpoch = process.env.WORKFLOWY_EPOCH;
		process.env.WORKFLOWY_EPOCH = '0';

		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-calendar-test-'));
		testDatabase = createTestDatabase(path.join(tempDir, 'test.sqlite'));
	});

	afterEach(() => {
		if (originalEpoch === undefined) {
			delete process.env.WORKFLOWY_EPOCH;
		} else {
			process.env.WORKFLOWY_EPOCH = originalEpoch;
		}

		cleanupTestDatabase(testDatabase);
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, {recursive: true, force: true});
		}
	});

	function writeBackupFile(content: unknown): string {
		const filePath = path.join(tempDir, 'backup.json');
		fs.writeFileSync(filePath, JSON.stringify(content));
		return filePath;
	}

	it('writes levels (not level) for the calendar root node', async () => {
		const backupContent = [
			{
				id: 'calendar-root',
				nm: '📆 Calendar',
				metadata: {
					calendar: {
						root: true,
						levels: {day: true, week: false, month: true, year: true},
						found_dates: false,
					},
				},
			},
		];

		await importBackup(testDatabase.db, writeBackupFile(backupContent), 'backup.json');

		const metadataRows = testDatabase.db
			.select()
			.from(calendarMetadata)
			.where(eq(calendarMetadata.systemTo, FAR_FUTURE_DATE))
			.all();
		expect(metadataRows.map(({root, level}) => ({root, level}))).toStrictEqual([{root: 1, level: null}]);

		const levelsRows = testDatabase.db
			.select()
			.from(calendarLevels)
			.where(eq(calendarLevels.systemTo, FAR_FUTURE_DATE))
			.all();
		expect(levelsRows.map(({nodeId, day, week, month, year}) => ({nodeId, day, week, month, year}))).toStrictEqual([
			{nodeId: 'calendar-root', day: 1, week: 0, month: 1, year: 1},
		]);
	});

	it('writes level (not a levels row) for a date node', async () => {
		const backupContent = [
			{
				id: 'date-node',
				nm: '11',
				metadata: {
					calendar: {
						level: 'day',
						value: '11',
						dateId: 20250211,
						timestamp: 1739250000000,
					},
				},
			},
		];

		await importBackup(testDatabase.db, writeBackupFile(backupContent), 'backup.json');

		const metadataRows = testDatabase.db
			.select()
			.from(calendarMetadata)
			.where(eq(calendarMetadata.systemTo, FAR_FUTURE_DATE))
			.all();
		expect(metadataRows.map(({level, root}) => ({level, root}))).toStrictEqual([{level: 'day', root: null}]);

		const levelsRows = testDatabase.db
			.select()
			.from(calendarLevels)
			.where(eq(calendarLevels.systemTo, FAR_FUTURE_DATE))
			.all();
		expect(levelsRows).toStrictEqual([]);
	});

	it('keeps level and levels mutually exclusive across a mixed calendar tree', async () => {
		const backupContent = [
			{
				id: 'calendar-root',
				nm: '📆 Calendar',
				metadata: {
					calendar: {root: true, levels: {day: true, month: true, year: true}, found_dates: false},
				},
				ch: [
					{
						id: 'year-2025',
						nm: '2025',
						metadata: {calendar: {level: 'year', value: '2025', dateId: 20250000}},
						ch: [
							{
								id: 'month-feb',
								nm: 'February',
								metadata: {calendar: {level: 'month', value: '2', dateId: 20250200}},
								ch: [
									{
										id: 'day-11',
										nm: '11',
										metadata: {calendar: {level: 'day', value: '11', dateId: 20250211}},
									},
								],
							},
						],
					},
				],
			},
		];

		await importBackup(testDatabase.db, writeBackupFile(backupContent), 'backup.json');

		const metadataRows = testDatabase.db
			.select()
			.from(calendarMetadata)
			.where(eq(calendarMetadata.systemTo, FAR_FUTURE_DATE))
			.all();
		const levelsRows = testDatabase.db
			.select()
			.from(calendarLevels)
			.where(eq(calendarLevels.systemTo, FAR_FUTURE_DATE))
			.all();

		const nodeIdsWithLevels = new Set(levelsRows.map((row) => row.nodeId));

		for (const row of metadataRows) {
			const hasLevel = row.level !== null;
			const hasLevelsRow = nodeIdsWithLevels.has(row.nodeId);
			expect(hasLevel && hasLevelsRow).toBe(false);
			expect(hasLevel || hasLevelsRow).toBe(true);
			if (hasLevelsRow) {
				expect(row.root).toBe(1);
			}
		}

		expect(levelsRows.map((row) => row.nodeId)).toStrictEqual(['calendar-root']);
		expect(
			metadataRows
				.filter((row) => row.level !== null)
				.map((row) => row.level)
				.sort((a, b) => String(a).localeCompare(String(b))),
		).toStrictEqual(['day', 'month', 'year']);
	});
});
