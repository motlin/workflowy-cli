import {WorkflowyApiClient} from "@workflowy/shared/api";
import type {BacklinkCrumb, BacklinksResponse, NodeAttachment, NodeResponse} from "../../node-types.js";
import {NodeReader, NodeTreeReader, WorkflowyWriteThroughClient} from "@workflowy/shared/cache";
import {mirrors as mirrorsTable, s3Files} from "@workflowy/shared/db";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import type {RestoreInput, WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import type {Node} from "@workflowy/shared/types";
import {HOME_TARGET} from "@workflowy/shared/types";
import {isShortId} from "@workflowy/shared/workflowy";
import {and, eq, inArray} from "drizzle-orm";
import {Hono} from "hono";
import type {Context} from "hono";
import {
	currentBacklinkSources,
	findReferencesRoot,
	parentIdsWithChildren as parentIdsWithVisibleChildren,
} from "../backlinks.js";
import type {AppEnv, ServerContext} from "../context.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";

/**
 * Resolve an ID parameter that could be a short ID (12 hex chars) or a full UUID.
 * Returns the full UUID, or null if a short ID couldn't be resolved.
 */
function resolveNodeId(ctx: ServerContext, id: string): string | null {
	if (!isShortId(id)) {
		return id;
	}
	return ctx.cacheService.resolveShortIdToUuid(id);
}

/**
 * If the given node ID is a mirror, return the original node ID.
 * Otherwise return the same ID. Used when fetching children —
 * a mirror's children are the original node's children.
 */
function resolveMirrorToOriginal(ctx: ServerContext, nodeId: string): string {
	const reader = new NodeReader(ctx.db);
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
function loadAttachments(ctx: ServerContext, nodeIds: string[]): Map<string, NodeAttachment> {
	const map = new Map<string, NodeAttachment>();
	if (nodeIds.length === 0) {
		return map;
	}
	const rows = ctx.db
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
 * Build the write-through client from the context, or undefined when no API key
 * is configured (read-only mode).
 */
function getWriteClient(ctx: ServerContext): WorkflowyWriteThroughClient | undefined {
	if (!ctx.apiKey) {
		return undefined;
	}
	const apiClient = new WorkflowyApiClient(ctx.apiKey, undefined, process.env.WORKFLOWY_API_URL);
	return new WorkflowyWriteThroughClient(apiClient, ctx.cacheService);
}

/**
 * The internal-API adapter for exact-index tree writes, or undefined when the
 * internal API (or the public API key its write-through refresh needs) is not
 * configured.
 */
function getAdapter(ctx: ServerContext): WorkflowyInternalAdapter | undefined {
	return ctx.apiKey ? ctx.internalAdapter?.() : undefined;
}

/** A node as the REST API returns it, read from the cache; undefined when it is not cached. */
async function readNodeDto(ctx: ServerContext, id: string): Promise<NodeResponse | undefined> {
	// NodeTreeReader gives a mirror its original's name and note, and sets mirror flags.
	const [node] = await new NodeTreeReader(ctx.cacheService).readNodes([id], {depth: 0});
	if (node === undefined) {
		return undefined;
	}
	const hasChildren = parentIdsWithVisibleChildren(ctx.db, [node.mirror.originalNodeId ?? id]).size > 0;
	const attachment = loadAttachments(ctx, [id]).get(id) ?? null;
	return nodeToRestDto(node, {hasChildren, name: node.name, note: node.note, attachment});
}

/** A parent's children (Home's for `null`) as the REST API returns them, read from the cache. */
async function readChildDtos(ctx: ServerContext, parentId: string | null): Promise<NodeResponse[]> {
	// NodeTreeReader gives each mirror its original's name and note. A references
	// root is never a row: its backlinks render as the parent's Backlinks section.
	const nodes = (await new NodeTreeReader(ctx.cacheService).readChildren(parentId, {depth: 0})).filter(
		(node) => !node.hasReferencesRoot,
	);
	// Determine which nodes have children (single query for efficiency)
	const parentIdsWithChildren = parentIdsWithVisibleChildren(
		ctx.db,
		nodes.map((node) => node.mirror.originalNodeId ?? node.id),
	);
	// Batch-load file attachments for all returned nodes.
	const attachments = loadAttachments(
		ctx,
		nodes.map((node) => node.id),
	);
	return nodes.map((node) =>
		nodeToRestDto(node, {
			hasChildren: parentIdsWithChildren.has(node.mirror.originalNodeId ?? node.id),
			name: node.name,
			note: node.note,
			attachment: attachments.get(node.id) ?? null,
		}),
	);
}

/** The refreshed children of every affected parent, in order, as one list. */
async function readSiblingDtos(ctx: ServerContext, parentIds: (string | null)[]): Promise<NodeResponse[]> {
	const lists = await Promise.all([...new Set(parentIds)].map(async (parentId) => readChildDtos(ctx, parentId)));
	return lists.flat();
}

type ParentResult = {ok: true; parentId: string | null} | {ok: false; status: 400 | 404; error: string};

/**
 * Resolve a request's `parent_id`: `null`, `""`, `"None"` and `"home"` mean
 * Home (`null`); a short id is expanded from the cache. Undefined is rejected.
 */
function parseParent(ctx: ServerContext, raw: unknown): ParentResult {
	if (raw === undefined) {
		return {ok: false, status: 400, error: "parent_id is required"};
	}
	if (raw === null || raw === "" || raw === "None" || raw === HOME_TARGET) {
		return {ok: true, parentId: null};
	}
	if (typeof raw !== "string") {
		return {ok: false, status: 400, error: "parent_id must be a string or null"};
	}
	const resolved = resolveNodeId(ctx, raw);
	return resolved === null
		? {ok: false, status: 404, error: "Parent node not found"}
		: {ok: true, parentId: resolved};
}

type IndexResult = {ok: true; index: number | undefined} | {ok: false; error: string};

/**
 * The requested slot: `index` when given, else the legacy `position` (negative
 * means top, anything else bottom), else undefined (bottom).
 */
function parseIndex(index: unknown, position: unknown): IndexResult {
	if (index !== undefined) {
		return typeof index === "number" && Number.isInteger(index) && index >= 0
			? {ok: true, index}
			: {ok: false, error: "index must be a non-negative integer"};
	}
	return {ok: true, index: typeof position === "number" && position < 0 ? 0 : undefined};
}

/** The adapter's parent id: a node id, or `HOME_TARGET`. */
function adapterParent(parentId: string | null): string {
	return parentId ?? HOME_TARGET;
}

/**
 * Map a slot onto the public API's two ends: omitted or past the last child is
 * the bottom, 0 the top. Any other slot needs the internal API (undefined).
 */
function publicEnd(index: number | undefined, childCount: number): "top" | "bottom" | undefined {
	if (index === undefined || index >= childCount) {
		return "bottom";
	}
	return index === 0 ? "top" : undefined;
}

/** The public API's move position for an end: negative is top, anything else bottom. */
function publicMovePosition(end: "top" | "bottom"): number {
	return end === "top" ? -1 : 0;
}

function countChildren(ctx: ServerContext, parentId: string | null): number {
	return ctx.cacheService.getChildren(parentId).length;
}

export const nodesRouter = new Hono<AppEnv>();

// GET /api/v1/nodes - List children (or root nodes if no parent_id; accepts short IDs)
nodesRouter.get("/", async (c) => {
	const ctx = c.get("ctx");
	const parentIdParam = c.req.query("parent_id");

	// Workflowy API accepts "None" for top-level nodes, or omitting the param
	let parentId = parentIdParam === "None" || parentIdParam === "" ? null : (parentIdParam ?? null);

	// Resolve short ID to full UUID if needed
	if (parentId) {
		const resolved = resolveNodeId(ctx, parentId);
		if (!resolved) {
			return c.json({error: "Parent node not found"}, 404);
		}
		// If the node is a mirror, fetch the original's children
		parentId = resolveMirrorToOriginal(ctx, resolved);
	}

	return c.json({nodes: await readChildDtos(ctx, parentId)});
});

// GET /api/v1/nodes/:id - Get single node (accepts UUID or short ID)
nodesRouter.get("/:id", async (c) => {
	const ctx = c.get("ctx");
	const rawId = c.req.param("id");
	const id = resolveNodeId(ctx, rawId);
	if (!id) {
		return c.json({error: "Node not found"}, 404);
	}

	const nodeResponse = await readNodeDto(ctx, id);
	if (nodeResponse === undefined) {
		return c.json({error: "Node not found"}, 404);
	}

	// Wrap in { node: ... } to match Workflowy API format
	return c.json({node: nodeResponse});
});

// POST /api/v1/nodes - Create node at an exact `index` among all siblings (omitted = bottom)
nodesRouter.post("/", async (c) => {
	const ctx = c.get("ctx");
	const client = getWriteClient(ctx);
	if (!client) {
		return c.json({error: "WORKFLOWY_API_KEY environment variable is required"}, 500);
	}

	const body = await c.req.json<{
		parent_id?: string | null;
		name?: string;
		note?: string;
		layoutMode?: string;
		index?: number;
		/** Legacy: negative = top, anything else = bottom. */
		position?: number;
	}>();
	const {name, note, layoutMode} = body;

	// An empty name is valid: every empty-row create (add button, Enter) sends `name: ""`.
	if (typeof name !== "string") {
		return c.json({error: "name is required"}, 400);
	}

	const parent = parseParent(ctx, body.parent_id);
	if (!parent.ok) {
		return c.json({error: parent.error}, parent.status);
	}
	const {parentId} = parent;
	const slot = parseIndex(body.index, body.position);
	if (!slot.ok) {
		return c.json({error: slot.error}, 400);
	}
	const count = countChildren(ctx, parentId);

	const adapter = getAdapter(ctx);
	if (adapter) {
		const {id} = await adapter.createAt({
			parentId: adapterParent(parentId),
			index: slot.index ?? count,
			name,
			...(note === undefined ? {} : {note}),
			...(layoutMode === undefined ? {} : {metadata: {layoutMode}}),
		});
		const node = await readNodeDto(ctx, id);
		if (node === undefined) {
			return c.json({error: `Created node ${id} is missing from the cache`}, 500);
		}
		return c.json({node}, 201);
	}

	const end = publicEnd(slot.index, count);
	if (end === undefined) {
		return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	}

	const createdNode = await client.createNode({
		parent_id: parentId ?? HOME_TARGET,
		name,
		note,
		layoutMode,
		position: end,
	});

	// Return in Workflowy response format
	const nodeResponse: NodeResponse = {
		id: createdNode.id,
		parent_id: parentId,
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

	return c.json({node: nodeResponse}, 201);
});

// POST /api/v1/nodes/move - Move a block of nodes, in the given order, to an exact `index`
nodesRouter.post("/move", async (c) => {
	const ctx = c.get("ctx");
	const client = getWriteClient(ctx);
	if (!client) {
		return c.json({error: "WORKFLOWY_API_KEY environment variable is required"}, 500);
	}

	const body = await c.req.json<{ids?: unknown; parent_id?: string | null; index?: number}>();
	if (
		!Array.isArray(body.ids) ||
		body.ids.length === 0 ||
		!body.ids.every((id): id is string => typeof id === "string")
	) {
		return c.json({error: "ids must be a non-empty array of strings"}, 400);
	}
	const ids: string[] = [];
	for (const rawId of body.ids) {
		const id = resolveNodeId(ctx, rawId);
		if (id === null || !ctx.cacheService.getNode(id)) {
			return c.json({error: `Node not found: ${rawId}`}, 404);
		}
		ids.push(id);
	}
	return moveNodes(c, client, ids, body.parent_id, body.index, undefined);
});

// POST /api/v1/nodes/:id - Update node
nodesRouter.post("/:id", async (c) => {
	const ctx = c.get("ctx");
	const client = getWriteClient(ctx);
	if (!client) {
		return c.json({error: "WORKFLOWY_API_KEY environment variable is required"}, 500);
	}

	const id = resolveNodeId(ctx, c.req.param("id"));
	if (!id) {
		return c.json({error: "Node not found"}, 404);
	}
	const {name, note, layoutMode} = await c.req.json<{
		name?: string;
		note?: string;
		layoutMode?: string;
	}>();

	// Validate that at least one field is provided
	if (name === undefined && note === undefined && layoutMode === undefined) {
		return c.json({error: "At least one of name, note, or layoutMode is required"}, 400);
	}

	const {cacheService} = ctx;
	// Get current node to preserve parentId and verify existence
	const existingNode = cacheService.getNode(id);
	if (!existingNode) {
		return c.json({error: "Node not found"}, 404);
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
nodesRouter.delete("/:id", async (c) => {
	const ctx = c.get("ctx");
	const client = getWriteClient(ctx);
	if (!client) {
		return c.json({error: "WORKFLOWY_API_KEY environment variable is required"}, 500);
	}

	const id = resolveNodeId(ctx, c.req.param("id"));
	if (!id) {
		return c.json({error: "Node not found"}, 404);
	}

	const {cacheService} = ctx;
	// Verify the node exists before attempting to delete
	const existingNode = cacheService.getNode(id);
	if (!existingNode) {
		return c.json({error: "Node not found"}, 404);
	}

	await client.deleteNode(id);

	return c.body(null, 204);
});

// POST /api/v1/nodes/:id/complete - Mark node as completed
nodesRouter.post("/:id/complete", async (c) => {
	const ctx = c.get("ctx");
	const client = getWriteClient(ctx);
	if (!client) {
		return c.json({error: "WORKFLOWY_API_KEY environment variable is required"}, 500);
	}

	const id = resolveNodeId(ctx, c.req.param("id"));
	if (!id) {
		return c.json({error: "Node not found"}, 404);
	}

	const {cacheService} = ctx;
	// Verify the node exists before attempting to complete
	const existingNode = cacheService.getNode(id);
	if (!existingNode) {
		return c.json({error: "Node not found"}, 404);
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
nodesRouter.get("/:id/ancestors", (c) => {
	const ctx = c.get("ctx");
	const id = resolveNodeId(ctx, c.req.param("id"));
	if (!id) {
		return c.json({error: "Node not found"}, 404);
	}

	const reader = new NodeReader(ctx.db);

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

// GET /api/v1/nodes/:id/backlinks - The item's Backlinks section: its references root
// and the backlink items whose source is current, each with the source's text and crumbs.
nodesRouter.get("/:id/backlinks", async (c) => {
	const ctx = c.get("ctx");
	const id = resolveNodeId(ctx, c.req.param("id"));
	if (!id) {
		return c.json({error: "Node not found"}, 404);
	}
	const {db} = ctx;
	const rootId = findReferencesRoot(db, resolveMirrorToOriginal(ctx, id));
	if (rootId === null) {
		const empty: BacklinksResponse = {rootId: null, items: []};
		return c.json(empty);
	}

	const sourceByItem = currentBacklinkSources(db, rootId);
	const entries = (await new NodeTreeReader(ctx.cacheService).readChildren(rootId, {depth: 0})).flatMap((item) => {
		const sourceId = sourceByItem.get(item.id);
		return sourceId === undefined ? [] : [{item, sourceId}];
	});
	const sourceIds = entries.map(({sourceId}) => sourceId);
	const sources = new Map(
		(await new NodeTreeReader(ctx.cacheService).readNodes(sourceIds, {depth: 0})).map((source) => [
			source.id,
			source,
		]),
	);
	const withChildren = parentIdsWithVisibleChildren(db, sourceIds);
	const reader = new NodeReader(db);

	const crumbsOf = (sourceId: string): BacklinkCrumb[] => {
		const crumbs: BacklinkCrumb[] = [];
		let currentId = reader.getById(sourceId)?.parentId ?? null;
		while (currentId !== null) {
			const ancestor = reader.getById(currentId);
			if (!ancestor) {
				break;
			}
			crumbs.unshift({id: ancestor.id, name: ancestor.name ?? ""});
			currentId = ancestor.parentId;
		}
		return crumbs;
	};

	const body: BacklinksResponse = {
		rootId,
		items: entries.flatMap(({item, sourceId}) => {
			const source = sources.get(sourceId);
			if (!source) {
				return [];
			}
			return [
				{
					node: {
						...nodeToRestDto(item, {
							hasChildren: withChildren.has(sourceId),
							name: source.name,
							note: source.note,
						}),
						completedAt: toUnixSeconds(source.completedAt),
						isMirror: true,
						originalNodeId: sourceId,
					},
					sourceId,
					crumbs: crumbsOf(sourceId),
				},
			];
		}),
	};
	return c.json(body);
});

// GET /api/v1/nodes/:id/mirrors - Get all locations where a node appears (original + mirrors)
nodesRouter.get("/:id/mirrors", (c) => {
	const ctx = c.get("ctx");
	const rawId = c.req.param("id");
	const id = resolveNodeId(ctx, rawId);
	if (!id) {
		return c.json({error: "Node not found"}, 404);
	}

	const {db} = ctx;
	const reader = new NodeReader(db);

	// First, resolve to the original node (in case we were given a mirror ID)
	const originalId = resolveMirrorToOriginal(ctx, id);

	// Find all mirrors of the original node
	const mirrorRows = db
		.select({mirrorId: mirrorsTable.mirrorId})
		.from(mirrorsTable)
		.where(and(eq(mirrorsTable.originalId, originalId), eq(mirrorsTable.systemTo, FAR_FUTURE_DATE)))
		.all();

	// Collect all node IDs: the original + all mirrors
	const allIds = [originalId, ...mirrorRows.map((r) => r.mirrorId)];

	// A mirror's text always comes from its original.
	const nodeName = (reader.getById(originalId)?.name ?? "") || "Untitled";

	// Helper to build ancestor breadcrumb path for a node
	function getAncestorPath(nodeId: string): {id: string; name: string}[] {
		const path: {id: string; name: string}[] = [];
		let currentId: string | null = nodeId;
		while (currentId !== null) {
			const node = reader.getById(currentId);
			if (!node) {
				break;
			}
			path.unshift({id: node.id, name: node.name ?? "Untitled"});
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
nodesRouter.post("/:id/uncomplete", async (c) => {
	const ctx = c.get("ctx");
	const client = getWriteClient(ctx);
	if (!client) {
		return c.json({error: "WORKFLOWY_API_KEY environment variable is required"}, 500);
	}

	const id = resolveNodeId(ctx, c.req.param("id"));
	if (!id) {
		return c.json({error: "Node not found"}, 404);
	}

	const {cacheService} = ctx;
	// Verify the node exists before attempting to uncomplete
	const existingNode = cacheService.getNode(id);
	if (!existingNode) {
		return c.json({error: "Node not found"}, 404);
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

// POST /api/v1/nodes/:id/move - Move a node to an exact `index` under a parent (omitted = bottom)
nodesRouter.post("/:id/move", async (c) => {
	const ctx = c.get("ctx");
	const client = getWriteClient(ctx);
	if (!client) {
		return c.json({error: "WORKFLOWY_API_KEY environment variable is required"}, 500);
	}

	const id = resolveNodeId(ctx, c.req.param("id"));
	if (id === null || !ctx.cacheService.getNode(id)) {
		return c.json({error: "Node not found"}, 404);
	}
	const body = await c.req.json<{
		parent_id?: string | null;
		index?: number;
		/** Legacy: negative = top, anything else = bottom. */
		position?: number;
	}>();
	return moveNodes(c, client, [id], body.parent_id, body.index, body.position);
});

// POST /api/v1/nodes/:id/restore - Bring back a deleted node under its ORIGINAL id
nodesRouter.post("/:id/restore", async (c) => {
	const ctx = c.get("ctx");
	const adapter = getAdapter(ctx);
	if (!adapter) {
		return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	}

	const id = c.req.param("id");
	if (ctx.cacheService.getNode(id)) {
		return c.json({error: "Node is not deleted"}, 409);
	}
	const body = await c.req.json<{parent_id?: string | null; index?: number}>().catch(() => ({}) as const);
	const input: RestoreInput = {id};
	if ("parent_id" in body && body.parent_id !== undefined) {
		const parent = parseParent(ctx, body.parent_id);
		if (!parent.ok) {
			return c.json({error: parent.error}, parent.status);
		}
		input.parentId = adapterParent(parent.parentId);
	}
	if ("index" in body && body.index !== undefined) {
		const slot = parseIndex(body.index, undefined);
		if (!slot.ok) {
			return c.json({error: slot.error}, 400);
		}
		input.index = slot.index;
	}

	await adapter.restore(input);
	const node = await readNodeDto(ctx, id);
	if (node === undefined) {
		return c.json({error: `Restored node ${id} is missing from the cache`}, 500);
	}
	return c.json({node});
});

/**
 * Move `ids` (in that order, all cached) under `rawParent` at a slot, then
 * answer `{nodes}`: the refreshed children of every affected parent. Through
 * the internal API this is one exact-index push; without it only the two ends
 * work (a top block moves last-first so it keeps its order), and any other
 * slot answers 503.
 */
async function moveNodes(
	c: Context<AppEnv>,
	client: WorkflowyWriteThroughClient,
	ids: string[],
	rawParent: unknown,
	rawIndex: unknown,
	legacyPosition: unknown,
) {
	const ctx = c.get("ctx");
	const parent = parseParent(ctx, rawParent);
	if (!parent.ok) {
		return c.json({error: parent.error}, parent.status);
	}
	const {parentId} = parent;
	const slot = parseIndex(rawIndex, legacyPosition);
	if (!slot.ok) {
		return c.json({error: slot.error}, 400);
	}
	const oldParents = ids.map((id) => ctx.cacheService.getNode(id)?.parentId ?? null);
	const count = countChildren(ctx, parentId);

	const adapter = getAdapter(ctx);
	if (adapter) {
		await adapter.moveTo({ids, parentId: adapterParent(parentId), index: slot.index ?? count});
	} else {
		const end = publicEnd(slot.index, count);
		if (end === undefined) {
			return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
		}
		for (const id of end === "top" ? ids.toReversed() : ids) {
			await client.moveNode(id, parentId, publicMovePosition(end));
		}
	}

	return c.json({nodes: await readSiblingDtos(ctx, [...oldParents, parentId])});
}
