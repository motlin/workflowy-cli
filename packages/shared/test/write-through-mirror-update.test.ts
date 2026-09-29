import type {UpdateNodeRequest, WorkflowyApiClient} from '../src/api/workflowy-client.js';
import type {CacheService} from '../src/cache/cache-service.js';
import {WorkflowyWriteThroughClient} from '../src/cache/workflowy-write-through-client.js';
import type {WorkflowyNode} from '../src/types/workflowy.js';

const ORIGINAL_ID = 'original-node';
const MIRROR_ID = 'mirror-node';
const PLAIN_ID = 'plain-node';

/** Fakes that record which node id each API update targets. */
function fakes() {
	const updates: Array<[string, UpdateNodeRequest]> = [];
	const apiClient = {
		async updateNode(id: string, request: UpdateNodeRequest) {
			updates.push([id, request]);
		},
		async getNode(id: string) {
			return {id, name: 'fresh'} as WorkflowyNode;
		},
	} as unknown as WorkflowyApiClient;
	const cacheService = {
		async getMirrorOriginal(id: string) {
			return id === MIRROR_ID ? ORIGINAL_ID : null;
		},
		async getNode(id: string) {
			return {id, parentId: null};
		},
		async insertNode() {},
	} as unknown as CacheService;
	return {client: new WorkflowyWriteThroughClient(apiClient, cacheService), updates};
}

describe('WorkflowyWriteThroughClient.updateNode on mirrors', () => {
	it('writes new text on a mirror to its original so the mirror never gets its own name', async () => {
		const {client, updates} = fakes();

		await client.updateNode(MIRROR_ID, {name: '🪞 Game night'});

		expect(updates).toStrictEqual([[ORIGINAL_ID, {name: '🪞 Game night'}]]);
	});

	it('writes a clear on a mirror to its original too, since the mirror has no text of its own', async () => {
		const {client, updates} = fakes();

		await client.updateNode(MIRROR_ID, {name: ''});

		expect(updates).toStrictEqual([[ORIGINAL_ID, {name: ''}]]);
	});

	it('updates a non-mirror node in place', async () => {
		const {client, updates} = fakes();

		await client.updateNode(PLAIN_ID, {note: 'details'});

		expect(updates).toStrictEqual([[PLAIN_ID, {note: 'details'}]]);
	});

	it('resolves the update target the same way for callers that pre-check the current text', async () => {
		const {client} = fakes();

		expect(
			await Promise.all([client.resolveUpdateTarget(MIRROR_ID), client.resolveUpdateTarget(PLAIN_ID)]),
		).toStrictEqual([ORIGINAL_ID, PLAIN_ID]);
	});
});
