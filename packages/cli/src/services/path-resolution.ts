import type {WorkflowyApiClient} from '@workflowy/shared/api';
import type {CacheService} from './cache.js';

export type PathResolutionResult = {
	nodeId: string;
	foundInCache: boolean;
};

export type PathResolutionOptions = {
	rootId: string | null;
	path: string | undefined;
	dataSource: 'auto' | 'api' | 'cache';
};

export class PathResolutionService {
	constructor(
		private cacheService: CacheService,
		private apiClient: WorkflowyApiClient | null,
	) {}

	async resolveTargetNodeId(options: PathResolutionOptions): Promise<PathResolutionResult> {
		const {rootId, path, dataSource} = options;

		if (!path) {
			return {
				nodeId: rootId ?? '',
				foundInCache: true,
			};
		}

		const pathComponents = path.split(',').map((s) => s.trim());

		const cachedNode = await this.cacheService.findNodeByPath(pathComponents, rootId);

		if (cachedNode) {
			return {
				nodeId: cachedNode.id,
				foundInCache: true,
			};
		}

		if (dataSource === 'cache') {
			throw new Error(`Could not find node at path: ${pathComponents.join(' > ')} (not in cache)`);
		}

		if (this.apiClient) {
			const apiNode = await this.apiClient.findNodeByPath(pathComponents, rootId);
			if (!apiNode) {
				throw new Error(`Could not find node at path: ${pathComponents.join(' > ')}`);
			}
			return {
				nodeId: apiNode.id,
				foundInCache: false,
			};
		}

		throw new Error(`Could not find node at path: ${pathComponents.join(' > ')} (no cached data and no API key)`);
	}
}
