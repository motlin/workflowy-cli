import type {WorkflowyApiClient} from '@workflowy/shared/api';
import type {WorkflowyNode} from '@workflowy/shared/types';
import type {CacheService} from './cache.js';

export type NodeSyncStats = {
	syncedCount: number;
};

export type NodeSyncProgress = {
	phase: 'syncing';
	nodeId: string | null;
	childCount: number;
	message?: string;
};

export type NodeSyncOptions = {
	nodeId: string | null;
	recursive: boolean;
	onProgress?: (progress: NodeSyncProgress) => void;
};

export class NodeSyncService {
	constructor(
		private apiClient: WorkflowyApiClient,
		private cacheService: CacheService,
	) {}

	async syncNode(options: NodeSyncOptions): Promise<NodeSyncStats> {
		let syncedCount = 0;

		const syncRecursive = async (nodeId: string | null, parentId: string | null, recursive: boolean) => {
			const nodes: WorkflowyNode[] =
				nodeId === null ? await this.apiClient.getRootNodes() : await this.apiClient.getChildNodes(nodeId);

			await this.cacheService.storeApiResponse(nodes, nodeId);
			syncedCount += nodes.length;

			options.onProgress?.({
				phase: 'syncing',
				nodeId,
				childCount: nodes.length,
				message: `Synced ${nodes.length} children of ${nodeId || 'root'}`,
			});

			if (recursive) {
				for (const node of nodes) {
					await syncRecursive(node.id, nodeId, true);
				}
			}
		};

		await syncRecursive(options.nodeId, null, options.recursive);

		return {syncedCount};
	}
}
