import {WorkflowyApiClient} from '@workflowy/shared/api';
import type {NodeAttachment, NodeResponse} from '../../node-types.js';
import {CacheService, NodeReader, NodeTreeReader, WorkflowyWriteThroughClient} from '@workflowy/shared/cache';
import {mirrors as mirrorsTable, nodeContent, s3Files} from '@workflowy/shared/db';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import type {Node} from '@workflowy/shared/types';
import {isShortId} from '@workflowy/shared/workflowy';
import {and, eq, inArray} from 'drizzle-orm';
import {Hono} from 'hono';
import {getDatabase} from '../db.js';

/**
 * Resolve an ID parameter that could be a short ID (12 hex chars) or a full UUID.
 * Returns the full UUID, or null if a short ID couldn't be resolved.
 */
async function resolveNodeId(id: string): Promise<string | null> {
	if (!isShortId(id)) {
		return id;
	}
	const db = getDatabase();
	const cacheService = new CacheService(db);
	return cacheService.resolveShortIdToUuid(id);
}

/**
 * If the given node ID is a mirror, return the original node ID.
 * Otherwise return the same ID. Used when fetching children —
 * a mirror's children are the original node's children.
 */
function resolveMirrorToOriginal(nodeId: string): string {
	const reader = new NodeReader(getDatabase());
	return reader.getById(nodeId)?.mirror.originalNodeId ?? nodeId;
}

/**
 * Convert a Date to a Unix timestamp in seconds, or null.
 */
function toUnixSeconds(date: Date | null): number | null {
	return date ? Math.floor(date.getTime() / 1000) : null;
}

/**
 * Serialize a canonical `Node` into the snake_case Workflowy-compatible
 * REST response. The `hasChildren` flag and the mirror name/note fallback
 * are derived per-request and supplied by the caller.
 */
function nodeToRestDto(
	node: Node,
	derived: {
		hasChildren: boolean;
		name: string | null;
		note: string | null;
		attachment?: NodeAttachment | null;
	},
): NodeResponse {
	return {
		id: node.id,
		parent_id: node.parentId,
		name: derived.name,
		note: derived.note,
		priority: node.priority,
		data: {layoutMode: node.layoutMode},
		createdAt: toUnixSeconds(node.createdAt),
		modifiedAt: toUnixSeconds(node.modifiedAt),
		completedAt: toUnixSeconds(node.completedAt),
		hasChildren: derived.hasChildren,
		isMirror: node.mirror.isMirror,
		originalNodeId: node.mirror.originalNodeId,
		attachment: derived.attachment ?? null,
	};
}

/**
 * Load file-attachment metadata for a batch of node IDs from the `s3_files`
 * cache table. Returns a map from node ID to its attachment; nodes without an
 * attachment are absent from the map. `isDeleted` is normalized to a boolean —
 * the column stores 1/0/NULL, and anything other than 1 means "not deleted".
 */
function loadAttachments(nodeIds: string[]): Map<string, NodeAttachment> {
	const map = new Map<string, NodeAttachment>();
	if (nodeIds.length === 0) {
		return map;
	}
	const db = getDatabase();
	const rows = db
		.select({
			nodeId: s3Files.nodeId,
			fileName: s3Files.fileName,
			fileType: s3Files.fileType,
			objectFolder: s3Files.objectFolder,
			imageOriginalWidth: s3Files.imageOriginalWidth,
			imageOriginalHeight: s3Files.imageOriginalHeight,
			isDeleted: s3Files.isDeleted,
		})
		.from(s3Files)
		.where(and(inArray(s3Files.nodeId, nodeIds), eq(s3Files.systemTo, FAR_FUTURE_DATE)))
		.all();
	for (const row of rows) {
		map.set(row.nodeId, {
			fileName: row.fileName,
			fileType: row.fileType,
			objectFolder: row.objectFolder,
			imageOriginalWidth: row.imageOriginalWidth,
			imageOriginalHeight: row.imageOriginalHeight,
			isDeleted: row.isDeleted === 1,
		});
	}
	return map;
}

/**
 * Helper to get CacheService and WriteThrough client
 */
function getServices(apiKey?: string) {
	const db = getDatabase();
	const cacheService = new CacheService(db);

	if (apiKey) {
		const apiClient = new WorkflowyApiClient(apiKey, undefined, process.env.WORKFLOWY_API_URL);
		const client = new WorkflowyWriteThroughClient(apiClient, cacheService);
		return {db, cacheService, client};
	}

	return {db, cacheService, client: undefined};
}

export const nodesRouter = new Hono();

// GET /api/v1/nodes - List children (or root nodes if no parent_id; accepts short IDs)
nodesRouter.get('/', async (c) => {
	const parentIdParam = c.req.query('parent_id');

	// Workflowy API accepts "None" for top-level nodes, or omitting the param
	let parentId = parentIdParam === 'None' || parentIdParam === '' ? null : (parentIdParam ?? null);

	// Resolve short ID to full UUID if needed
	if (parentId) {
		const resolved = await resolveNodeId(parentId);
		if (!resolved) {
			return c.json({error: 'Parent node not found'}, 404);
		}
		// If the node is a mirror, fetch the original's children
		parentId = resolveMirrorToOriginal(resolved);
	}

	const db = getDatabase();

	// NodeTreeReader resolves the mirror name/note fallback (a blank mirror copy
	// borrows its original's content) and fails loudly on inverted relationships.
	const nodes = await new NodeTreeReader(new CacheService(db)).readChildren(parentId, {depth: 0});

	// Determine which nodes have children (single query for efficiency)
	const nodeIds = nodes.map((n) => n.id);
	const parentIdsWithChildren = new Set<string>();
	if (nodeIds.length > 0) {
		const childRows = db
			.selectDistinct({parentId: nodeContent.parentId})
			.from(nodeContent)
			.where(and(inArray(nodeContent.parentId, nodeIds), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
			.all();
		for (const row of childRows) {
			if (row.parentId) parentIdsWithChildren.add(row.parentId);
		}
	}

	// Batch-load file attachments for all returned nodes.
	const attachments = loadAttachments(nodeIds);

	const nodeResponses: NodeResponse[] = nodes.map((node) =>
		nodeToRestDto(node, {
			hasChildren: parentIdsWithChildren.has(node.id),
			name: node.name,
			note: node.note,
			attachment: attachments.get(node.id) ?? null,
		}),
	);

	return c.json({nodes: nodeResponses});
});

// GET /api/v1/nodes/:id - Get single node (accepts UUID or short ID)
nodesRouter.get('/:id', async (c) => {
	const rawId = c.req.param('id');
	const id = await resolveNodeId(rawId);
	if (!id) {
		return c.json({error: 'Node not found'}, 404);
	}

	const db = getDatabase();

	// NodeTreeReader resolves the mirror name/note fallback and mirror flags.
	const [node] = await new NodeTreeReader(new CacheService(db)).readNodes([id], {depth: 0});
	if (!node) {
		return c.json({error: 'Node not found'}, 404);
	}

	// Check if this node has children
	const childCheck = db
		.select({id: nodeContent.id})
		.from(nodeContent)
		.where(and(eq(nodeContent.parentId, id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
		.limit(1)
		.get();

	const attachment = loadAttachments([id]).get(id) ?? null;

	const nodeResponse: NodeResponse = nodeToRestDto(node, {
		hasChildren: childCheck !== undefined,
		name: node.name,
		note: node.note,
		attachment,
	});

	// Wrap in { node: ... } to match Workflowy API format
	return c.json({node: nodeResponse});
});

// POST /api/v1/nodes - Create node
nodesRouter.post('/', async (c) => {
	const apiKey = process.env.WORKFLOWY_API_KEY;
	if (!apiKey) {
		return c.json({error: 'WORKFLOWY_API_KEY environment variable is required'}, 500);
	}

	const body = await c.req.json();
	const {
		parent_id: parentId,
		name,
		note,
		layoutMode,
		position,
	} = body as {
		parent_id?: string;
		name: string;
		note?: string;
		layoutMode?: string;
		position?: number;
	};

	if (!name) {
		return c.json({error: 'name is required'}, 400);
	}

	if (!parentId) {
		return c.json({error: 'parent_id is required'}, 400);
	}

	const {client} = getServices(apiKey);
	if (!client) {
		return c.json({error: 'Failed to initialize client'}, 500);
	}

	const resolvedPosition: 'top' | 'bottom' | undefined =
		position === undefined ? undefined : position < 0 ? 'top' : 'bottom';

	const createdNode = await client.createNode({
		parent_id: parentId,
		name,
		note,
		layoutMode,
		position: resolvedPosition,
	});

	// Return in Workflowy response format
	const nodeResponse: NodeResponse = {
		id: createdNode.id,
		parent_id: parentId ?? null,
		name: createdNode.name,
		note: createdNode.note ?? null,
		priority: createdNode.priority,
		data: {layoutMode: createdNode.data?.layoutMode ?? null},
		createdAt: createdNode.createdAt,
		modifiedAt: createdNode.modifiedAt,
		completedAt: createdNode.completedAt ?? null,
		hasChildren: true,
		isMirror: false,
		originalNodeId: null,
		attachment: null,
	};

	return c.json(nodeResponse, 201);
});

// POST /api/v1/nodes/:id - Update node
nodesRouter.post('/:id', async (c) => {
	const apiKey = process.env.WORKFLOWY_API_KEY;
	if (!apiKey) {
		return c.json({error: 'WORKFLOWY_API_KEY environment variable is required'}, 500);
	}

	const id = await resolveNodeId(c.req.param('id'));
	if (!id) {
		return c.json({error: 'Node not found'}, 404);
	}
	const body = await c.req.json();
	const {name, note, layoutMode} = body as {
		name?: string;
		note?: string;
		layoutMode?: string;
	};

	// Validate that at least one field is provided
	if (name === undefined && note === undefined && layoutMode === undefined) {
		return c.json({error: 'At least one of name, note, or layoutMode is required'}, 400);
	}

	const {cacheService, client} = getServices(apiKey);
	if (!client) {
		return c.json({error: 'Failed to initialize client'}, 500);
	}

	// Get current node to preserve parentId and verify existence
	const existingNode = await cacheService.getNode(id);
	if (!existingNode) {
		return c.json({error: 'Node not found'}, 404);
	}

	const updatedNode = await client.updateNode(id, {name, note, layoutMode});

	// Return in Workflowy response format
	const nodeResponse: NodeResponse = {
		id: updatedNode.id,
		parent_id: existingNode.parentId,
		name: updatedNode.name,
		note: updatedNode.note ?? null,
		priority: updatedNode.priority,
		data: {layoutMode: updatedNode.data?.layoutMode ?? null},
		createdAt: updatedNode.createdAt,
		modifiedAt: updatedNode.modifiedAt,
		completedAt: updatedNode.completedAt ?? null,
		hasChildren: true,
		isMirror: false,
		originalNodeId: null,
		attachment: null,
	};

	return c.json({node: nodeResponse});
});

// DELETE /api/v1/nodes/:id - Delete node
nodesRouter.delete('/:id', async (c) => {
	const apiKey = process.env.WORKFLOWY_API_KEY;
	if (!apiKey) {
		return c.json({error: 'WORKFLOWY_API_KEY environment variable is required'}, 500);
	}

	const id = await resolveNodeId(c.req.param('id'));
	if (!id) {
		return c.json({error: 'Node not found'}, 404);
	}

	const {cacheService, client} = getServices(apiKey);
	if (!client) {
		return c.json({error: 'Failed to initialize client'}, 500);
	}

	// Verify the node exists before attempting to delete
	const existingNode = await cacheService.getNode(id);
	if (!existingNode) {
		return c.json({error: 'Node not found'}, 404);
	}

	await client.deleteNode(id);

	return c.body(null, 204);
});

// POST /api/v1/nodes/:id/complete - Mark node as completed
nodesRouter.post('/:id/complete', async (c) => {
	const apiKey = process.env.WORKFLOWY_API_KEY;
	if (!apiKey) {
		return c.json({error: 'WORKFLOWY_API_KEY environment variable is required'}, 500);
	}

	const id = await resolveNodeId(c.req.param('id'));
	if (!id) {
		return c.json({error: 'Node not found'}, 404);
	}

	const {cacheService, client} = getServices(apiKey);
	if (!client) {
		return c.json({error: 'Failed to initialize client'}, 500);
	}

	// Verify the node exists before attempting to complete
	const existingNode = await cacheService.getNode(id);
	if (!existingNode) {
		return c.json({error: 'Node not found'}, 404);
	}

	const completedNode = await client.completeNode(id);

	// Return in Workflowy response format
	const nodeResponse: NodeResponse = {
		id: completedNode.id,
		parent_id: existingNode.parentId,
		name: completedNode.name,
		note: completedNode.note ?? null,
		priority: completedNode.priority,
		data: {layoutMode: completedNode.data?.layoutMode ?? null},
		createdAt: completedNode.createdAt,
		modifiedAt: completedNode.modifiedAt,
		completedAt: completedNode.completedAt ?? null,
		hasChildren: true,
		isMirror: false,
		originalNodeId: null,
		attachment: null,
	};

	return c.json({node: nodeResponse});
});

// GET /api/v1/nodes/:id/ancestors - Get all ancestors from root to node
nodesRouter.get('/:id/ancestors', async (c) => {
	const id = await resolveNodeId(c.req.param('id'));
	if (!id) {
		return c.json({error: 'Node not found'}, 404);
	}

	const reader = new NodeReader(getDatabase());

	// Build ancestor chain by following parent_id pointers
	const ancestors: NodeResponse[] = [];
	let currentId: string | null = id;

	while (currentId !== null) {
		const node = reader.getById(currentId);
		if (!node) {
			break;
		}

		const nodeResponse: NodeResponse = {
			...nodeToRestDto(node, {hasChildren: true, name: node.name, note: node.note}),
			isMirror: false,
			originalNodeId: null,
		};

		ancestors.unshift(nodeResponse);
		currentId = node.parentId;
	}

	return c.json({ancestors});
});

// GET /api/v1/nodes/:id/mirrors - Get all locations where a node appears (original + mirrors)
nodesRouter.get('/:id/mirrors', async (c) => {
	const rawId = c.req.param('id');
	const id = await resolveNodeId(rawId);
	if (!id) {
		return c.json({error: 'Node not found'}, 404);
	}

	const db = getDatabase();
	const reader = new NodeReader(db);

	// First, resolve to the original node (in case we were given a mirror ID)
	const originalId = resolveMirrorToOriginal(id);

	// Find all mirrors of the original node
	const mirrorRows = db
		.select({mirrorId: mirrorsTable.mirrorId})
		.from(mirrorsTable)
		.where(and(eq(mirrorsTable.originalId, originalId), eq(mirrorsTable.systemTo, FAR_FUTURE_DATE)))
		.all();

	// Collect all node IDs: the original + all mirrors
	const allIds = [originalId, ...mirrorRows.map((r) => r.mirrorId)];

	// Get the node name — in Workflowy's data model, either the original or mirror
	// may carry the name (the other has an empty name). Check all nodes in the group.
	let nodeName = 'Untitled';
	for (const nodeId of allIds) {
		const groupNode = reader.getById(nodeId);
		if (groupNode?.name) {
			nodeName = groupNode.name;
			break;
		}
	}

	// Helper to build ancestor breadcrumb path for a node
	function getAncestorPath(nodeId: string): {id: string; name: string}[] {
		const path: {id: string; name: string}[] = [];
		let currentId: string | null = nodeId;
		while (currentId !== null) {
			const node = reader.getById(currentId);
			if (!node) break;
			path.unshift({id: node.id, name: node.name ?? 'Untitled'});
			currentId = node.parentId;
		}
		return path;
	}

	// For each location, build the full ancestor path
	const locations = [];
	for (const nodeId of allIds) {
		const path = getAncestorPath(nodeId);
		locations.push({
			id: nodeId,
			path,
			isOriginal: nodeId === originalId,
		});
	}

	return c.json({
		mirrors: locations,
		originalId,
		nodeName,
	});
});

// POST /api/v1/nodes/:id/uncomplete - Mark node as not completed
nodesRouter.post('/:id/uncomplete', async (c) => {
	const apiKey = process.env.WORKFLOWY_API_KEY;
	if (!apiKey) {
		return c.json({error: 'WORKFLOWY_API_KEY environment variable is required'}, 500);
	}

	const id = await resolveNodeId(c.req.param('id'));
	if (!id) {
		return c.json({error: 'Node not found'}, 404);
	}

	const {cacheService, client} = getServices(apiKey);
	if (!client) {
		return c.json({error: 'Failed to initialize client'}, 500);
	}

	// Verify the node exists before attempting to uncomplete
	const existingNode = await cacheService.getNode(id);
	if (!existingNode) {
		return c.json({error: 'Node not found'}, 404);
	}

	const uncompletedNode = await client.uncompleteNode(id);

	// Return in Workflowy response format
	const nodeResponse: NodeResponse = {
		id: uncompletedNode.id,
		parent_id: existingNode.parentId,
		name: uncompletedNode.name,
		note: uncompletedNode.note ?? null,
		priority: uncompletedNode.priority,
		data: {layoutMode: uncompletedNode.data?.layoutMode ?? null},
		createdAt: uncompletedNode.createdAt,
		modifiedAt: uncompletedNode.modifiedAt,
		completedAt: uncompletedNode.completedAt ?? null,
		hasChildren: true,
		isMirror: false,
		originalNodeId: null,
		attachment: null,
	};

	return c.json({node: nodeResponse});
});

// POST /api/v1/nodes/:id/move - Move node to new parent
nodesRouter.post('/:id/move', async (c) => {
	const apiKey = process.env.WORKFLOWY_API_KEY;
	if (!apiKey) {
		return c.json({error: 'WORKFLOWY_API_KEY environment variable is required'}, 500);
	}

	const id = await resolveNodeId(c.req.param('id'));
	if (!id) {
		return c.json({error: 'Node not found'}, 404);
	}
	const body = await c.req.json();
	const {parent_id: newParentId, position} = body as {
		parent_id: string | null;
		position?: number;
	};

	// parent_id is required but can be null (for root level) or a string (for a parent node)
	// Empty string means root level as well
	const normalizedParentId = newParentId === '' ? null : newParentId;

	if (normalizedParentId === undefined) {
		return c.json({error: 'parent_id is required'}, 400);
	}

	const {cacheService, client} = getServices(apiKey);
	if (!client) {
		return c.json({error: 'Failed to initialize client'}, 500);
	}

	// Verify the node exists
	const existingNode = await cacheService.getNode(id);
	if (!existingNode) {
		return c.json({error: 'Node not found'}, 404);
	}

	const oldParentId = existingNode.parentId;

	const movedNode = await client.moveNode(id, normalizedParentId, position);

	// Return in Workflowy response format
	const nodeResponse: NodeResponse = {
		id: movedNode.id,
		parent_id: normalizedParentId,
		name: movedNode.name,
		note: movedNode.note ?? null,
		priority: movedNode.priority,
		data: {layoutMode: movedNode.data?.layoutMode ?? null},
		createdAt: movedNode.createdAt,
		modifiedAt: movedNode.modifiedAt,
		completedAt: movedNode.completedAt ?? null,
		hasChildren: true,
		isMirror: false,
		originalNodeId: null,
		attachment: null,
	};

	return c.json({node: nodeResponse, oldParentId});
});
