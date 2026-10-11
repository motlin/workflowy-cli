import {NodeTreeReader} from "@workflowy/shared/cache";
import {resolveNodeId, resolveOrCreateNodePath, resolveParent} from "@workflowy/shared/utils";
import {z} from "zod";
import {getApiClient, getCacheService, getWriteThroughClient} from "../services.js";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerNodeTools(server: McpServer): void {
	server.registerTool(
		"workflowy_node_get",
		{
			description: "Get a node by ID or path",
			inputSchema: {
				id: z.string().optional().describe("Node ID"),
				path: z.string().optional().describe("Comma-separated path to node"),
			},
		},
		async ({id, path}) => {
			if (!id && !path) {
				return {content: [{type: "text", text: "Either id or path is required"}], isError: true};
			}

			const cacheService = getCacheService();
			const apiClient = getApiClient();

			const nodeId = await resolveNodeId({id, path}, cacheService, apiClient);
			const [node] = await new NodeTreeReader(cacheService).readNodes([nodeId], {depth: 0});

			if (!node) {
				return {content: [{type: "text", text: `Node not found: ${nodeId}`}], isError: true};
			}

			return {content: [{type: "text", text: JSON.stringify(node, null, 2)}]};
		},
	);

	server.registerTool(
		"workflowy_node_list",
		{
			description: "List children of a node",
			inputSchema: {
				parentId: z.string().optional().describe("Parent node ID (null for root)"),
				parentPath: z.string().optional().describe("Comma-separated path to parent"),
				depth: z.number().optional().default(1).describe("Depth to recurse (1 = immediate children only)"),
			},
		},
		async ({parentId, parentPath, depth}) => {
			const cacheService = getCacheService();
			const apiClient = getApiClient();

			let resolvedParentId: string | null = null;
			if (parentId || parentPath) {
				resolvedParentId = await resolveParent({id: parentId, path: parentPath}, cacheService, apiClient);
			}

			// This tool's `depth` counts levels of nodes returned (1 = immediate children only),
			// whereas readChildren's depth counts levels below each returned node, so subtract one.
			const result = await new NodeTreeReader(cacheService).readChildren(resolvedParentId, {
				depth: Math.max(0, depth - 1),
			});
			return {content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
		},
	);

	server.registerTool(
		"workflowy_node_create",
		{
			description: "Create a new node",
			inputSchema: {
				parentId: z.string().optional().describe('Parent node ID or system target (e.g., "inbox")'),
				parentPath: z.string().optional().describe("Comma-separated path to parent"),
				name: z.string().describe("Name of the new node"),
				note: z.string().optional().describe("Note/description for the node"),
				position: z.enum(["top", "bottom"]).optional().describe("Position among siblings"),
				createPath: z
					.boolean()
					.optional()
					.default(false)
					.describe("Create missing parent path segments (like mkdir -p)"),
			},
		},
		async ({parentId, parentPath, name, note, position, createPath}) => {
			if (!parentId && !parentPath) {
				return {content: [{type: "text", text: "Either parentId or parentPath is required"}], isError: true};
			}

			const cacheService = getCacheService();
			const apiClient = getApiClient();
			const writeThroughClient = getWriteThroughClient();

			const resolvedParentId = await (createPath && parentPath
				? resolveOrCreateNodePath(parentPath, cacheService, apiClient)
				: resolveParent({id: parentId, path: parentPath}, cacheService, apiClient));

			const newNode = await writeThroughClient.createNode({
				parent_id: resolvedParentId,
				name,
				note,
				position,
			});

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								id: newNode.id,
								name: newNode.name,
								createdAt: new Date(newNode.createdAt * 1000).toISOString(),
								url: `https://workflowy.com/#/${newNode.id.replaceAll("-", "")}`,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.registerTool(
		"workflowy_node_update",
		{
			description: "Update an existing node",
			inputSchema: {
				id: z.string().optional().describe("Node ID"),
				path: z.string().optional().describe("Comma-separated path to node"),
				name: z.string().optional().describe("New name for the node"),
				note: z.string().optional().describe("New note for the node"),
			},
		},
		async ({id, path, name, note}) => {
			if (!id && !path) {
				return {content: [{type: "text", text: "Either id or path is required"}], isError: true};
			}
			if (!name && note === undefined) {
				return {
					content: [{type: "text", text: "At least one of name or note must be provided"}],
					isError: true,
				};
			}

			const cacheService = getCacheService();
			const apiClient = getApiClient();
			const writeThroughClient = getWriteThroughClient();

			const nodeId = await resolveNodeId({id, path}, cacheService, apiClient);
			const updatedNode = await writeThroughClient.updateNode(nodeId, {name, note});

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								id: updatedNode.id,
								name: updatedNode.name,
								note: updatedNode.note,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.registerTool(
		"workflowy_node_delete",
		{
			description: "Delete a node",
			inputSchema: {
				id: z.string().optional().describe("Node ID"),
				path: z.string().optional().describe("Comma-separated path to node"),
			},
		},
		async ({id, path}) => {
			if (!id && !path) {
				return {content: [{type: "text", text: "Either id or path is required"}], isError: true};
			}

			const cacheService = getCacheService();
			const apiClient = getApiClient();
			const writeThroughClient = getWriteThroughClient();

			const nodeId = await resolveNodeId({id, path}, cacheService, apiClient);
			await writeThroughClient.deleteNode(nodeId);

			return {content: [{type: "text", text: `Successfully deleted node: ${nodeId}`}]};
		},
	);

	server.registerTool(
		"workflowy_node_complete",
		{
			description: "Mark a node as completed",
			inputSchema: {
				id: z.string().optional().describe("Node ID"),
				path: z.string().optional().describe("Comma-separated path to node"),
			},
		},
		async ({id, path}) => {
			if (!id && !path) {
				return {content: [{type: "text", text: "Either id or path is required"}], isError: true};
			}

			const cacheService = getCacheService();
			const apiClient = getApiClient();
			const writeThroughClient = getWriteThroughClient();

			const nodeId = await resolveNodeId({id, path}, cacheService, apiClient);
			const completedNode = await writeThroughClient.completeNode(nodeId);

			return {
				content: [
					{type: "text", text: `Successfully completed node: ${completedNode.name} (${completedNode.id})`},
				],
			};
		},
	);

	server.registerTool(
		"workflowy_node_uncomplete",
		{
			description: "Mark a node as not completed",
			inputSchema: {
				id: z.string().optional().describe("Node ID"),
				path: z.string().optional().describe("Comma-separated path to node"),
			},
		},
		async ({id, path}) => {
			if (!id && !path) {
				return {content: [{type: "text", text: "Either id or path is required"}], isError: true};
			}

			const cacheService = getCacheService();
			const apiClient = getApiClient();
			const writeThroughClient = getWriteThroughClient();

			const nodeId = await resolveNodeId({id, path}, cacheService, apiClient);
			const uncompletedNode = await writeThroughClient.uncompleteNode(nodeId);

			return {
				content: [
					{
						type: "text",
						text: `Successfully uncompleted node: ${uncompletedNode.name} (${uncompletedNode.id})`,
					},
				],
			};
		},
	);

	server.registerTool(
		"workflowy_node_move",
		{
			description: "Move a node to a new parent",
			inputSchema: {
				nodeId: z.string().optional().describe("ID of node to move"),
				nodePath: z.string().optional().describe("Comma-separated path to node to move"),
				parentId: z.string().optional().describe("Destination parent ID or system target"),
				parentPath: z.string().optional().describe("Comma-separated path to destination parent"),
				position: z.enum(["top", "bottom"]).optional().describe("Position within destination"),
			},
		},
		async ({nodeId, nodePath, parentId, parentPath, position}) => {
			if (!nodeId && !nodePath) {
				return {content: [{type: "text", text: "Either nodeId or nodePath is required"}], isError: true};
			}
			if (!parentId && !parentPath) {
				return {content: [{type: "text", text: "Either parentId or parentPath is required"}], isError: true};
			}

			const cacheService = getCacheService();
			const apiClient = getApiClient();
			const writeThroughClient = getWriteThroughClient();

			const resolvedNodeId = await resolveNodeId({id: nodeId, path: nodePath}, cacheService, apiClient);
			const resolvedParentId = await resolveParent({id: parentId, path: parentPath}, cacheService, apiClient);

			const positionValue = position === "top" ? -1 : position === "bottom" ? 0 : undefined;
			const movedNode = await writeThroughClient.moveNode(resolvedNodeId, resolvedParentId, positionValue);

			return {
				content: [{type: "text", text: `Successfully moved node: ${movedNode.name} (${movedNode.id})`}],
			};
		},
	);
}
