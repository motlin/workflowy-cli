import {z} from "zod";
import {planBlockSlot} from "@workflowy/shared/cache";
import type {SlotPlan} from "@workflowy/shared/cache";
import type {RestoreInput} from "@workflowy/shared/internal";
import {linkedSourcesInSubtree} from "@workflowy/shared/internal";
import {HOME_TARGET} from "@workflowy/shared/types";
import type {WorkflowyNode} from "@workflowy/shared/types";
import type {NodeResponse, SaveEffects, UpdateNodeResponse} from "../../node-types.js";
import {backlinksNeedSync, backlinkTargetsOfSource} from "../backlinks.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";
import {defineOp, fail, jsonOf, ok} from "./define.js";
import type {Json} from "./define.js";
import {
	adapterParent,
	childIds,
	countChildren,
	getAdapter,
	getApiClient,
	getWriteClient,
	parseIndex,
	parseParent,
	publicEnd,
	publicMovePosition,
	readNodeDto,
	resolveNodeId,
	saveEffects,
} from "./nodes-shared.js";

/** A text field the handler has always passed through as sent: typed for the compiler, not checked at runtime. */
const unvalidatedText = z.custom<string>(() => true).optional();

const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const WRITE_CLIENT_REQUIRED = "WORKFLOWY_API_KEY environment variable is required";

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

/** The public API's node in Workflowy response format, for a host without the cache row. */
function wireNodeResponse(node: WorkflowyNode, parentId: string | null, hasUncompletedChildren: boolean): NodeResponse {
	return {
		id: node.id,
		parent_id: parentId,
		name: node.name,
		note: node.note ?? null,
		priority: node.priority,
		data: {layoutMode: node.data?.layoutMode ?? null},
		numberedStart: null,
		createdAt: node.createdAt,
		modifiedAt: node.modifiedAt,
		completedAt: node.completedAt ?? null,
		hasChildren: true,
		...(hasUncompletedChildren ? {hasUncompletedChildren: true} : {}),
		isMirror: false,
		originalNodeId: null,
		attachment: null,
		defaultToBottom: false,
		calendar: null,
		table: null,
	};
}

// POST /api/v1/nodes - Create node at an exact `index` among all siblings (omitted = bottom)
export const nodesCreate = defineOp({
	input: z.object({
		parent_id: z.unknown().optional(),
		name: z.unknown().optional(),
		note: unvalidatedText,
		layoutMode: unvalidatedText,
		index: z.unknown().optional(),
		/** Legacy: negative = top, anything else = bottom. */
		position: z.unknown().optional(),
		/**
		 * The sibling the client saw right above the new node (null: first). While it is still a sibling it decides
		 * the slot over `index`, which counts the client's possibly stale list.
		 */
		after_id: z.unknown().optional(),
		/**
		 * A client-generated lowercase UUID for the new node, so the client can edit the
		 * optimistic row before this reply. Honored through the internal API only; the
		 * public-API fallback assigns its own id (the reply carries the real one).
		 */
		id: z.unknown().optional(),
	}),
	async run(ctx, body) {
		const client = getWriteClient(ctx);
		if (!client) {
			return fail(500, {error: WRITE_CLIENT_REQUIRED});
		}
		const {name} = body;
		const {note, layoutMode} = body;

		// An empty name is valid: every empty-row create (add button, Enter) sends `name: ""`.
		if (typeof name !== "string") {
			return fail(400, {error: "name is required"});
		}

		const parent = parseParent(ctx, body.parent_id);
		if (!parent.ok) {
			return fail(parent.status, {error: parent.error});
		}
		const {parentId} = parent;
		const slot = parseIndex(body.index, body.position);
		if (!slot.ok) {
			return fail(400, {error: slot.error});
		}
		if (body.id !== undefined && (typeof body.id !== "string" || !CLIENT_ID_PATTERN.test(body.id))) {
			return fail(400, {error: "id must be a lowercase UUID"});
		}
		const afterId = body.after_id;
		if (afterId !== undefined && afterId !== null && typeof afterId !== "string") {
			return fail(400, {error: "after_id must be a node id or null"});
		}
		if (typeof body.id === "string" && ctx.cacheService.getNode(body.id)) {
			return fail(409, {error: `Node already exists: ${body.id}`});
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
				return fail(500, {error: `Created node ${id} is missing from the cache`});
			}
			return ok(jsonOf({node}), {created: true});
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
		return ok(jsonOf({node: wireNodeResponse(createdNode, parentId, true)}), {created: true});
	},
});

// PATCH (or POST) /api/v1/nodes/home - Set Home's layoutMode through the root metadata
export const nodesSetHome = defineOp({
	input: z.record(z.string(), z.unknown()),
	async run(ctx, body) {
		const {layoutMode} = body;
		if (typeof layoutMode !== "string" || Object.keys(body).some((key) => key !== "layoutMode")) {
			return fail(400, {error: "Home accepts only layoutMode"});
		}
		if (!HOME_LAYOUT_MODES.has(layoutMode)) {
			return fail(400, {error: "Home's layoutMode must be bullets or board"});
		}
		const adapter = getAdapter(ctx);
		if (!adapter) {
			return fail(503, {error: INTERNAL_API_NOT_CONFIGURED});
		}
		await adapter.setNodeMetaValues(HOME_TARGET, [{path: ["layoutMode"], value: layoutModeValue(layoutMode)}]);
		return ok<Json>({layoutMode});
	},
});

// PATCH (or POST) /api/v1/nodes/:id - Update node
export const nodesUpdate = defineOp({
	input: z.object({
		id: z.string(),
		name: unvalidatedText,
		note: unvalidatedText,
		layoutMode: unvalidatedText,
		numberedStart: z.unknown().optional(),
		tableSet: z.unknown().optional(),
	}),
	async run(ctx, body) {
		const client = getWriteClient(ctx);
		if (!client) {
			return fail(500, {error: WRITE_CLIENT_REQUIRED});
		}

		const id = resolveNodeId(ctx, body.id);
		if (!id) {
			return fail(404, {error: "Node not found"});
		}
		const {name, note, layoutMode, numberedStart, tableSet} = body;

		// Validate that at least one field is provided
		if (
			name === undefined &&
			note === undefined &&
			layoutMode === undefined &&
			numberedStart === undefined &&
			tableSet === undefined
		) {
			return fail(400, {error: "At least one of name, note, layoutMode, numberedStart, or tableSet is required"});
		}
		const tableChanges = tableSet === undefined ? [] : parseTableSet(tableSet);
		if (tableChanges === undefined) {
			return fail(400, {error: 'tableSet must be a list of {path, value} whose path starts with "table"'});
		}
		if (numberedStart !== undefined && numberedStart !== null && !Number.isInteger(numberedStart)) {
			return fail(400, {error: "numberedStart must be an integer or null"});
		}

		const {cacheService} = ctx;
		// Get current node to preserve parentId and verify existence
		const existingNode = cacheService.getNode(id);
		if (!existingNode) {
			return fail(404, {error: "Node not found"});
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
				return fail(404, {error: "Node not found"});
			}
			return ok(jsonOf({node, effects} satisfies UpdateNodeResponse));
		}
		if (numberedStart !== undefined || tableChanges.length > 0) {
			return fail(503, {error: INTERNAL_API_NOT_CONFIGURED});
		}

		const effects = saveEffects(ctx, cacheService.getNode(cacheService.getMirrorOriginal(id) ?? id), name, note);
		const updatedNode = await client.updateNode(id, {
			...(name === undefined ? {} : {name}),
			...(note === undefined ? {} : {note}),
			...(layoutMode === undefined ? {} : {layoutMode}),
		});
		return ok(
			jsonOf({
				node: wireNodeResponse(updatedNode, existingNode.parentId, true),
				effects,
			} satisfies UpdateNodeResponse),
		);
	},
});

// DELETE /api/v1/nodes/:id - Delete node
export const nodesDelete = defineOp({
	input: z.object({id: z.string()}),
	async run(ctx, {id: rawId}) {
		const client = getWriteClient(ctx);
		if (!client) {
			return fail(500, {error: WRITE_CLIENT_REQUIRED});
		}

		const id = resolveNodeId(ctx, rawId);
		if (!id) {
			return fail(404, {error: "Node not found"});
		}

		// Verify the node exists before attempting to delete
		if (!ctx.cacheService.getNode(id)) {
			return fail(404, {error: "Node not found"});
		}

		// Upstream's client deletes a deleted source's backlink items; read the linked
		// sources before the delete drops the subtree from the cache.
		const adapter = getAdapter(ctx);
		const linked = adapter ? linkedSourcesInSubtree(ctx.db, id) : [];
		await client.deleteNode(id);
		if (adapter && linked.length > 0) {
			await adapter.deleteBacklinksOf(linked);
		}
		return ok(null);
	},
});

type CompletionOp = "complete" | "uncomplete";

/** Completes or uncompletes a row, answering it from the cache: a mirror keeps its own id and parent and carries its original's completion. */
function completionOp(operation: CompletionOp) {
	return defineOp({
		input: z.object({id: z.string()}),
		async run(ctx, {id: rawId}) {
			const client = getWriteClient(ctx);
			if (!client) {
				return fail(500, {error: WRITE_CLIENT_REQUIRED});
			}

			const id = resolveNodeId(ctx, rawId);
			if (!id) {
				return fail(404, {error: "Node not found"});
			}

			// Verify the node exists before attempting to change it
			const existingNode = ctx.cacheService.getNode(id);
			if (!existingNode) {
				return fail(404, {error: "Node not found"});
			}

			const changed = await (operation === "complete" ? client.completeNode(id) : client.uncompleteNode(id));

			const cached = await readNodeDto(ctx, id);
			if (cached) {
				return ok(jsonOf({node: cached}));
			}
			return ok(jsonOf({node: wireNodeResponse(changed, existingNode.parentId, operation === "uncomplete")}));
		},
	});
}

// POST /api/v1/nodes/:id/complete - Mark node as completed
export const nodesComplete = completionOp("complete");

// POST /api/v1/nodes/:id/uncomplete - Mark node as not completed
export const nodesUncomplete = completionOp("uncomplete");

// POST /api/v1/nodes/:id/restore - Bring back a deleted node under its ORIGINAL id
export const nodesRestore = defineOp({
	input: z.object({id: z.string(), parent_id: z.unknown().optional(), index: z.unknown().optional()}),
	async run(ctx, body) {
		const adapter = getAdapter(ctx);
		const apiClient = getApiClient(ctx);
		if (!adapter || !apiClient) {
			return fail(503, {error: INTERNAL_API_NOT_CONFIGURED});
		}

		const {id} = body;
		// Ask Workflowy, not the cache: a node deleted on workflowy.com lingers in a stale cache.
		if ((await apiClient.findNode(id)) !== null) {
			return fail(409, {error: "Node is not deleted"});
		}
		const input: RestoreInput = {id};
		if (body.parent_id !== undefined) {
			const parent = parseParent(ctx, body.parent_id);
			if (!parent.ok) {
				return fail(parent.status, {error: parent.error});
			}
			input.parentId = adapterParent(parent.parentId);
		}
		if (body.index !== undefined) {
			const slot = parseIndex(body.index, undefined);
			if (!slot.ok) {
				return fail(400, {error: slot.error});
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
			return fail(500, {error: `Restored node ${id} is missing from the cache`});
		}
		return ok(jsonOf({node}));
	},
});
