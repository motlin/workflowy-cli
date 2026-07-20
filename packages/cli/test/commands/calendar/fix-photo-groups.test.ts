import {captureOutput} from '@oclif/test';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {MockInstance} from 'vite-plus/test';
import FixPhotoGroups from '../../../src/commands/calendar/fix-photo-groups.js';
import {cleanupTestDatabase, createTestDatabase, seedTestData, type TestDatabase} from '../../db/migration-helper.js';
import {createTestNode} from '../../helpers/node-fixtures.js';

interface RecordedRequest {
	url: string;
	method: string;
	body: unknown;
}

function s3File(nodeId: string, fileName: string, systemFrom = '2026-01-01 00:00:00.000') {
	return {
		nodeId,
		fileName,
		fileType: 'image/jpeg',
		objectFolder: null,
		isAnimatedGif: null,
		imageOriginalWidth: null,
		imageOriginalHeight: null,
		imageOriginalPixels: null,
		isDeleted: null,
		systemFrom,
		systemTo: FAR_FUTURE_DATE,
	};
}

/** Wrapper `wrapper` under entry `entry`, holding photos in reverse order. */
function seedWrappedGroup(testDatabase: TestDatabase) {
	seedTestData(testDatabase, {
		nodes: [
			createTestNode({id: 'day', name: 'Sat, May 23, 2026', parentId: null}),
			createTestNode({id: 'entry', name: 'Drove to a friend’s house', parentId: 'day'}),
			createTestNode({id: 'wrapper', name: '', note: null, parentId: 'entry'}),
			createTestNode({id: 'photo-1', name: '', parentId: 'wrapper', priority: 100}),
			createTestNode({id: 'photo-2', name: '', parentId: 'wrapper', priority: 200}),
			createTestNode({id: 'photo-3', name: '', parentId: 'wrapper', priority: 300}),
		],
		s3Files: [
			s3File('photo-1', 'IMG_0300.jpeg'),
			s3File('photo-2', 'IMG_0200.jpeg'),
			s3File('photo-3', 'IMG_0100.jpeg'),
		],
	});
}

describe('calendar:fix-photo-groups command', () => {
	let originalEnv: typeof process.env;
	let fetchStub: MockInstance;
	let tempDir: string;
	let testDatabase: TestDatabase;
	let requests: RecordedRequest[];

	beforeEach(() => {
		originalEnv = {...process.env};

		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-photo-groups-test-'));
		const testDbPath = path.join(tempDir, 'test.sqlite');
		testDatabase = createTestDatabase(testDbPath);
		process.env.WORKFLOWY_DB_PATH = testDbPath;
		process.env.WORKFLOWY_API_KEY = 'test-api-key';

		requests = [];
		fetchStub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			const urlString = url instanceof Request ? url.url : String(url);
			const method = init?.method ?? 'GET';
			requests.push({
				url: urlString,
				method,
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});

			if (method === 'GET') {
				const nodeId = urlString.split('/nodes/')[1];
				return new Response(
					JSON.stringify({
						node: {
							id: nodeId,
							name: '',
							parent_id: 'entry',
							priority: 0,
							completed: false,
							createdAt: 1_700_000_000_000,
							modifiedAt: 1_700_000_000_000,
							completedAt: null,
							data: {},
						},
					}),
					{status: 200},
				);
			}

			return new Response(JSON.stringify({}), {status: 200});
		});
	});

	afterEach(() => {
		process.env = originalEnv;
		cleanupTestDatabase(testDatabase);
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, {recursive: true, force: true});
		}
	});

	it('previews a wrapped group without calling the API', async () => {
		seedWrappedGroup(testDatabase);

		const {stdout} = await captureOutput(async () => {
			await FixPhotoGroups.run(['--dry-run']);
		});

		expect(stdout).toContain('wrapper');
		expect(stdout).toContain('IMG_0300.jpeg');
		expect(stdout).toContain('reverse');
		expect(fetchStub).not.toHaveBeenCalled();
	});

	it('unwraps and reverses a wrapped group, then deletes the wrapper', async () => {
		seedWrappedGroup(testDatabase);

		await captureOutput(async () => {
			await FixPhotoGroups.run(['--delay', '0']);
		});

		const writes = requests
			.filter((request) => request.method === 'POST' || request.method === 'DELETE')
			.map((request) => [request.method, request.url.replace(/^.*\/api\/v1/, ''), request.body]);

		expect(writes).toStrictEqual([
			['POST', '/nodes/photo-3/move', {parent_id: 'entry', position: 'bottom'}],
			['POST', '/nodes/photo-2/move', {parent_id: 'entry', position: 'bottom'}],
			['POST', '/nodes/photo-1/move', {parent_id: 'entry', position: 'bottom'}],
			['DELETE', '/nodes/wrapper', undefined],
		]);
	});

	it('reverses a loose group in place without deleting anything', async () => {
		seedTestData(testDatabase, {
			nodes: [
				createTestNode({id: 'day', name: 'Wed, Jul 1, 2026', parentId: null}),
				createTestNode({id: 'entry', name: 'Flat Rock Brook', parentId: 'day'}),
				createTestNode({id: 'photo-1', name: '', parentId: 'entry', priority: 100}),
				createTestNode({id: 'photo-2', name: '', parentId: 'entry', priority: 200}),
			],
			s3Files: [s3File('photo-1', 'IMG_3695.jpeg'), s3File('photo-2', 'IMG_3667.jpeg')],
		});

		await captureOutput(async () => {
			await FixPhotoGroups.run(['--delay', '0']);
		});

		const writes = requests
			.filter((request) => request.method === 'POST' || request.method === 'DELETE')
			.map((request) => [request.method, request.url.replace(/^.*\/api\/v1/, ''), request.body]);

		expect(writes).toStrictEqual([
			['POST', '/nodes/photo-2/move', {parent_id: 'entry', position: 'bottom'}],
			['POST', '/nodes/photo-1/move', {parent_id: 'entry', position: 'bottom'}],
		]);
	});

	it('leaves a loose group alone when its filenames give no ordering evidence', async () => {
		seedTestData(testDatabase, {
			nodes: [
				createTestNode({id: 'day', name: 'Wed, Jul 1, 2026', parentId: null}),
				createTestNode({id: 'entry', name: 'Flat Rock Brook', parentId: 'day'}),
				createTestNode({id: 'photo-1', name: '', parentId: 'entry', priority: 100}),
				createTestNode({id: 'photo-2', name: '', parentId: 'entry', priority: 200}),
			],
			s3Files: [s3File('photo-1', 'image.jpeg'), s3File('photo-2', 'image.jpeg')],
		});

		const {stdout} = await captureOutput(async () => {
			await FixPhotoGroups.run(['--delay', '0']);
		});

		expect(stdout).toContain('loose group without filename evidence');
		expect(fetchStub).not.toHaveBeenCalled();
	});

	it('leaves a group alone when its filenames already ascend', async () => {
		seedTestData(testDatabase, {
			nodes: [
				createTestNode({id: 'day', name: 'Wed, Jul 1, 2026', parentId: null}),
				createTestNode({id: 'entry', name: 'Flat Rock Brook', parentId: 'day'}),
				createTestNode({id: 'photo-1', name: '', parentId: 'entry', priority: 100}),
				createTestNode({id: 'photo-2', name: '', parentId: 'entry', priority: 200}),
			],
			s3Files: [s3File('photo-1', 'IMG_3667.jpeg'), s3File('photo-2', 'IMG_3695.jpeg')],
		});

		await captureOutput(async () => {
			await FixPhotoGroups.run(['--delay', '0']);
		});

		expect(fetchStub).not.toHaveBeenCalled();
	});

	it('restricts work to one group using its short ID', async () => {
		const wrapperId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
		seedTestData(testDatabase, {
			nodes: [
				createTestNode({id: 'day', name: 'Sat, May 23, 2026', parentId: null}),
				createTestNode({id: 'entry', name: 'Drove to a friend’s house', parentId: 'day'}),
				createTestNode({id: wrapperId, shortId: 'eeeeeeeeeeee', name: '', parentId: 'entry'}),
				createTestNode({id: 'photo-1', name: '', parentId: wrapperId, priority: 100}),
				createTestNode({id: 'photo-2', name: '', parentId: wrapperId, priority: 200}),
				createTestNode({id: 'other-entry', name: 'Another entry', parentId: 'day'}),
				createTestNode({id: 'other-wrapper', name: '', parentId: 'other-entry'}),
				createTestNode({id: 'photo-3', name: '', parentId: 'other-wrapper', priority: 100}),
				createTestNode({id: 'photo-4', name: '', parentId: 'other-wrapper', priority: 200}),
			],
			s3Files: [
				s3File('photo-1', 'image.jpeg'),
				s3File('photo-2', 'image.jpeg'),
				s3File('photo-3', 'image.jpeg'),
				s3File('photo-4', 'image.jpeg'),
			],
		});

		await captureOutput(async () => {
			await FixPhotoGroups.run(['--node-id', 'eeeeeeeeeeee', '--delay', '0']);
		});

		const movedIds = requests
			.filter((request) => request.url.includes('/move'))
			.map((request) => request.url.split('/nodes/')[1].replace('/move', ''));

		expect(movedIds).toStrictEqual(['photo-2', 'photo-1']);
	});

	it('requires WORKFLOWY_API_KEY when not doing a dry run', async () => {
		delete process.env.WORKFLOWY_API_KEY;
		seedWrappedGroup(testDatabase);

		await expect(FixPhotoGroups.run(['--delay', '0'])).rejects.toThrow(
			'WORKFLOWY_API_KEY environment variable is required',
		);
	});
});
