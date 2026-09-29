import type {
	CreateMirrorResult,
	CreateNodeRequest,
	UpdateNodeRequest,
	WorkflowyApiClient,
} from '../api/workflowy-client.js';
import {isSystemTarget} from '../types/targets.js';
import type {WorkflowyNode} from '../types/workflowy.js';
import type {CacheService} from './cache-service.js';

/**
 * Unified write-through client that wraps both WorkflowyApiClient and CacheService.
 * All write operations are performed against the Workflowy API first, then the cache is updated.
 *
 * Error handling: If the API call succeeds but the cache update fails, the error is thrown.
 * This ensures data consistency and makes failures visible.
 */
export class WorkflowyWriteThroughClient {
	constructor(
		private apiClient: WorkflowyApiClient,
		private cacheService: CacheService,
	) {}

	/**
	 * Ensure the parent node exists in the cache before inserting a child.
	 * If the parent is missing, fetch it from the API and insert it.
	 * If the grandparent is also missing, throw an error (cache too stale).
	 *
	 * @param parentId The parent node ID to ensure exists in cache
	 */
	private async ensureParentInCache(parentId: string | null): Promise<void> {
		if (parentId === null) {
			return;
		}

		const existingParent = await this.cacheService.getNode(parentId);
		if (existingParent) {
			return;
		}

		// Parent not in cache - fetch from API
		const parent = await this.apiClient.getNode(parentId);

		// Check if grandparent exists (if parent has a parent)
		const grandparentId = parent.parent_id ?? null;
		if (grandparentId !== null) {
			const existingGrandparent = await this.cacheService.getNode(grandparentId);
			if (!existingGrandparent) {
				throw new Error(`Cache too stale: grandparent node ${grandparentId} not found`);
			}
		}

		// Insert the fetched parent into cache
		await this.cacheService.insertNode(parent, grandparentId);
	}

	/**
	 * Create a new node and update the cache.
	 * @param options Node creation options
	 * @returns The created node
	 */
	async createNode(options: CreateNodeRequest): Promise<WorkflowyNode> {
		const created = await this.apiClient.createNode(options);
		// A system target like "inbox" is accepted on create but 404s on GET, so learn the real parent from the new node.
		const node =
			options.parent_id && isSystemTarget(options.parent_id)
				? {...created, parent_id: (await this.apiClient.getNode(created.id)).parent_id}
				: created;
		const parentId = node.parent_id ?? null;
		await this.ensureParentInCache(parentId);
		await this.cacheService.insertNode(node, parentId);
		return node;
	}

	/**
	 * Update an existing node and update the cache.
	 * @param nodeId The node ID to update
	 * @param options Update options (name, note, layoutMode)
	 * @returns The updated node
	 */
	async updateNode(nodeId: string, options: UpdateNodeRequest): Promise<WorkflowyNode> {
		await this.apiClient.updateNode(nodeId, options);
		// Fetch fresh node data from API to update cache correctly
		const updatedNode = await this.apiClient.getNode(nodeId);
		const cachedNode = await this.cacheService.getNode(nodeId);
		const parentId = cachedNode?.parentId ?? null;
		await this.ensureParentInCache(parentId);
		await this.cacheService.insertNode(updatedNode, parentId);
		return updatedNode;
	}

	/**
	 * Delete a node and remove it from the cache.
	 * @param nodeId The node ID to delete
	 */
	async deleteNode(nodeId: string): Promise<void> {
		await this.apiClient.deleteNode(nodeId);
		await this.cacheService.deleteNode(nodeId);
	}

	/**
	 * Move a node to a new parent and update the cache.
	 * @param nodeId The node ID to move
	 * @param newParentId The target parent ID (null for root level)
	 * @param position Optional position ('top' for -1, 'bottom' for >= 0)
	 * @returns The moved node
	 */
	async moveNode(nodeId: string, newParentId: string | null, position?: number): Promise<WorkflowyNode> {
		await this.apiClient.moveNode(nodeId, newParentId, position);
		// Fetch fresh node data from API to update cache correctly
		const movedNode = await this.apiClient.getNode(nodeId);
		const parentId =
			newParentId !== null && isSystemTarget(newParentId) ? (movedNode.parent_id ?? null) : newParentId;
		await this.ensureParentInCache(parentId);
		await this.cacheService.insertNode(movedNode, parentId);
		return movedNode;
	}

	/**
	 * Create a live mirror of a node and record it in the cache. The mirror row
	 * is stored blank, matching backup imports: its content lives on the origin.
	 * @param originId The node to mirror
	 * @param parentId The parent to place the mirror under
	 * @param position Where among the parent's children to place the mirror
	 */
	async createMirror(originId: string, parentId: string, position: 'top' | 'bottom'): Promise<CreateMirrorResult> {
		const result = await this.apiClient.createMirror(originId, parentId, position);
		const mirrorNode = await this.apiClient.getNode(result.mirrorId);
		const mirrorParentId = mirrorNode.parent_id ?? parentId;
		await this.ensureParentInCache(mirrorParentId);
		await this.cacheService.insertNode({...mirrorNode, name: '', note: null}, mirrorParentId);
		await this.cacheService.insertMirror(result.originId, result.mirrorId);
		return result;
	}

	/**
	 * Remove a mirror and drop it, with its mirror relationship, from the cache.
	 * @param mirrorId The mirror node to remove
	 */
	async deleteMirror(mirrorId: string): Promise<void> {
		await this.apiClient.deleteMirror(mirrorId);
		await this.cacheService.deleteNode(mirrorId);
	}

	/**
	 * Mark a node as completed and update the cache.
	 * @param nodeId The node ID to complete
	 * @returns The completed node
	 */
	async completeNode(nodeId: string): Promise<WorkflowyNode> {
		await this.apiClient.completeNode(nodeId);
		// Fetch fresh node data from API to update cache correctly
		const completedNode = await this.apiClient.getNode(nodeId);
		const cachedNode = await this.cacheService.getNode(nodeId);
		const parentId = cachedNode?.parentId ?? null;
		await this.ensureParentInCache(parentId);
		await this.cacheService.insertNode(completedNode, parentId);
		return completedNode;
	}

	/**
	 * Mark a node as not completed and update the cache.
	 * @param nodeId The node ID to uncomplete
	 * @returns The uncompleted node
	 */
	async uncompleteNode(nodeId: string): Promise<WorkflowyNode> {
		await this.apiClient.uncompleteNode(nodeId);
		// Fetch fresh node data from API to update cache correctly
		const uncompletedNode = await this.apiClient.getNode(nodeId);
		const cachedNode = await this.cacheService.getNode(nodeId);
		const parentId = cachedNode?.parentId ?? null;
		await this.ensureParentInCache(parentId);
		await this.cacheService.insertNode(uncompletedNode, parentId);
		return uncompletedNode;
	}
}
