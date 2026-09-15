import {findUnregisteredInboxes} from '../../src/services/unregistered-inboxes.js';
import {
	cleanupTestDatabase,
	createInMemoryTestDatabase,
	seedTestData,
	type TestDatabase,
} from '../db/migration-helper.js';
import {createTestNode} from '../helpers/node-fixtures.js';

describe('unregistered inbox diagnostics', () => {
	let database: TestDatabase;
	beforeAll(() => {
		database = createInMemoryTestDatabase();
	});
	afterAll(() => {
		cleanupTestDatabase(database);
	});

	it('finds nested inboxes beyond the search default and excludes registered IDs and non-inbox names', async () => {
		seedTestData(database, {
			nodes: [
				...Array.from({length: 30}, (_, index) => createTestNode({id: `registered-${index}`, name: 'Inbox'})),
				createTestNode({id: 'work', name: 'Work'}),
				createTestNode({id: 'reference', name: 'Reference', parentId: 'work'}),
				createTestNode({id: 'nested', name: '<b>📥 Inbox</b>', parentId: 'reference'}),
				createTestNode({id: 'root', name: 'Inbox'}),
				createTestNode({id: 'plural', name: '📥 Inboxes'}),
				createTestNode({id: 'note', name: 'Task', note: 'Inbox'}),
				createTestNode({id: 'prefix', name: 'Inbox reminders'}),
				createTestNode({id: 'link', name: '<a href="https://example.com">Inbox</a>'}),
			],
		});
		const before = database.sqlite.serialize();
		const registeredIds = new Set([...Array.from({length: 30}, (_, index) => `registered-${index}`), 'link']);
		expect(await findUnregisteredInboxes(database.db, registeredIds)).toStrictEqual([
			{id: 'nested', name: '📥 Inbox', path: 'Work > Reference > 📥 Inbox'},
			{id: 'root', name: 'Inbox', path: 'Inbox'},
		]);
		expect(database.sqlite.serialize()).toStrictEqual(before);
	});

	it('returns no warnings when all inbox nodes are registered', async () => {
		seedTestData(database, {nodes: [createTestNode({id: 'registered', name: '📥 Inbox'})]});
		expect(await findUnregisteredInboxes(database.db, new Set(['registered']))).toStrictEqual([]);
	});
});
