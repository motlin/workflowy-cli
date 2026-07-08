import {WorkflowyApiClient} from '@workflowy/shared/api';
import {type NodeWithRelations, systemFromToDate} from '@workflowy/shared/cache';
import type {WorkflowyNode} from '@workflowy/shared/types';
import {Command, Flags} from '@oclif/core';
import {createDatabase} from '../db/index.js';
import {CacheService} from '../services/cache.js';
import {logger} from '../services/logger.js';
import {PathBuilder} from '../services/path-builder.js';
import {formatDuration} from '../utils/format-duration.js';
import {htmlToAnsi} from '../utils/html-to-ansi.js';

/**
 * Enhanced node type for display, combining cache data with recursive children.
 */
export type EnhancedCacheNode = NodeWithRelations & {
	children?: EnhancedCacheNode[];
	linkTargets?: (NodeWithRelations & {shortId: string; children?: EnhancedCacheNode[]})[];
	isMirror?: boolean;
	mirrorOf?: string;
};

export interface ListCommandFlags {
	'force-refresh': boolean;
	json: boolean;
	depth: number;
	'follow-links': boolean;
	fields?: string[];
}

export abstract class BaseListCommand extends Command {
	static hidden = true;

	protected apiClient: WorkflowyApiClient | null = null;
	private _cacheService?: CacheService;
	private _pathBuilder?: PathBuilder;

	protected get cacheService(): CacheService {
		if (!this._cacheService) {
			this._cacheService = new CacheService(createDatabase());
		}
		return this._cacheService;
	}

	protected get pathBuilder(): PathBuilder {
		if (!this._pathBuilder) {
			this._pathBuilder = new PathBuilder(createDatabase());
		}
		return this._pathBuilder;
	}

	static baseFlags = {
		'force-refresh': Flags.boolean({
			char: 'f',
			description: 'Force refresh from API, ignoring cache',
			default: false,
		}),
		json: Flags.boolean({
			char: 'j',
			description: 'Output all node details in JSON format',
			default: false,
		}),
		depth: Flags.integer({
			description: 'Depth of children to fetch (0 = no children, 1 = direct children only, etc.)',
			default: 0,
			min: 0,
			max: 10,
		}),
		'follow-links': Flags.boolean({
			char: 'l',
			description: 'Follow Workflowy links in node names to include linked node children (requires --depth > 0)',
			default: false,
		}),
		fields: Flags.string({
			description:
				'Comma-separated list of fields to include in JSON output (e.g., "id,name,note,children"). Reduces output size for LLM processing.',
			multiple: true,
		}),
	};

	/**
	 * Parse fields from flags, handling comma-separated values.
	 * E.g., ["id,name,note"] becomes ["id", "name", "note"]
	 */
	protected parseFields(fieldsInput: string[]): string[] {
		return fieldsInput.flatMap((f) => f.split(',').map((s) => s.trim()));
	}

	/**
	 * Filter a node to only include specified fields.
	 * Always includes 'id' for identification.
	 * The 'children' and 'linkTargets' fields are recursively filtered if requested.
	 */
	protected filterNodeFields(node: EnhancedCacheNode, fields: string[]): Record<string, unknown> {
		const fieldsSet = new Set(fields);
		// Always include 'id' for identification
		fieldsSet.add('id');

		const result: Record<string, unknown> = {};
		for (const field of fieldsSet) {
			if (field === 'children' && node.children) {
				result.children = node.children.map((child) => this.filterNodeFields(child, fields));
			} else if (field === 'linkTargets' && node.linkTargets) {
				result.linkTargets = node.linkTargets.map((target) => ({
					...this.filterNodeFields(target, fields),
					shortId: target.shortId,
				}));
			} else if (field in node) {
				result[field] = node[field as keyof EnhancedCacheNode];
			}
		}
		// Always include mirror metadata if present
		if (node.isMirror) {
			result.isMirror = true;
			result.mirrorOf = node.mirrorOf;
		}
		return result;
	}

	protected initializeApiClient(): void {
		const apiKey = process.env.WORKFLOWY_API_KEY;
		if (apiKey) {
			this.apiClient = new WorkflowyApiClient(apiKey, logger, process.env.WORKFLOWY_API_URL);
		}
	}

	protected async fetchNodesWithCacheFallback(
		parentId: string | null,
		flags: ListCommandFlags,
		fetchFromApi: () => Promise<WorkflowyNode[]>,
	): Promise<{nodes: EnhancedCacheNode[]; fromApi: boolean}> {
		let fetchedFromApi = false;

		// Try API first if force-refresh or no cached data
		const cachedNodes = await this.cacheService.getChildrenWithMergedData(parentId);
		const hasCachedData = cachedNodes.length > 0;
		const shouldRefresh = flags['force-refresh'] || !hasCachedData;

		if (shouldRefresh && this.apiClient) {
			try {
				const apiNodes = await fetchFromApi();
				await this.cacheService.storeApiResponse(apiNodes, parentId);
				if (!flags.json) {
					this.log(`Fetched fresh data from API`);
				}
				fetchedFromApi = true;
			} catch (apiError) {
				if (!hasCachedData && !flags.json) {
					this.warn(`API request failed, falling back to cache: ${String(apiError)}`);
				}
			}
		}

		// Always read final result from cache
		const nodes = await this.cacheService.getChildrenWithMergedData(parentId);
		if (nodes.length > 0 && !flags.json && !fetchedFromApi) {
			const cacheAge = this.calculateCacheAge(nodes);
			this.log(`Using cached data (age: ${formatDuration(cacheAge)}, sources: cache)`);
		}

		const nodesWithChildren = await this.fetchChildrenByDepthLevel(nodes, flags.depth, flags['follow-links']);
		return {nodes: nodesWithChildren, fromApi: fetchedFromApi};
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
	 * Extract Workflowy short_ids from links in a node's name.
	 * Workflowy links have format: <a href="https://workflowy.com/#/SHORT_ID">Display Text</a>
	 */
	private extractWorkflowyLinkShortIds(name: string): string[] {
		const linkPattern = /<a href="https:\/\/workflowy\.com\/#\/([a-f0-9]{12})">/gi;
		const shortIds: string[] = [];
		let match;
		while ((match = linkPattern.exec(name)) !== null) {
			shortIds.push(match[1]);
		}
		return shortIds;
	}

	/**
	 * Fetch children using batch queries - one query per depth level.
	 * If followLinks is true, resolves Workflowy links in node names and adds
	 * target nodes to the linkTargets field.
	 */
	/**
	 * Copy a mirror original's display content onto the mirror node. Workflowy
	 * stores the name/note on the original and leaves the mirror copy blank, so
	 * the mirror always inherits the original's content unconditionally.
	 *
	 * The mirror is asserted to carry no content of its own. If it does, the
	 * cache recorded the mirror relationship backwards (an original mistaken for
	 * a mirror — see the `mirrorRootIds` handling in cache-import). Failing loudly
	 * here surfaces that upstream bug instead of silently showing the wrong text.
	 */
	private assignMirrorContent(
		target: EnhancedCacheNode,
		original: {name?: string | null; note?: string | null} | undefined,
	): void {
		if (target.name) {
			throw new Error(
				`Mirror node ${target.id} has its own name ${JSON.stringify(target.name)}; ` +
					`a mirror must inherit content from its original. The mirror relationship is likely ` +
					`inverted in the cache (an original recorded as a mirror).`,
			);
		}
		if (!original) return;
		target.name = original.name ?? null;
		target.note = original.note ?? null;
	}

	protected async fetchChildrenByDepthLevel(
		nodes: NodeWithRelations[],
		maxDepth: number,
		followLinks = false,
	): Promise<EnhancedCacheNode[]> {
		if (maxDepth <= 0 || nodes.length === 0) {
			return nodes;
		}

		const nodeMap = new Map<string, EnhancedCacheNode>();
		for (const node of nodes) {
			nodeMap.set(node.id, {...node});
		}

		// Resolve mirrors among initial nodes
		const initialMirrors: {node: EnhancedCacheNode; originalId: string}[] = [];
		for (const [, enhancedNode] of nodeMap) {
			if (enhancedNode.mirrorsAsCopy && enhancedNode.mirrorsAsCopy.length > 0) {
				const {originalId} = enhancedNode.mirrorsAsCopy[0];
				enhancedNode.isMirror = true;
				enhancedNode.mirrorOf = originalId;
				initialMirrors.push({node: enhancedNode, originalId});
			}
		}
		if (initialMirrors.length > 0) {
			const originalIds = initialMirrors.map((m) => m.originalId);
			const originals = await this.cacheService.getMultipleNodes(originalIds);
			for (const {node, originalId} of initialMirrors) {
				this.assignMirrorContent(node, originals.get(originalId));
			}
		}

		// Track all link nodes that need their targets resolved
		const shortIdToLinkInfo = new Map<string, {node: EnhancedCacheNode; depthFound: number}[]>();

		// Collect links from initial nodes (depth 0)
		for (const [, enhancedNode] of nodeMap) {
			if (enhancedNode.name) {
				const shortIds = this.extractWorkflowyLinkShortIds(enhancedNode.name);
				for (const shortId of shortIds) {
					const existing = shortIdToLinkInfo.get(shortId) ?? [];
					existing.push({node: enhancedNode, depthFound: 0});
					shortIdToLinkInfo.set(shortId, existing);
				}
			}
		}

		// For mirrors, fetch children of the original node
		let currentLevelIds = nodes.map((n) => {
			const enhanced = nodeMap.get(n.id)!;
			return enhanced.mirrorOf ?? n.id;
		});
		// Maps an ID used for child fetching back to the node that should receive those children.
		// For mirrors, this maps originalId -> mirrorNode so children of the original are assigned to the mirror.
		let fetchIdToNode = new Map<string, EnhancedCacheNode>();
		for (const {node, originalId} of initialMirrors) {
			fetchIdToNode.set(originalId, node);
		}

		for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
			if (currentLevelIds.length === 0) {
				break;
			}

			const childrenByParent = await this.cacheService.getChildrenForMultipleParents(currentLevelIds);
			const nextLevelIds: string[] = [];
			const nextFetchIdToNode = new Map<string, EnhancedCacheNode>();

			for (const [fetchId, children] of childrenByParent) {
				// Look up the node: either via fetchIdToNode (for mirrors) or nodeMap
				const parentNode = fetchIdToNode.get(fetchId) ?? nodeMap.get(fetchId);
				if (parentNode && children.length > 0) {
					const enhancedChildren: EnhancedCacheNode[] = children.map((child) => ({...child}));
					parentNode.children = enhancedChildren;

					// Detect mirrors and collect original IDs to resolve
					const mirrorChildren: {child: EnhancedCacheNode; originalId: string}[] = [];
					for (const child of enhancedChildren) {
						if (child.mirrorsAsCopy && child.mirrorsAsCopy.length > 0) {
							const {originalId} = child.mirrorsAsCopy[0];
							child.isMirror = true;
							child.mirrorOf = originalId;
							mirrorChildren.push({child, originalId});
						}
					}

					// Resolve mirror content from original nodes
					if (mirrorChildren.length > 0) {
						const originalIds = mirrorChildren.map((m) => m.originalId);
						const originals = await this.cacheService.getMultipleNodes(originalIds);
						for (const {child, originalId} of mirrorChildren) {
							this.assignMirrorContent(child, originals.get(originalId));
						}
					}

					for (const child of enhancedChildren) {
						nodeMap.set(child.id, child);
						// For mirrors, fetch children of the original node and map back
						const childFetchId = child.mirrorOf ?? child.id;
						nextLevelIds.push(childFetchId);
						if (child.mirrorOf) {
							nextFetchIdToNode.set(childFetchId, child);
						}

						if (child.name) {
							const shortIds = this.extractWorkflowyLinkShortIds(child.name);
							for (const shortId of shortIds) {
								const existing = shortIdToLinkInfo.get(shortId) ?? [];
								existing.push({node: child, depthFound: currentDepth});
								shortIdToLinkInfo.set(shortId, existing);
							}
						}
					}
				}
			}

			currentLevelIds = nextLevelIds;
			fetchIdToNode = nextFetchIdToNode;
		}

		// Resolve links and populate linkTargets
		if (shortIdToLinkInfo.size > 0) {
			const allShortIds = [...shortIdToLinkInfo.keys()];
			const shortIdToUuid = await this.cacheService.resolveMultipleShortIds(allShortIds);

			for (const [shortId, uuid] of shortIdToUuid) {
				const linkInfos = shortIdToLinkInfo.get(shortId);
				const targetNode = await this.cacheService.getNode(uuid);

				if (linkInfos && targetNode) {
					let targetChildren: EnhancedCacheNode[] | undefined;

					if (followLinks) {
						const maxDepthFound = Math.max(...linkInfos.map((info) => info.depthFound));
						const remainingDepth = Math.max(0, maxDepth - maxDepthFound);
						if (remainingDepth > 0) {
							targetChildren = await this.fetchChildrenRecursive(uuid, remainingDepth);
						}
					}

					const linkTarget = {
						...targetNode,
						shortId,
						children: targetChildren,
					};

					for (const linkInfo of linkInfos) {
						if (!linkInfo.node.linkTargets) {
							linkInfo.node.linkTargets = [];
						}
						linkInfo.node.linkTargets.push(linkTarget);
					}
				}
			}
		}

		return nodes.map((n) => nodeMap.get(n.id)!);
	}

	/**
	 * Recursively fetch children up to a certain depth.
	 */
	private async fetchChildrenRecursive(parentId: string, depth: number): Promise<EnhancedCacheNode[]> {
		if (depth <= 0) return [];

		const children = await this.cacheService.getChildrenWithMergedData(parentId);
		const enhanced: EnhancedCacheNode[] = [];

		// Detect mirrors and batch-resolve originals
		const mirrorMap = new Map<string, EnhancedCacheNode>();
		for (const child of children) {
			if (child.mirrorsAsCopy && child.mirrorsAsCopy.length > 0) {
				mirrorMap.set(child.mirrorsAsCopy[0].originalId, {
					...child,
					isMirror: true,
					mirrorOf: child.mirrorsAsCopy[0].originalId,
				});
			}
		}
		const originals =
			mirrorMap.size > 0 ? await this.cacheService.getMultipleNodes([...mirrorMap.keys()]) : new Map();

		for (const child of children) {
			const enhancedChild: EnhancedCacheNode = {...child};
			let childFetchId = child.id;

			if (child.mirrorsAsCopy && child.mirrorsAsCopy.length > 0) {
				const {originalId} = child.mirrorsAsCopy[0];
				enhancedChild.isMirror = true;
				enhancedChild.mirrorOf = originalId;
				this.assignMirrorContent(enhancedChild, originals.get(originalId));
				childFetchId = originalId;
			}

			if (depth > 1) {
				enhancedChild.children = await this.fetchChildrenRecursive(childFetchId, depth - 1);
			}
			enhanced.push(enhancedChild);
		}

		return enhanced;
	}

	protected async displayNodes(nodes: EnhancedCacheNode[], flags: ListCommandFlags): Promise<void> {
		if (flags.json) {
			const output = flags.fields
				? nodes.map((node) => this.filterNodeFields(node, this.parseFields(flags.fields!)))
				: nodes;
			this.log(JSON.stringify(output, null, 2));
		} else if (nodes.length === 0) {
			this.log('No nodes found');
		} else {
			this.log(`Nodes (${nodes.length}):`);
			await this.displayNodesRecursive(nodes, 0, flags.depth > 0);
		}
	}

	private async displayNodesRecursive(
		nodes: EnhancedCacheNode[],
		depth: number,
		showTreeStructure: boolean,
	): Promise<void> {
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			const isLast = i === nodes.length - 1;

			const completedIndicator = node.completedAt ? '✓ ' : '';
			const noteIndicator = node.note ? '📝 ' : '';
			const mirrorIndicator = node.isMirror ? '\uD83E\uDE9E ' : '';
			const layoutIndicator =
				node.layoutMode && node.layoutMode !== 'bullets' ? this.getLayoutModeEmoji(node.layoutMode) : '';
			const backlinksIndicator = this.hasBacklinks(node) ? '↗️ ' : '';
			const aiChatIndicator = node.aiMetadata?.inChat ? '💬 ' : '';
			const referencesRootIndicator = node.referencesRoot ? '🔗 ' : '';
			const linkTargetsIndicator = node.linkTargets && node.linkTargets.length > 0 ? '🔗→ ' : '';

			let prefix: string;
			let urlPrefix: string;
			if (showTreeStructure) {
				const indent = '│   '.repeat(depth);
				const branch = isLast ? '└── ' : '├── ';
				prefix = indent + branch;
				const urlIndent = depth > 0 ? '│   '.repeat(depth) : '';
				urlPrefix = urlIndent + (isLast ? '    ' : '│   ') + '    ';
			} else {
				prefix = '  ';
				urlPrefix = '     ';
			}

			const nodeName = htmlToAnsi(node.name ?? '');
			const greyUrl = `\u001B[90mhttps://workflowy.com/#/${node.id}\u001B[0m`;

			this.log(
				`${prefix}${completedIndicator}${noteIndicator}${mirrorIndicator}${layoutIndicator}${backlinksIndicator}${aiChatIndicator}${referencesRootIndicator}${linkTargetsIndicator}${nodeName}`,
			);
			this.log(`${urlPrefix}🔗 ${greyUrl}`);

			if (node.children && node.children.length > 0) {
				await this.displayNodesRecursive(node.children, depth + 1, showTreeStructure);
			}

			// Display linkTargets if present
			if (node.linkTargets && node.linkTargets.length > 0) {
				for (const target of node.linkTargets) {
					const targetIndent = showTreeStructure ? '│   '.repeat(depth + 1) : '    ';
					this.log(`${targetIndent}↳ Link target: ${htmlToAnsi(target.name ?? '')}`);
					this.log(`${targetIndent}  🔗 \u001B[90mhttps://workflowy.com/#/${target.shortId}\u001B[0m`);
					if (target.children && target.children.length > 0) {
						await this.displayNodesRecursive(target.children, depth + 2, showTreeStructure);
					}
				}
			}
		}
	}

	private getLayoutModeEmoji(layoutMode: string): string {
		switch (layoutMode) {
			case 'todo': {
				return '☑️ ';
			}
			case 'headings': {
				return '📋 ';
			}
			default: {
				return `[${layoutMode}] `;
			}
		}
	}

	private hasBacklinks(node: EnhancedCacheNode): boolean {
		const backlinkPattern = /<a href="https:\/\/workflowy\.com\/#\//;
		const hasBacklinkInName = Boolean(node.name && backlinkPattern.test(node.name));
		const hasBacklinkInNote = Boolean(node.note && backlinkPattern.test(node.note));
		return hasBacklinkInName || hasBacklinkInNote;
	}
}
