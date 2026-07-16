import {WorkflowyApiClient} from '@workflowy/shared/api';
import {PathBuilder, WorkflowyWriteThroughClient} from '@workflowy/shared/cache';
import {getWorkflowyUrl} from '@workflowy/shared/workflowy';
import {Command, Flags} from '@oclif/core';
import fs from 'node:fs';
import {z} from 'zod';
import {createDatabase} from '../../db/index.js';
import {CacheService} from '../../services/cache.js';
import {logger} from '../../services/logger.js';
import {resolveOrCreateNodePath, resolveParent} from '@workflowy/shared/utils';

/**
 * Schema for a node in the JSON input structure, with recursively nested
 * children. The recursive `children` field uses a Zod v4 getter so the schema
 * is the single source of truth and `z.infer` resolves the recursion.
 */
const JsonNodeInputSchema = z.object({
	name: z.string(),
	note: z.string().optional(),
	layoutMode: z.string().optional(),
	get children() {
		return z.array(JsonNodeInputSchema).optional();
	},
});

/**
 * A node in the JSON input structure, derived from {@link JsonNodeInputSchema}.
 */
type JsonNodeInput = z.infer<typeof JsonNodeInputSchema>;

/**
 * Result of creating a node tree, including the root and all descendants.
 */
interface CreatedNodeResult {
	id: string;
	name: string;
	createdAt: number;
	children: CreatedNodeResult[];
}

/**
 * Read all content from stdin as a string
 */
async function readStdin(): Promise<string> {
	const {stdin} = process;
	if (stdin.isTTY) {
		throw new Error('No input provided on stdin. Use --name with a value or pipe content to stdin.');
	}

	const chunks: Buffer[] = [];
	for await (const chunk of stdin) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString('utf8');
}

export default class Create extends Command {
	static override description = 'Create a new Workflowy node or tree of nodes from JSON';

	static override examples = [
		'# Create node in inbox (system target)',
		'<%= config.bin %> <%= command.id %> --parent-id inbox --name "New Task"',
		'',
		'# Create node under a parent by ID',
		'<%= config.bin %> <%= command.id %> --parent-id abc123 --name "Subtask"',
		'',
		'# Create node under a parent by path',
		'<%= config.bin %> <%= command.id %> --parent-path "Work,Projects" --name "Subtask"',
		'',
		'# Create node with a specific layout mode',
		'<%= config.bin %> <%= command.id %> --parent-id abc123 --name "Notes" --layout-mode document',
		'',
		'# Create from stdin (use - for name)',
		String.raw`echo "## Section 1\n\nParagraph text" | <%= config.bin %> <%= command.id %> --parent-id abc123 --name -`,
		'',
		'# Import article content via clean-mark',
		'npx clean-mark https://example.com/article --stdout | <%= config.bin %> <%= command.id %> --parent-id abc123 --name -',
		'',
		'# Preview the API call without creating',
		'<%= config.bin %> <%= command.id %> --parent-id inbox --name "New Task" --dry-run',
		'',
		'# Create nested nodes from inline JSON',
		'<%= config.bin %> <%= command.id %> --parent-id abc123 --json \'{"name": "Project", "children": [{"name": "Task 1"}, {"name": "Task 2"}]}\'',
		'',
		'# Create nested nodes from a JSON file',
		'<%= config.bin %> <%= command.id %> --parent-id abc123 --json-file ./project-template.json',
		'',
		'# Create node under a path, creating missing segments (like mkdir -p)',
		'<%= config.bin %> <%= command.id %> --parent-path "Metadata,Scanner State,my-scanner" --name "state.json" --create-path',
	];

	static override flags = {
		name: Flags.string({
			char: 'n',
			description: 'Name of the new node (use "-" to read from stdin; markdown will be parsed into children)',
			exclusive: ['json', 'json-file'],
		}),
		json: Flags.string({
			description: 'JSON structure defining a tree of nodes to create',
			exclusive: ['name', 'note', 'layout-mode', 'json-file'],
		}),
		'json-file': Flags.string({
			description: 'Path to a JSON file defining a tree of nodes to create',
			exclusive: ['name', 'note', 'layout-mode', 'json'],
		}),
		'parent-id': Flags.string({
			description: 'ID of parent node or system target (e.g., "inbox")',
			exclusive: ['parent-path'],
		}),
		'parent-path': Flags.string({
			description: 'Comma-separated path to parent node (e.g., "Work,Projects")',
			exclusive: ['parent-id'],
		}),
		note: Flags.string({
			description: 'Note/description for the node',
		}),
		'layout-mode': Flags.string({
			description: 'Layout mode for the node (e.g., "document", "list", "board")',
		}),
		position: Flags.string({
			description: 'Position among siblings: "top" (first) or "bottom" (last, default)',
			options: ['top', 'bottom'],
		}),
		'dry-run': Flags.boolean({
			char: 'd',
			description: 'Show the API call that would be made without executing',
			default: false,
		}),
		'create-path': Flags.boolean({
			description: 'Create missing parent path segments (like mkdir -p)',
			default: false,
		}),
	};

	public async run(): Promise<void> {
		const {flags} = await this.parse(Create);

		const apiKey = process.env.WORKFLOWY_API_KEY;
		if (!apiKey) {
			this.error('WORKFLOWY_API_KEY environment variable is required');
		}

		// Validate that either --name or --json/--json-file is provided
		if (!flags.name && !flags.json && !flags['json-file']) {
			this.error('Either --name, --json, or --json-file is required');
		}

		const apiClient = new WorkflowyApiClient(apiKey, logger, process.env.WORKFLOWY_API_URL);
		const database = createDatabase();
		const cacheService = new CacheService(database);
		const client = new WorkflowyWriteThroughClient(apiClient, cacheService);

		// Validate that at least one parent specifier is provided
		if (!flags['parent-id'] && !flags['parent-path']) {
			this.error('Parent node is required. Use --parent-id or --parent-path to specify a parent.');
		}

		// Resolve parent ID, optionally creating missing path segments
		// Note: --create-path is ignored with --dry-run to avoid creating real nodes
		const parentId =
			flags['create-path'] && flags['parent-path'] && !flags['dry-run']
				? await resolveOrCreateNodePath(flags['parent-path'], cacheService, apiClient)
				: await resolveParent({id: flags['parent-id'], path: flags['parent-path']}, cacheService, apiClient);

		// Handle JSON input mode
		if (flags.json || flags['json-file']) {
			await this.runJsonMode(flags, parentId, apiClient, cacheService, database);
			return;
		}

		// Handle stdin input when --name is "-"
		let name = flags.name!;
		if (name === '-') {
			try {
				name = await readStdin();
			} catch (error) {
				this.error(error instanceof Error ? error.message : 'Failed to read from stdin');
			}
		}

		// Handle single node creation mode (original behavior)
		await this.runSingleNodeMode({...flags, name}, parentId, client, database);
	}

	/**
	 * Create a single node (original behavior)
	 */
	private async runSingleNodeMode(
		flags: {
			name?: string;
			note?: string;
			'layout-mode'?: string;
			position?: string;
			'dry-run': boolean;
		},
		parentId: string,
		client: WorkflowyWriteThroughClient,
		database: ReturnType<typeof createDatabase>,
	): Promise<void> {
		const name = flags.name!;

		if (flags['dry-run']) {
			const requestBody: {parent_id: string; name: string; note?: string; layoutMode?: string} = {
				parent_id: parentId,
				name,
			};
			if (flags.note) {
				requestBody.note = flags.note;
			}
			if (flags['layout-mode']) {
				requestBody.layoutMode = flags['layout-mode'];
			}

			this.log('Would execute API call:');
			this.log('  Method: POST');
			this.log('  URL: https://workflowy.com/api/v1/nodes/');
			this.log('  Headers:');
			this.log('    Authorization: Bearer <WORKFLOWY_API_KEY>');
			this.log('    Content-Type: application/json');
			this.log('  Body:');
			this.log(`    ${JSON.stringify(requestBody, null, 2).split('\n').join('\n    ')}`);

			const pathBuilder = new PathBuilder(database);
			const parentPath = await pathBuilder.buildFullPath(parentId);
			this.log('');
			this.log(`Parent: ${parentPath}`);
		} else {
			this.log(`Creating node: ${name}`);
			const pathBuilder = new PathBuilder(database);
			const parentPath = await pathBuilder.buildFullPath(parentId);
			this.log(`Parent: ${parentPath}`);

			const newNode = await client.createNode({
				parent_id: parentId,
				name,
				note: flags.note,
				layoutMode: flags['layout-mode'],
				position: flags.position as 'top' | 'bottom' | undefined,
			});

			this.log('');
			this.log('Successfully created node');
			this.log(`  ID: ${newNode.id}`);
			this.log(`  Name: ${newNode.name}`);
			this.log(`  Created: ${new Date(newNode.createdAt * 1000).toISOString()}`);
			this.log(`  URL: ${getWorkflowyUrl(newNode.id)}`);
		}
	}

	/**
	 * Create nodes from JSON input (tree structure)
	 */
	private async runJsonMode(
		flags: {
			json?: string;
			'json-file'?: string;
			'dry-run': boolean;
			position?: string;
		},
		parentId: string,
		apiClient: WorkflowyApiClient,
		cacheService: CacheService,
		database: ReturnType<typeof createDatabase>,
	): Promise<void> {
		// Parse JSON input
		let jsonInput: unknown;
		if (flags.json) {
			try {
				jsonInput = JSON.parse(flags.json);
			} catch {
				this.error('Invalid JSON in --json flag');
			}
		} else if (flags['json-file']) {
			const filePath = flags['json-file'];
			if (!fs.existsSync(filePath)) {
				this.error(`File not found: ${filePath}`);
			}
			try {
				const fileContent = fs.readFileSync(filePath, 'utf8');
				jsonInput = JSON.parse(fileContent);
			} catch {
				this.error(`Failed to parse JSON from file: ${filePath}`);
			}
		}

		// Validate JSON structure
		const parseResult = JsonNodeInputSchema.safeParse(jsonInput);
		if (!parseResult.success) {
			this.error(`Invalid JSON structure: ${parseResult.error.message}`);
		}

		const nodeTree = parseResult.data;

		if (flags['dry-run']) {
			await this.dryRunJsonMode(nodeTree, parentId, database);
			return;
		}

		// Create nodes recursively
		this.log('Creating node tree...');
		const pathBuilder = new PathBuilder(database);
		const parentPath = await pathBuilder.buildFullPath(parentId);
		this.log(`Parent: ${parentPath}`);
		this.log('');

		const result = await this.createNodeTree(
			nodeTree,
			parentId,
			apiClient,
			cacheService,
			flags.position as 'top' | 'bottom' | undefined,
		);

		// Output results
		this.log('Successfully created node tree:');
		this.printCreatedTree(result, 0);

		// Output JSON result for programmatic use
		this.log('');
		this.log('Created node IDs (JSON):');
		this.log(JSON.stringify(this.flattenCreatedNodes(result), null, 2));
	}

	/**
	 * Recursively create a tree of nodes.
	 *
	 * @param nodeInput - The node structure to create
	 * @param parentId - The parent node ID
	 * @param apiClient - The API client for creating nodes
	 * @param cacheService - The cache service for updating local cache
	 * @param position - Position for the root node. Children always use 'bottom' to preserve array order.
	 */
	private async createNodeTree(
		nodeInput: JsonNodeInput,
		parentId: string,
		apiClient: WorkflowyApiClient,
		cacheService: CacheService,
		position?: 'top' | 'bottom',
	): Promise<CreatedNodeResult> {
		// Create the current node
		const newNode = await apiClient.createNode({
			parent_id: parentId,
			name: nodeInput.name,
			note: nodeInput.note,
			layoutMode: nodeInput.layoutMode,
			position,
		});

		// Update cache for this node (use insertNode to avoid expiring siblings)
		await cacheService.insertNode(newNode, parentId);

		// Recursively create children - always use 'bottom' to preserve array order
		const childResults: CreatedNodeResult[] = [];
		if (nodeInput.children && nodeInput.children.length > 0) {
			for (const child of nodeInput.children) {
				const childResult = await this.createNodeTree(child, newNode.id, apiClient, cacheService, 'bottom');
				childResults.push(childResult);
			}
		}

		return {
			id: newNode.id,
			name: newNode.name,
			createdAt: newNode.createdAt,
			children: childResults,
		};
	}

	/**
	 * Print the created tree structure
	 */
	private printCreatedTree(node: CreatedNodeResult, depth: number): void {
		const indent = '  '.repeat(depth);
		this.log(`${indent}- ${node.name}`);
		this.log(`${indent}  ID: ${node.id}`);
		this.log(`${indent}  URL: ${getWorkflowyUrl(node.id)}`);

		for (const child of node.children) {
			this.printCreatedTree(child, depth + 1);
		}
	}

	/**
	 * Flatten created nodes into an array of {id, name, parentId} objects
	 */
	private flattenCreatedNodes(
		node: CreatedNodeResult,
		parentId?: string,
	): Array<{id: string; name: string; parentId: string | null}> {
		const result: Array<{id: string; name: string; parentId: string | null}> = [
			{
				id: node.id,
				name: node.name,
				parentId: parentId ?? null,
			},
		];

		for (const child of node.children) {
			result.push(...this.flattenCreatedNodes(child, node.id));
		}

		return result;
	}

	/**
	 * Show dry-run output for JSON mode
	 */
	private async dryRunJsonMode(
		nodeTree: JsonNodeInput,
		parentId: string,
		database: ReturnType<typeof createDatabase>,
	): Promise<void> {
		this.log('Would create the following node tree:');
		this.log('');

		const pathBuilder = new PathBuilder(database);
		const parentPath = await pathBuilder.buildFullPath(parentId);
		this.log(`Parent: ${parentPath}`);
		this.log('');

		this.printNodeTreePreview(nodeTree, 0);

		this.log('');
		this.log('API calls that would be made:');
		const nodeCount = this.countNodes(nodeTree);
		this.log(`  ${nodeCount} POST requests to https://workflowy.com/api/v1/nodes/`);
	}

	/**
	 * Print a preview of the node tree that would be created
	 */
	private printNodeTreePreview(node: JsonNodeInput, depth: number): void {
		const indent = '  '.repeat(depth);
		this.log(`${indent}- ${node.name}`);
		if (node.note) {
			this.log(`${indent}  Note: ${node.note.slice(0, 50)}${node.note.length > 50 ? '...' : ''}`);
		}
		if (node.layoutMode) {
			this.log(`${indent}  Layout: ${node.layoutMode}`);
		}

		if (node.children) {
			for (const child of node.children) {
				this.printNodeTreePreview(child, depth + 1);
			}
		}
	}

	/**
	 * Count total nodes in a tree
	 */
	private countNodes(node: JsonNodeInput): number {
		let count = 1;
		if (node.children) {
			for (const child of node.children) {
				count += this.countNodes(child);
			}
		}
		return count;
	}
}
