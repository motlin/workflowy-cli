import type {WorkflowyApiClient} from '@workflowy/shared/api';
import {type NodeWithRelations, systemFromToDate} from '@workflowy/shared/cache';
import type {CacheService} from './cache.js';
import {logger} from './logger.js';

export type EnhancedCacheNode = NodeWithRelations & {
	children?: EnhancedCacheNode[];
};

export type ListByIdOptions = {
	parentId: string | null;
	dataSource: 'auto' | 'api' | 'cache';
	forceRefresh: boolean;
	depth?: number;
};

export type ListByIdResult = {
	nodes: EnhancedCacheNode[];
	fromApi: boolean;
	cacheInfo?: {
		age: number;
		sources: string[];
	};
};

export class ListByIdService {
	constructor(
		private cacheService: CacheService,
		private apiClient: WorkflowyApiClient | null,
	) {}

	async listNodes(options: ListByIdOptions): Promise<ListByIdResult> {
		const {parentId, dataSource, forceRefresh, depth = 0} = options;

		let result: ListByIdResult;
		if (dataSource === 'cache') {
			result = await this.fetchFromCache(parentId);
		} else if (dataSource === 'api') {
			result = await this.fetchFromApi(parentId);
		} else {
			result = await this.fetchWithAutoFallback(parentId, forceRefresh);
		}

		if (depth > 0) {
			result.nodes = await this.fetchChildrenByDepthLevel(result.nodes, depth);
		}

		return result;
	}

	/**
	 * Calculate cache age in seconds from the oldest systemFrom timestamp.
	 */
	private calculateCacheAge(nodes: NodeWithRelations[]): number {
		const fetchTimes = nodes
			.map((n) => systemFromToDate(n.systemFrom))
			.filter((d): d is Date => d !== undefined)
			.map((d) => d.getTime());
		const oldestFetch = fetchTimes.length > 0 ? Math.min(...fetchTimes) : undefined;
		return oldestFetch ? Math.floor((Date.now() - oldestFetch) / 1000) : 0;
	}

	/**
	 * Fetch children using batch queries - one query per depth level.
	 */
	private async fetchChildrenByDepthLevel(
		nodes: EnhancedCacheNode[],
		maxDepth: number,
	): Promise<EnhancedCacheNode[]> {
		if (maxDepth <= 0 || nodes.length === 0) {
			return nodes;
		}

		const nodeMap = new Map<string, EnhancedCacheNode>();
		for (const node of nodes) {
			nodeMap.set(node.id, {...node});
		}

		let currentLevelIds = nodes.map((n) => n.id);

		for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
			if (currentLevelIds.length === 0) {
				break;
			}

			const childrenByParent = await this.cacheService.getChildrenForMultipleParents(currentLevelIds);
			const nextLevelIds: string[] = [];

			for (const [parentId, children] of childrenByParent) {
				const parentNode = nodeMap.get(parentId);
				if (parentNode && children.length > 0) {
					const enhancedChildren: EnhancedCacheNode[] = children.map((child) => ({...child}));
					parentNode.children = enhancedChildren;

					for (const child of enhancedChildren) {
						nodeMap.set(child.id, child);
						nextLevelIds.push(child.id);
					}
				}
			}

			currentLevelIds = nextLevelIds;
		}

		return nodes.map((n) => nodeMap.get(n.id)!);
	}

	private async fetchFromCache(parentId: string | null): Promise<ListByIdResult> {
		const nodes = await this.cacheService.getChildrenWithMergedData(parentId);
		return {
			nodes,
			fromApi: false,
			cacheInfo:
				nodes.length > 0
					? {
							age: this.calculateCacheAge(nodes),
							sources: ['cache'],
						}
					: undefined,
		};
	}

	private async fetchFromApi(parentId: string | null): Promise<ListByIdResult> {
		if (!this.apiClient) {
			throw new Error('API client not initialized. Set WORKFLOWY_API_KEY environment variable.');
		}

		const apiNodes = parentId ? await this.apiClient.getChildNodes(parentId) : await this.apiClient.getRootNodes();
		await this.cacheService.storeApiResponse(apiNodes, parentId);

		// Read back from cache to get consistent types
		const nodes = await this.cacheService.getChildrenWithMergedData(parentId);
		return {
			nodes,
			fromApi: true,
		};
	}

	private async fetchWithAutoFallback(parentId: string | null, forceRefresh: boolean): Promise<ListByIdResult> {
		const cachedNodes = await this.cacheService.getChildrenWithMergedData(parentId);
		const hasCachedData = cachedNodes.length > 0;

		const shouldRefresh = forceRefresh || !hasCachedData;

		if (shouldRefresh && this.apiClient) {
			try {
				const apiNodes = parentId
					? await this.apiClient.getChildNodes(parentId)
					: await this.apiClient.getRootNodes();
				await this.cacheService.storeApiResponse(apiNodes, parentId);
				// Read back from cache to get consistent types
				const nodes = await this.cacheService.getChildrenWithMergedData(parentId);
				return {
					nodes,
					fromApi: true,
				};
			} catch (error) {
				logger.debug('API request failed, falling back to cache', {err: error, parentId});
			}
		}

		const nodes = await this.cacheService.getChildrenWithMergedData(parentId);
		return {
			nodes,
			fromApi: false,
			cacheInfo:
				nodes.length > 0
					? {
							age: this.calculateCacheAge(nodes),
							sources: ['cache'],
						}
					: undefined,
		};
	}
}
