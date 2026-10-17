import type {WorkflowyApiClient} from "@workflowy/shared/api";
import type {WorkflowyNode} from "@workflowy/shared/types";
import type {CacheService} from "./cache.js";
import {nonEmpty} from "../utils/non-empty.js";

export interface NodeSyncStats {
	syncedCount: number;
}

export interface NodeSyncProgress {
	phase: "syncing";
	nodeId: string | null;
	childCount: number;
	message?: string;
}

export interface NodeSyncOptions {
	nodeId: string | null;
	recursive: boolean;
	onProgress?: (progress: NodeSyncProgress) => void;
}

export class NodeSyncService {
	constructor(
		private readonly apiClient: WorkflowyApiClient,
		private readonly cacheService: CacheService,
	) {}

	async syncNode(options: NodeSyncOptions): Promise<NodeSyncStats> {
		let syncedCount = 0;

		const syncRecursive = async (nodeId: string | null, parentId: string | null, recursive: boolean) => {
			const nodes: WorkflowyNode[] =
				nodeId === null ? await this.apiClient.getRootNodes() : await this.apiClient.getChildNodes(nodeId);

			this.cacheService.storeApiResponse(nodes, nodeId);
			syncedCount += nodes.length;

			options.onProgress?.({
				phase: "syncing",
				nodeId,
				childCount: nodes.length,
				message: `Synced ${nodes.length} children of ${nonEmpty(nodeId) ?? "root"}`,
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
