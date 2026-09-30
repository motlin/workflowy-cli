import type {
	CreateMirrorResult,
	CreateNodeRequest,
	UpdateNodeRequest,
	WorkflowyApiClient,
} from '../api/workflowy-client.js';
import {isSystemTarget} from '../types/targets.js';
import type {WorkflowyNode} from '../types/workflowy.js';
import type {CacheService} from './cache-service.js';
import {type DeletePlan, planSubtreeDelete} from './delete-plan.js';

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
		// The create response holds only the new id, so read back the priority Workflowy
		// assigned; the placeholder would put the node out of order among its cached siblings.
		// A system target like "inbox" is accepted on create but 404s on GET, so the real parent comes from here too.
		const fetched = await this.apiClient.getNode(created.id);
		const node = {
			...created,
			priority: fetched.priority,
			parent_id: options.parent_id && isSystemTarget(options.parent_id) ? fetched.parent_id : created.parent_id,
		};
		const parentId = node.parent_id ?? null;
		await this.ensureParentInCache(parentId);
		await this.cacheService.insertNode(node, parentId);
		return node;
	}

	/**
	 * The node an update should actually be written to. A mirror's text lives on
	 * its original; writing to the mirror id leaves stale text stored on the
	 * mirror, which Workflowy ignores. So every update on a mirror, clears
	 * included, goes to the original.
	 */
	async resolveUpdateTarget(nodeId: string): Promise<string> {
		return (await this.cacheService.getMirrorOriginal(nodeId)) ?? nodeId;
	}

	/**
	 * Update an existing node and update the cache. Updates on a mirror are
	 * redirected to its original (see {@link resolveUpdateTarget}).
	 * @param requestedId The node ID to update
	 * @param options Update options (name, note, layoutMode)
	 * @returns The node that was updated (the original, for a mirror)
	 */
	async updateNode(requestedId: string, options: UpdateNodeRequest): Promise<WorkflowyNode> {
		const nodeId = await this.resolveUpdateTarget(requestedId);
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
	 * Work out the API calls {@link deleteNode} makes for `nodeId`, from the cache,
	 * without changing anything. Where an original is kept, its mirror's siblings
	 * are read from the API (GET only), since a stale cached order would put the
	 * original in the wrong slot.
	 *
	 * Workflowy's generic DELETE /nodes/:id removes a mirror, or an ancestor of
	 * one, but leaves the mirror's id in its original's mirror list: a dead
	 * reference. DELETE /nodes/:id/mirror cleans the list, so a mirror target is
	 * removed through it alone, and every mirror in the deleted part of a
	 * subtree is removed through it before the generic delete.
	 *
	 * The generic delete of an original also leaves its mirrors elsewhere as
	 * empty orphans. The web app instead keeps the original by moving it into a
	 * mirror's place, so an original in the subtree with a mirror outside the
	 * deleted part is kept that way (see {@link planSubtreeDelete}).
	 */
	async planDelete(nodeId: string): Promise<DeletePlan> {
		if ((await this.cacheService.getMirrorOriginal(nodeId)) !== null) {
			return {mirrorIds: [nodeId], promotions: [], nodeId: null};
		}
		return planSubtreeDelete(this.cacheService, nodeId, (parentId) => this.liveChildOrder(parentId));
	}

	/** A parent's children ids in Workflowy's current order, read from the API. */
	private async liveChildOrder(parentId: string | null): Promise<string[]> {
		const children =
			parentId === null ? await this.apiClient.getRootNodes() : await this.apiClient.getChildNodes(parentId);
		return children.sort((a, b) => a.priority - b.priority).map((node) => node.id);
	}

	/**
	 * Delete a node and remove it from the cache, carrying out {@link planDelete}
	 * in order: inner mirrors, then each promotion (remove the mirror, move the
	 * original into its slot, move siblings to fix the slot), then the generic
	 * delete. The cache follows each call. If any call fails, the rest are not
	 * sent, so the generic delete never runs before every kept original has
	 * moved out of the subtree.
	 * @param nodeId The node ID to delete
	 * @param plan The plan from {@link planDelete} to carry out, when the caller
	 *   already made (and showed) one; otherwise one is made now
	 * @returns The plan that was carried out
	 */
	async deleteNode(nodeId: string, plan?: DeletePlan): Promise<DeletePlan> {
		plan ??= await this.planDelete(nodeId);
		for (const mirrorId of plan.mirrorIds) {
			await this.deleteMirror(mirrorId);
		}
		for (const {mirrorId, originalId, parentId, position, siblingIds} of plan.promotions) {
			const end = position === 'top' ? -1 : 0;
			await this.deleteMirror(mirrorId);
			await this.moveNode(originalId, parentId, end);
			for (const siblingId of siblingIds) {
				await this.moveNode(siblingId, parentId, end);
			}
			if (siblingIds.length > 0) {
				// The sibling moves shifted the original, so refresh its cached priority.
				await this.cacheService.insertNode(await this.apiClient.getNode(originalId), parentId);
			}
		}
		if (plan.nodeId !== null) {
			await this.apiClient.deleteNode(plan.nodeId);
			await this.cacheService.deleteNode(plan.nodeId);
		}
		return plan;
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
