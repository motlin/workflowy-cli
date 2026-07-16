import type {Node} from '../types/node.js';
import type {CacheService, NodeWithRelations} from './cache-service.js';

/**
 * A Workflowy link target embedded in another node's text. Carries the target's
 * canonical {@link Node} fields plus the short ID it was linked by, and its own
 * children when link-following is enabled.
 */
export type LinkTarget = Node & {shortId: string; children?: NodeTree[]};

/**
 * A {@link Node} with its resolved subtree and display-only extras.
 *
 * This is the read layer's output shape: adapters (CLI, MCP, web) consume
 * `NodeTree` and never touch the raw joined Drizzle row. The raw row
 * ({@link NodeWithRelations}) stays confined inside {@link NodeTreeReader}.
 *
 * `inChat` and `hasReferencesRoot` are the two attribute flags the CLI renderer
 * needs that are deliberately absent from the lean `Node` DTO; they are computed
 * here from the same batched query that fetches the children.
 */
export type NodeTree = Node & {
	/** Direct children, resolved up to the requested depth. */
	children?: NodeTree[];
	/** Workflowy link targets found in this node's text. */
	linkTargets?: LinkTarget[];
	/** Whether the node participates in an AI chat (`aiMetadata.inChat`). */
	inChat: boolean;
	/** Whether the node is a references-root. */
	hasReferencesRoot: boolean;
};

const WORKFLOWY_LINK_PATTERN = /<a href="https:\/\/workflowy\.com\/#\/([a-f0-9]{12})">/gi;

/** Extract Workflowy link short IDs from a node's name. */
function extractWorkflowyLinkShortIds(name: string): string[] {
	const shortIds: string[] = [];
	let match: RegExpExecArray | null;
	// Reset lastIndex per call: the regex is module-level and stateful with /g.
	WORKFLOWY_LINK_PATTERN.lastIndex = 0;
	while ((match = WORKFLOWY_LINK_PATTERN.exec(name)) !== null) {
		shortIds.push(match[1]);
	}
	return shortIds;
}

/** Map a raw joined cache row onto the clean {@link NodeTree} shape. */
function rawToTree(raw: NodeWithRelations): NodeTree {
	const originalId = raw.mirrorsAsCopy?.[0]?.originalId ?? null;
	return {
		id: raw.id,
		shortId: raw.shortId,
		parentId: raw.parentId,
		name: raw.name,
		note: raw.note,
		priority: raw.priority ?? 0,
		layoutMode: raw.layoutMode,
		createdAt: raw.createdAt,
		modifiedAt: raw.modifiedAt,
		completedAt: raw.completedAt,
		collapsed: false,
		mirror: {isMirror: originalId !== null, originalNodeId: originalId},
		systemFrom: raw.systemFrom,
		systemTo: raw.systemTo,
		inChat: Boolean(raw.aiMetadata?.inChat),
		hasReferencesRoot: raw.referencesRoot != null,
	};
}

/**
 * Copy a mirror original's display content onto the mirror node. Workflowy
 * stores name/note on the original and leaves the mirror copy blank, so the
 * mirror inherits the original's content unconditionally.
 *
 * Throws if the mirror already carries its own name: that means the cache
 * recorded the mirror relationship backwards (an original mistaken for a
 * mirror). Failing loudly surfaces that upstream bug instead of silently
 * rendering the wrong text.
 */
function assignMirrorContent(target: NodeTree, original: Node | undefined): void {
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

/** Options controlling how deep a subtree is read and whether links are followed. */
export interface ReadTreeOptions {
	/** Number of child levels to resolve (0 = the roots only). */
	depth: number;
	/** Follow Workflowy links in node text, populating `linkTargets`. */
	followLinks?: boolean;
}

/**
 * Reads node subtrees from the cache, resolving mirrors and Workflowy links, and
 * emits the clean {@link NodeTree} shape.
 *
 * The single deep read module behind every adapter's list/get: the depth
 * batching, mirror content assignment, and link resolution live here once
 * instead of being re-implemented per adapter.
 */
export class NodeTreeReader {
	constructor(private readonly cache: CacheService) {}

	/** Read the children of `parentId` as subtrees to the requested depth. */
	async readChildren(parentId: string | null, options: ReadTreeOptions): Promise<NodeTree[]> {
		const rootRows = await this.cache.getChildrenWithMergedData(parentId);
		return this.buildTrees(rootRows, options);
	}

	/** Read the given nodes as subtrees to the requested depth, preserving caller order. */
	async readNodes(nodeIds: string[], options: ReadTreeOptions): Promise<NodeTree[]> {
		if (nodeIds.length === 0) return [];
		const rows = await this.cache.getMergedDataForNodes(nodeIds);
		const byId = new Map(rows.map((row) => [row.id, row]));
		const ordered = nodeIds.map((id) => byId.get(id)).filter((row): row is NodeWithRelations => row !== undefined);
		return this.buildTrees(ordered, options);
	}

	private async buildTrees(rootRows: NodeWithRelations[], options: ReadTreeOptions): Promise<NodeTree[]> {
		const {depth, followLinks = false} = options;
		const roots = rootRows.map((row) => rawToTree(row));
		if (roots.length === 0) return roots;

		// Map every node reachable in the tree by ID so children can be attached.
		const treeMap = new Map<string, NodeTree>();
		for (const root of roots) treeMap.set(root.id, root);

		// Records where a fetch ID (the original's ID for a mirror) maps back to the
		// tree node that should receive the fetched children.
		const linkSites = new Map<string, {node: NodeTree; depthFound: number}[]>();

		await this.resolveMirrorContent(roots);
		this.collectLinkSites(roots, 0, linkSites);

		let fetchIdToNode = new Map<string, NodeTree>();
		let currentLevelIds = roots.map((node) => {
			const fetchId = node.mirror.originalNodeId ?? node.id;
			if (node.mirror.originalNodeId) fetchIdToNode.set(fetchId, node);
			return fetchId;
		});

		for (let currentDepth = 1; currentDepth <= depth; currentDepth++) {
			if (currentLevelIds.length === 0) break;

			const childrenByParent = await this.cache.getChildrenForMultipleParents(currentLevelIds);
			const nextLevelIds: string[] = [];
			const nextFetchIdToNode = new Map<string, NodeTree>();

			for (const [fetchId, childRows] of childrenByParent) {
				const parentNode = fetchIdToNode.get(fetchId) ?? treeMap.get(fetchId);
				if (!parentNode || childRows.length === 0) continue;

				const children = childRows.map((row) => rawToTree(row));
				parentNode.children = children;
				await this.resolveMirrorContent(children);

				for (const child of children) {
					treeMap.set(child.id, child);
					const childFetchId = child.mirror.originalNodeId ?? child.id;
					nextLevelIds.push(childFetchId);
					if (child.mirror.originalNodeId) nextFetchIdToNode.set(childFetchId, child);
				}
				this.collectLinkSites(children, currentDepth, linkSites);
			}

			currentLevelIds = nextLevelIds;
			fetchIdToNode = nextFetchIdToNode;
		}

		await this.resolveLinkTargets(linkSites, depth, followLinks);

		return roots;
	}

	/** Assign originals' content to any mirrors in this level. */
	private async resolveMirrorContent(nodes: NodeTree[]): Promise<void> {
		const mirrors = nodes.filter((node) => node.mirror.originalNodeId !== null);
		if (mirrors.length === 0) return;
		const originalIds = mirrors.map((node) => node.mirror.originalNodeId!);
		const originals = await this.cache.getMultipleNodes(originalIds);
		for (const node of mirrors) {
			assignMirrorContent(node, originals.get(node.mirror.originalNodeId!));
		}
	}

	/** Record link short IDs found in a level's node names. */
	private collectLinkSites(
		nodes: NodeTree[],
		depthFound: number,
		linkSites: Map<string, {node: NodeTree; depthFound: number}[]>,
	): void {
		for (const node of nodes) {
			if (!node.name) continue;
			for (const shortId of extractWorkflowyLinkShortIds(node.name)) {
				const existing = linkSites.get(shortId) ?? [];
				existing.push({node, depthFound});
				linkSites.set(shortId, existing);
			}
		}
	}

	/** Resolve collected link short IDs to target nodes and attach them. */
	private async resolveLinkTargets(
		linkSites: Map<string, {node: NodeTree; depthFound: number}[]>,
		maxDepth: number,
		followLinks: boolean,
	): Promise<void> {
		if (linkSites.size === 0) return;

		const shortIdToUuid = await this.cache.resolveMultipleShortIds([...linkSites.keys()]);
		for (const [shortId, uuid] of shortIdToUuid) {
			const sites = linkSites.get(shortId);
			const targetNode = await this.cache.getNode(uuid);
			if (!sites || !targetNode) continue;

			let targetChildren: NodeTree[] | undefined;
			if (followLinks) {
				const deepestFound = Math.max(...sites.map((site) => site.depthFound));
				const remainingDepth = Math.max(0, maxDepth - deepestFound);
				if (remainingDepth > 0) {
					targetChildren = await this.readChildren(uuid, {depth: remainingDepth});
				}
			}

			const linkTarget: LinkTarget = {...targetNode, shortId, children: targetChildren};
			for (const site of sites) {
				(site.node.linkTargets ??= []).push(linkTarget);
			}
		}
	}
}
