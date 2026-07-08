import {Flags} from '@oclif/core';
import {logger} from '../../services/logger.js';
import {htmlToAnsi} from '../../utils/html-to-ansi.js';
import {BaseListCommand, type EnhancedCacheNode, type ListCommandFlags} from '../base-list-command.js';

interface GetFlags extends ListCommandFlags {
	id?: string;
	path?: string;
	fields?: string[];
	'follow-mirror'?: boolean;
}

export default class Get extends BaseListCommand {
	static override hidden = false;
	static override description = 'Read a single Workflowy node with optional children';

	static override examples = [
		'# Read node by ID',
		'<%= config.bin %> <%= command.id %> --id abc123',
		'',
		'# Read node by short ID from Workflowy URL (12 hex chars)',
		'<%= config.bin %> <%= command.id %> --id c8708df23f1e',
		'',
		'# Read node by path',
		'<%= config.bin %> <%= command.id %> --path "Work,Projects,My Project"',
		'',
		'# Read node with children (depth 3)',
		'<%= config.bin %> <%= command.id %> --id abc123 --depth 3',
		'',
		'# Read node with full tree and follow links',
		'<%= config.bin %> <%= command.id %> --path "Personal,Inbox" --depth 5 --follow-links',
		'',
		'# Follow a mirror to its original node',
		'<%= config.bin %> <%= command.id %> --id abc123 --follow-mirror',
		'',
		'# Output as JSON',
		'<%= config.bin %> <%= command.id %> --id abc123 --json',
		'',
		'# Output JSON with only specific fields (reduces token usage for LLM processing)',
		'<%= config.bin %> <%= command.id %> --path "Metadata,Inboxes" --depth 3 --json --fields id,name,note,completed,children',
	];

	static override flags = {
		...BaseListCommand.baseFlags,
		id: Flags.string({
			char: 'i',
			description: 'ID of the node to read (full UUID or 12-char short ID from URL)',
			exclusive: ['path'],
		}),
		path: Flags.string({
			char: 'p',
			description: 'Comma-separated path to the node (e.g., "Work,Projects,My Project")',
			exclusive: ['id'],
		}),
		'follow-mirror': Flags.boolean({
			char: 'm',
			description: 'If the node is a mirror, follow it to the original node',
			default: false,
		}),
	};

	public async run(): Promise<void> {
		const {flags} = await this.parse(Get);
		const typedFlags = flags as GetFlags;

		if (!typedFlags.id && !typedFlags.path) {
			this.error('Either --id or --path is required');
		}

		this.initializeApiClient();

		let node: EnhancedCacheNode | null = null;
		let nodeId: string | undefined;
		let isMirror = false;
		let originalId: string | null = null;

		// First try to find the node ID
		if (typedFlags.id) {
			const idInput = typedFlags.id;
			// Check if this is a short ID (12 hex characters) or a full UUID
			const shortIdPattern = /^[0-9a-f]{12}$/i;
			if (shortIdPattern.test(idInput)) {
				// Resolve short ID to full UUID
				const resolvedId = await this.cacheService.resolveShortIdToUuid(idInput);
				if (resolvedId) {
					nodeId = resolvedId;
					logger.debug(`Resolved short ID ${idInput} to full UUID ${resolvedId}`);
				} else {
					this.error(`No node found for short ID: ${idInput}`);
				}
			} else {
				nodeId = idInput;
			}
		} else if (typedFlags.path) {
			const nodePath = typedFlags.path.split(',').map((s) => s.trim());

			const cachedNode = await this.cacheService.findNodeByPath(nodePath);
			if (cachedNode) {
				nodeId = cachedNode.id;
			} else {
				this.error(`Node not found at path: ${nodePath.join(' > ')}`);
			}
		}

		// Check if this node is a mirror
		if (nodeId) {
			originalId = await this.cacheService.getMirrorOriginal(nodeId);
			if (originalId) {
				isMirror = true;
				if (typedFlags['follow-mirror']) {
					logger.debug(`Node ${nodeId} is a mirror of ${originalId}, following to original`);
					nodeId = originalId;
				}
			}
		}

		// Fetch node data if we don't have it yet
		if (!node && nodeId) {
			const cachedNode = await this.cacheService.getNode(nodeId);
			if (cachedNode) {
				node = cachedNode;
			}
		}

		if (!node) {
			this.error(`Node not found with ID: ${nodeId}`);
		}

		// Fetch children if depth > 0
		let nodeWithChildren: EnhancedCacheNode = {...node};
		if (typedFlags.depth > 0) {
			const nodesWithChildren = await this.fetchChildrenByDepthLevel(
				[node],
				typedFlags.depth,
				typedFlags['follow-links'],
			);
			nodeWithChildren = nodesWithChildren[0];
		}

		await this.applyMirrorNameFallbackRecursive(nodeWithChildren);

		// Display output
		await this.displayNodeWithChildren(nodeWithChildren, typedFlags, {isMirror, originalId});
	}

	private async applyMirrorNameFallback(node: EnhancedCacheNode): Promise<void> {
		if (node.name) return;
		for (const m of node.mirrorsAsCopy ?? []) {
			const original = await this.cacheService.getNode(m.originalId);
			if (original?.name) {
				node.name = original.name;
				if (!node.note) node.note = original.note;
				return;
			}
		}
		for (const m of node.mirrorsAsOriginal ?? []) {
			const mirrorNode = await this.cacheService.getNode(m.mirrorId);
			if (mirrorNode?.name) {
				node.name = mirrorNode.name;
				if (!node.note) node.note = mirrorNode.note;
				return;
			}
		}
	}

	private async applyMirrorNameFallbackRecursive(node: EnhancedCacheNode): Promise<void> {
		await this.applyMirrorNameFallback(node);
		for (const child of node.children ?? []) {
			await this.applyMirrorNameFallbackRecursive(child);
		}
		for (const target of node.linkTargets ?? []) {
			await this.applyMirrorNameFallback(target as EnhancedCacheNode);
			for (const child of target.children ?? []) {
				await this.applyMirrorNameFallbackRecursive(child);
			}
		}
	}

	private async displayNodeWithChildren(
		node: EnhancedCacheNode,
		flags: GetFlags,
		mirrorInfo?: {isMirror: boolean; originalId: string | null},
	): Promise<void> {
		const fullPath = await this.pathBuilder.buildFullPath(node.id);

		if (flags.json) {
			let outputNode: Record<string, unknown>;
			if (flags.fields) {
				const parsedFields = this.parseFields(flags.fields);
				outputNode = this.filterNodeFields(node, parsedFields);
				// Always include path in filtered output if path field is requested
				if (parsedFields.includes('path')) {
					outputNode.path = fullPath;
				}
			} else {
				outputNode = {
					...node,
					path: fullPath,
				};
			}
			// Add mirror info if the original node was a mirror (before following)
			if (mirrorInfo?.isMirror && !flags['follow-mirror']) {
				outputNode.mirror = {
					isMirror: true,
					originalId: mirrorInfo.originalId,
				};
			}
			this.log(JSON.stringify(outputNode, null, 2));
		} else {
			// Display the node header
			this.log(`Node: ${fullPath}`);
			this.log(`\u{1F517} \u001B[90mhttps://workflowy.com/#/${node.id}\u001B[0m`);

			// Display mirror info if this was a mirror and we didn't follow it
			if (mirrorInfo?.isMirror && !flags['follow-mirror'] && mirrorInfo.originalId) {
				this.log(`\u001B[33m\u{1FA9E} This is a mirror of: ${mirrorInfo.originalId}\u001B[0m`);
				this.log(`   Use --follow-mirror (-m) to view the original node`);
			}
			this.log('');

			// If we have children and depth was requested, display as tree
			if (flags.depth > 0 && node.children && node.children.length > 0) {
				this.log(`${htmlToAnsi(node.name ?? '')}`);
				this.log(`Children (${this.countDescendants(node)} nodes):`);
				await this.displayChildrenAsTree(node.children, flags);
			} else if (flags.depth > 0) {
				this.log(`${htmlToAnsi(node.name ?? '')}`);
				this.log('No children');
			} else {
				// Show detailed node info when not fetching children
				this.log(`Name: ${htmlToAnsi(node.name ?? '')}`);
				if (node.note) {
					this.log(`Note: ${node.note}`);
				}
				this.log(`Completed: ${node.completedAt !== null}`);
				if (node.createdAt) {
					this.log(`Created: ${node.createdAt.toISOString()}`);
				}
				if (node.modifiedAt) {
					this.log(`Modified: ${node.modifiedAt.toISOString()}`);
				}
				if (node.completedAt) {
					this.log(`Completed At: ${node.completedAt.toISOString()}`);
				}
				if (node.layoutMode) {
					this.log(`Layout: ${node.layoutMode}`);
				}
			}
		}
	}

	private async displayChildrenAsTree(children: EnhancedCacheNode[], flags: GetFlags): Promise<void> {
		// Use the parent's displayNodes but wrap children in a fake parent structure
		await this.displayNodes(children, flags);
	}

	private countDescendants(node: EnhancedCacheNode): number {
		let count = 0;
		if (node.children) {
			for (const child of node.children) {
				count += 1 + this.countDescendants(child);
			}
		}
		return count;
	}
}
