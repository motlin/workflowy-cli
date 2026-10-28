import {WorkflowyApiClient} from "@workflowy/shared/api";
import type {
	BacklinkCrumb,
	BacklinksResponse,
	CalendarInfo,
	FoundDatesResponse,
	NodeChangesResponse,
	NodeAttachment,
	NodeResponse,
	OutlineViewList,
	OutlineViewResponse,
	SaveEffects,
	TableMetadata,
	UpdateNodeResponse,
} from "../../node-types.js";
import {NodeReader, NodeTreeReader, planBlockSlot} from "@workflowy/shared/cache";
import type {ExactMover, SlotPlan, WorkflowyWriteThroughClient} from "@workflowy/shared/cache";
import {MAX_COPY_ITEMS} from "../copy-tree.js";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import type {RestoreInput, WorkflowyInternalAdapter, NewTree} from "@workflowy/shared/internal";
import {linkedSourcesInSubtree} from "@workflowy/shared/internal";
import type {Node} from "@workflowy/shared/types";
import {HOME_TARGET} from "@workflowy/shared/types";
import {Hono} from "hono";
import {backlinksNeedSync, backlinkTargetsOfSource} from "../backlinks.js";
import type {AppEnv, ServerContext} from "../context.js";
import type {MirrorInstance} from "../../mirror-path.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";
import {
	resolveNodeId,
	saveEffects,
	InternalMetadataFields,
	getApiClient,
	getWriteClient,
	getAdapter,
	readNodeDto,
	ParentResult,
	parseParent,
	IndexResult,
	parseIndex,
	adapterParent,
	publicEnd,
	publicMovePosition,
	childIds,
	countChildren,
} from "../ops/nodes-shared.js";

const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const nodesRouter = new Hono<AppEnv>();

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
		/**
		 * The sibling the client saw right above the new node (null: first). While it is still a sibling it decides
		 * the slot over `index`, which counts the client's possibly stale list.
		 */
		after_id?: unknown;
		/**
		 * A client-generated lowercase UUID for the new node, so the client can edit the
		 * optimistic row before this reply. Honored through the internal API only; the
		 * public-API fallback assigns its own id (the reply carries the real one).
		 */
		id?: unknown;
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
	if (body.id !== undefined && (typeof body.id !== "string" || !CLIENT_ID_PATTERN.test(body.id))) {
		return c.json({error: "id must be a lowercase UUID"}, 400);
	}
	const afterId = body.after_id;
	if (afterId !== undefined && afterId !== null && typeof afterId !== "string") {
		return c.json({error: "after_id must be a node id or null"}, 400);
	}
	if (typeof body.id === "string" && ctx.cacheService.getNode(body.id)) {
		return c.json({error: `Node already exists: ${body.id}`}, 409);
	}
	const count = countChildren(ctx, parentId);

	const adapter = getAdapter(ctx);
	if (adapter) {
		const {id} = await adapter.createAt({
			parentId: adapterParent(parentId),
			...(slot.index === undefined ? {} : {index: slot.index}),
			...(afterId === undefined || slot.index === undefined ? {} : {afterId}),
			name,
			...(typeof body.id === "string" ? {id: body.id} : {}),
			...(note === undefined ? {} : {note}),
			...(layoutMode === undefined ? {} : {metadata: {layoutMode}}),
		});
		const node = await readNodeDto(ctx, id);
		if (node === undefined) {
			return c.json({error: `Created node ${id} is missing from the cache`}, 500);
		}
		return c.json({node}, 201);
	}

	// Without the internal API a middle slot is the nearer end plus a rotation of the siblings on the shorter side.
	const end = publicEnd(slot.index, count);
	const rotation: SlotPlan =
		end === undefined
			? planBlockSlot(childIds(ctx, parentId), [], slot.index ?? count)
			: {position: end, siblingIds: []};
	const createdNode = await client.createNode({
		parent_id: parentId ?? HOME_TARGET,
		name,
		note,
		layoutMode,
		position: rotation.position,
	});
	for (const siblingId of rotation.siblingIds) {
		await client.moveNode(siblingId, parentId, publicMovePosition(rotation.position));
	}

	// Return in Workflowy response format
	const nodeResponse: NodeResponse = {
		id: createdNode.id,
		parent_id: parentId,
		name: createdNode.name,
		note: createdNode.note ?? null,
		priority: createdNode.priority,
		data: {layoutMode: createdNode.data?.layoutMode ?? null},
		numberedStart: null,
		createdAt: createdNode.createdAt,
		modifiedAt: createdNode.modifiedAt,
		completedAt: createdNode.completedAt ?? null,
		hasChildren: true,
		hasUncompletedChildren: true,
		isMirror: false,
		originalNodeId: null,
		attachment: null,
		defaultToBottom: false,
		calendar: null,
		table: null,
	};

	return c.json({node: nodeResponse}, 201);
});

/** Upstream offers only these layouts at Home. */
const HOME_LAYOUT_MODES = new Set(["bullets", "board"]);

/** A `layoutMode` as a metadata value: `"bullets"` is upstream's default, stored as no key. */
function layoutModeValue(layoutMode: string): string | undefined {
	return layoutMode === "bullets" ? undefined : layoutMode;
}

/** A `tableSet` body as metadata changes, or undefined when it is malformed or writes outside `table`. */
function parseTableSet(raw: unknown): {path: string[]; value: unknown}[] | undefined {
	if (!Array.isArray(raw)) {
		return undefined;
	}
	const changes: {path: string[]; value: unknown}[] = [];
	for (const entry of raw as unknown[]) {
		if (typeof entry !== "object" || entry === null) {
			return undefined;
		}
		const {path, value} = entry as {path?: unknown; value?: unknown};
		if (
			!Array.isArray(path) ||
			path.length === 0 ||
			path[0] !== "table" ||
			!path.every((part) => typeof part === "string")
		) {
			return undefined;
		}
		changes.push({path: path, value});
	}
	return changes;
}

// PATCH (or POST) /api/v1/nodes/home - Set Home's layoutMode through the root metadata
nodesRouter.on(["PATCH", "POST"], `/${HOME_TARGET}`, async (c) => {
	const ctx = c.get("ctx");
	const body = await c.req.json<Record<string, unknown>>();
	const {layoutMode} = body;
	if (typeof layoutMode !== "string" || Object.keys(body).some((key) => key !== "layoutMode")) {
		return c.json({error: "Home accepts only layoutMode"}, 400);
	}
	if (!HOME_LAYOUT_MODES.has(layoutMode)) {
		return c.json({error: "Home's layoutMode must be bullets or board"}, 400);
	}
	const adapter = getAdapter(ctx);
	if (!adapter) {
		return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	}
	await adapter.setNodeMetaValues(HOME_TARGET, [{path: ["layoutMode"], value: layoutModeValue(layoutMode)}]);
	return c.json({layoutMode});
});

// PATCH (or POST) /api/v1/nodes/:id - Update node
nodesRouter.on(["PATCH", "POST"], "/:id", async (c) => {
	const ctx = c.get("ctx");
	const client = getWriteClient(ctx);
	if (!client) {
		return c.json({error: "WORKFLOWY_API_KEY environment variable is required"}, 500);
	}

	const id = resolveNodeId(ctx, c.req.param("id"));
	if (!id) {
		return c.json({error: "Node not found"}, 404);
	}
	const {name, note, layoutMode, numberedStart, tableSet} = await c.req.json<{
		name?: string;
		note?: string;
		layoutMode?: string;
		numberedStart?: unknown;
		tableSet?: unknown;
	}>();

	// Validate that at least one field is provided
	if (
		name === undefined &&
		note === undefined &&
		layoutMode === undefined &&
		numberedStart === undefined &&
		tableSet === undefined
	) {
		return c.json({error: "At least one of name, note, layoutMode, numberedStart, or tableSet is required"}, 400);
	}
	const tableChanges = tableSet === undefined ? [] : parseTableSet(tableSet);
	if (tableChanges === undefined) {
		return c.json({error: 'tableSet must be a list of {path, value} whose path starts with "table"'}, 400);
	}
	if (numberedStart !== undefined && numberedStart !== null && !Number.isInteger(numberedStart)) {
		return c.json({error: "numberedStart must be an integer or null"}, 400);
	}

	const {cacheService} = ctx;
	// Get current node to preserve parentId and verify existence
	const existingNode = cacheService.getNode(id);
	if (!existingNode) {
		return c.json({error: "Node not found"}, 404);
	}

	// Metadata goes through the internal API as one edit when it is configured;
	// without it only layoutMode can be written (through the public API).
	const adapter = getAdapter(ctx);
	if (adapter) {
		const changes = [
			...(layoutMode === undefined ? [] : [{path: ["layoutMode"], value: layoutModeValue(layoutMode)}]),
			...(numberedStart === undefined ? [] : [{path: ["numbered_start"], value: numberedStart ?? undefined}]),
			...tableChanges,
		];
		let effects: SaveEffects = {backlinkTargets: [], dates: false};
		if (name !== undefined || note !== undefined) {
			// Text lives on a mirror's original, which is the backlink source.
			const sourceId = cacheService.getMirrorOriginal(id) ?? id;
			const before = cacheService.getNode(sourceId);
			effects = saveEffects(ctx, before, name, note);
			await client.updateNode(id, {
				...(name === undefined ? {} : {name}),
				...(note === undefined ? {} : {note}),
			});
			// Upstream's client keeps backlinks in step with a source's links; the whole-tree
			// sync runs only when a link moved or a linked target lacks its backlink.
			const beforeText = `${before?.name ?? ""} ${before?.note ?? ""}`;
			const afterText = `${name ?? before?.name ?? ""} ${note ?? before?.note ?? ""}`;
			if (backlinksNeedSync(ctx, sourceId, beforeText, afterText)) {
				const existing = backlinkTargetsOfSource(ctx.db, sourceId);
				const synced = await adapter.syncBacklinks([sourceId]);
				const touched = [
					...synced.created.map((created) => created.targetId),
					...synced.deleted.flatMap((itemId) => existing.get(itemId) ?? []),
				];
				effects = {...effects, backlinkTargets: [...new Set([...effects.backlinkTargets, ...touched])]};
			}
		}
		if (changes.length > 0) {
			await adapter.setNodeMetaValues(id, changes);
		}
		const node = await readNodeDto(ctx, id);
		if (node === undefined) {
			return c.json({error: "Node not found"}, 404);
		}
		return c.json({node, effects} satisfies UpdateNodeResponse);
	}
	if (numberedStart !== undefined || tableChanges.length > 0) {
		return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	}

	const effects = saveEffects(ctx, cacheService.getNode(cacheService.getMirrorOriginal(id) ?? id), name, note);
	const updatedNode = await client.updateNode(id, {
		...(name === undefined ? {} : {name}),
		...(note === undefined ? {} : {note}),
		...(layoutMode === undefined ? {} : {layoutMode}),
	});

	// Return in Workflowy response format
	const nodeResponse: NodeResponse = {
		id: updatedNode.id,
		parent_id: existingNode.parentId,
		name: updatedNode.name,
		note: updatedNode.note ?? null,
		priority: updatedNode.priority,
		data: {layoutMode: updatedNode.data?.layoutMode ?? null},
		numberedStart: null,
		createdAt: updatedNode.createdAt,
		modifiedAt: updatedNode.modifiedAt,
		completedAt: updatedNode.completedAt ?? null,
		hasChildren: true,
		hasUncompletedChildren: true,
		isMirror: false,
		originalNodeId: null,
		attachment: null,
		defaultToBottom: false,
		calendar: null,
		table: null,
	};

	return c.json({node: nodeResponse, effects} satisfies UpdateNodeResponse);
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

	// Upstream's client deletes a deleted source's backlink items; read the linked
	// sources before the delete drops the subtree from the cache.
	const adapter = getAdapter(ctx);
	const linked = adapter ? linkedSourcesInSubtree(ctx.db, id) : [];
	await client.deleteNode(id);
	if (adapter && linked.length > 0) {
		await adapter.deleteBacklinksOf(linked);
	}

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

	// Answer the requested row from the cache: a mirror keeps its own id and parent and
	// carries its original's completion.
	const cached = await readNodeDto(ctx, id);
	if (cached) {
		return c.json({node: cached});
	}

	// Return in Workflowy response format
	const nodeResponse: NodeResponse = {
		id: completedNode.id,
		parent_id: existingNode.parentId,
		name: completedNode.name,
		note: completedNode.note ?? null,
		priority: completedNode.priority,
		data: {layoutMode: completedNode.data?.layoutMode ?? null},
		numberedStart: null,
		createdAt: completedNode.createdAt,
		modifiedAt: completedNode.modifiedAt,
		completedAt: completedNode.completedAt ?? null,
		hasChildren: true,
		isMirror: false,
		originalNodeId: null,
		attachment: null,
		defaultToBottom: false,
		calendar: null,
		table: null,
	};

	return c.json({node: nodeResponse});
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

	// Answer the requested row from the cache: a mirror keeps its own id and parent and
	// carries its original's completion.
	const cached = await readNodeDto(ctx, id);
	if (cached) {
		return c.json({node: cached});
	}

	// Return in Workflowy response format
	const nodeResponse: NodeResponse = {
		id: uncompletedNode.id,
		parent_id: existingNode.parentId,
		name: uncompletedNode.name,
		note: uncompletedNode.note ?? null,
		priority: uncompletedNode.priority,
		data: {layoutMode: uncompletedNode.data?.layoutMode ?? null},
		numberedStart: null,
		createdAt: uncompletedNode.createdAt,
		modifiedAt: uncompletedNode.modifiedAt,
		completedAt: uncompletedNode.completedAt ?? null,
		hasChildren: true,
		hasUncompletedChildren: true,
		isMirror: false,
		originalNodeId: null,
		attachment: null,
		defaultToBottom: false,
		calendar: null,
		table: null,
	};

	return c.json({node: nodeResponse});
});

// POST /api/v1/nodes/:id/restore - Bring back a deleted node under its ORIGINAL id
nodesRouter.post("/:id/restore", async (c) => {
	const ctx = c.get("ctx");
	const adapter = getAdapter(ctx);
	const apiClient = getApiClient(ctx);
	if (!adapter || !apiClient) {
		return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	}

	const id = c.req.param("id");
	// Ask Workflowy, not the cache: a node deleted on workflowy.com lingers in a stale cache.
	if ((await apiClient.findNode(id)) !== null) {
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

	// End the stale rows (the whole cached subtree) so the restore's refresh stores only what came back.
	if (ctx.cacheService.getNode(id)) {
		ctx.cacheService.deleteNode(id);
	}
	await adapter.restore(input);
	const node = await readNodeDto(ctx, id);
	if (node === undefined) {
		return c.json({error: `Restored node ${id} is missing from the cache`}, 500);
	}
	return c.json({node});
});
