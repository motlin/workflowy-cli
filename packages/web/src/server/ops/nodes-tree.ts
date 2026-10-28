import {z} from "zod";
import {planBlockSlot} from "@workflowy/shared/cache";
import type {WorkflowyWriteThroughClient} from "@workflowy/shared/cache";
import type {NewTree} from "@workflowy/shared/internal";
import {MAX_COPY_ITEMS, copySubtree} from "../copy-tree.js";
import type {ServerContext} from "../context.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";
import {defineOp, fail, jsonOf, ok} from "./define.js";
import type {Json, OpResult} from "./define.js";
import {
	adapterParent,
	childIds,
	countChildren,
	getAdapter,
	getWriteClient,
	openCopies,
	originalsWithMirrors,
	parseIndex,
	parseParent,
	publicEnd,
	publicMovePosition,
	readSiblingDtos,
	resolveMirrorToOriginal,
	resolveNodeId,
} from "./nodes-shared.js";

const MAX_BULK_NODES = 10_000;

const WRITE_CLIENT_REQUIRED = "WORKFLOWY_API_KEY environment variable is required";

interface BulkTreeBody {
	name: string;
	note?: unknown;
	completed?: unknown;
	layoutMode?: unknown;
	numberedStart?: unknown;
	children?: unknown;
}

function isBulkTreeBody(value: unknown): value is BulkTreeBody {
	return typeof value === "object" && value !== null && typeof (value as {name?: unknown}).name === "string";
}

/** Validate and convert the request trees; the count accumulates the total nodes seen. */
function parseBulkTrees(raw: unknown, count: {total: number}): NewTree[] | string {
	if (!Array.isArray(raw)) {
		return "trees must be an array";
	}
	const trees: NewTree[] = [];
	for (const entry of raw as unknown[]) {
		count.total += 1;
		if (!isBulkTreeBody(entry)) {
			return "each tree needs a string name";
		}
		const item = entry;
		const children = item.children === undefined ? undefined : parseBulkTrees(item.children, count);
		if (typeof children === "string") {
			return children;
		}
		const metadata: Record<string, unknown> = {};
		if (typeof item.layoutMode === "string") {
			metadata.layoutMode = item.layoutMode;
		}
		if (typeof item.numberedStart === "number") {
			metadata.numbered_start = item.numberedStart;
		}
		trees.push({
			name: item.name,
			...(typeof item.note === "string" ? {note: item.note} : {}),
			...(item.completed === true ? {completed: true} : {}),
			...(Object.keys(metadata).length === 0 ? {} : {metadata}),
			...(children === undefined || children.length === 0 ? {} : {children}),
		});
	}
	return trees;
}

// POST /api/v1/nodes/trees - Create many trees at one slot with a single bulk_create
export const nodesTrees = defineOp({
	input: z.object({
		parent_id: z.unknown().optional(),
		index: z.unknown().optional(),
		after_id: z.unknown().optional(),
		trees: z.unknown().optional(),
	}),
	async run(ctx, body) {
		const parent = parseParent(ctx, body.parent_id);
		if (!parent.ok) {
			return fail(parent.status, {error: parent.error});
		}
		const slot = parseIndex(body.index, undefined);
		if (!slot.ok) {
			return fail(400, {error: slot.error});
		}
		const afterId = body.after_id;
		if (afterId !== undefined && afterId !== null && typeof afterId !== "string") {
			return fail(400, {error: "after_id must be a node id or null"});
		}
		const count = {total: 0};
		const trees = parseBulkTrees(body.trees, count);
		if (typeof trees === "string") {
			return fail(400, {error: trees});
		}
		if (count.total > MAX_BULK_NODES) {
			return fail(400, {error: `Too many nodes: ${count.total} (max ${MAX_BULK_NODES})`});
		}
		const adapter = getAdapter(ctx);
		if (!adapter) {
			return fail(503, {error: INTERNAL_API_NOT_CONFIGURED});
		}
		const {ids} = await adapter.createTreesAt({
			parentId: adapterParent(parent.parentId),
			...(slot.index === undefined ? {} : {index: slot.index}),
			...(afterId === undefined ? {} : {afterId}),
			trees,
		});
		return ok({ids}, {created: true});
	},
});

// POST /api/v1/nodes/duplicate - Deep-copy items to consecutive slots of a parent, with one bulk_create
export const nodesDuplicate = defineOp({
	input: z.object({ids: z.unknown().optional(), parent_id: z.unknown().optional(), index: z.unknown().optional()}),
	async run(ctx, body) {
		if (!Array.isArray(body.ids) || body.ids.length === 0 || !body.ids.every((id) => typeof id === "string")) {
			return fail(400, {error: "ids must be a non-empty array of node ids"});
		}
		const parent = parseParent(ctx, body.parent_id);
		if (!parent.ok) {
			return fail(parent.status, {error: parent.error});
		}
		const slot = parseIndex(body.index, undefined);
		if (!slot.ok) {
			return fail(400, {error: slot.error});
		}
		const adapter = getAdapter(ctx);
		if (!adapter) {
			return fail(503, {error: INTERNAL_API_NOT_CONFIGURED});
		}
		const trees: NewTree[] = [];
		const sourceToNew = new Map<string, string>();
		for (const raw of body.ids) {
			const resolved = resolveNodeId(ctx, raw);
			if (resolved === null) {
				return fail(404, {error: `Node not found: ${raw}`});
			}
			// A mirror duplicates its original's content, with the mirror's own expansion.
			const sourceId = resolveMirrorToOriginal(ctx, resolved);
			const copied = await copySubtree(ctx.cacheService, sourceId, {
				rootCompleted: (ctx.cacheService.getNode(sourceId)?.completedAt ?? null) !== null,
				mirrorOriginals: false,
				originalsWithMirrors: (ids) => originalsWithMirrors(ctx, ids),
			});
			if (copied === undefined) {
				return fail(404, {error: `Node not found: ${raw}`});
			}
			if (!copied.ok) {
				return fail(400, {error: `Too many nodes: ${copied.count} (max ${MAX_COPY_ITEMS})`});
			}
			trees.push(copied.tree);
			for (const [source, copy] of copied.sourceToNew) {
				sourceToNew.set(source === sourceId ? resolved : source, copy);
			}
		}
		const {ids} = await adapter.createTreesAt({
			parentId: adapterParent(parent.parentId),
			...(slot.index === undefined ? {} : {index: slot.index}),
			trees,
		});
		await openCopies(adapter, sourceToNew);
		return ok({ids}, {created: true});
	},
});

/**
 * Move `ids` (in that order, all cached) under `rawParent` at a slot, then
 * answer `{nodes}`: the refreshed children of every affected parent. Through
 * the internal API this is one exact-index push; without it only the two ends
 * work (a top block moves last-first so it keeps its order), and any other
 * slot answers 503.
 */
async function moveNodes(
	ctx: ServerContext,
	client: WorkflowyWriteThroughClient,
	ids: string[],
	rawParent: unknown,
	rawIndex: unknown,
	legacyPosition: unknown,
): Promise<OpResult<Json>> {
	const parent = parseParent(ctx, rawParent);
	if (!parent.ok) {
		return fail(parent.status, {error: parent.error});
	}
	const {parentId} = parent;
	const slot = parseIndex(rawIndex, legacyPosition);
	if (!slot.ok) {
		return fail(400, {error: slot.error});
	}
	const oldParents = ids.map((id) => ctx.cacheService.getNode(id)?.parentId ?? null);
	const count = countChildren(ctx, parentId);

	const adapter = getAdapter(ctx);
	if (adapter) {
		await adapter.moveTo({
			ids,
			parentId: adapterParent(parentId),
			...(slot.index === undefined ? {} : {index: slot.index}),
		});
	} else {
		const end = publicEnd(slot.index, count);
		if (end === undefined) {
			// A middle slot counts every child before removal; the rotation counts the others.
			const order = childIds(ctx, parentId);
			const moving = new Set(ids);
			const slotIndex = order.slice(0, slot.index ?? order.length).filter((id) => !moving.has(id)).length;
			const {position, siblingIds} = planBlockSlot(order, ids, slotIndex);
			for (const id of [...(position === "top" ? ids.toReversed() : ids), ...siblingIds]) {
				await client.moveNode(id, parentId, publicMovePosition(position));
			}
		} else {
			for (const id of end === "top" ? ids.toReversed() : ids) {
				await client.moveNode(id, parentId, publicMovePosition(end));
			}
		}
	}

	return ok(jsonOf({nodes: readSiblingDtos(ctx, [...oldParents, parentId])}));
}

// POST /api/v1/nodes/move - Move a block of nodes, in the given order, to an exact `index`.
// `index` is a slot among ALL of the target parent's current children in order, the moved
// nodes included (counted before removal): the block lands right before the child now at
// `index`; omitted or >= the child count = bottom. Same contract as `MoveToInput.index`.
export const nodesMove = defineOp({
	input: z.object({ids: z.unknown().optional(), parent_id: z.unknown().optional(), index: z.unknown().optional()}),
	async run(ctx, body) {
		const client = getWriteClient(ctx);
		if (!client) {
			return fail(500, {error: WRITE_CLIENT_REQUIRED});
		}
		if (
			!Array.isArray(body.ids) ||
			body.ids.length === 0 ||
			!body.ids.every((id): id is string => typeof id === "string")
		) {
			return fail(400, {error: "ids must be a non-empty array of strings"});
		}
		const ids: string[] = [];
		for (const rawId of body.ids) {
			const id = resolveNodeId(ctx, rawId);
			if (id === null || !ctx.cacheService.getNode(id)) {
				return fail(404, {error: `Node not found: ${rawId}`});
			}
			ids.push(id);
		}
		return moveNodes(ctx, client, ids, body.parent_id, body.index, undefined);
	},
});

// POST /api/v1/nodes/:id/move - Move a node to an exact `index` under a parent (omitted = bottom).
// `index` counts the moved node when it stays under the same parent (slot before removal):
// among a,b,c,d, moving b below c is `index: 3`, not 2. Same contract as `MoveToInput.index`.
export const nodesMoveOne = defineOp({
	input: z.object({
		id: z.string(),
		parent_id: z.unknown().optional(),
		index: z.unknown().optional(),
		/** Legacy: negative = top, anything else = bottom. */
		position: z.unknown().optional(),
	}),
	async run(ctx, body) {
		const client = getWriteClient(ctx);
		if (!client) {
			return fail(500, {error: WRITE_CLIENT_REQUIRED});
		}
		const id = resolveNodeId(ctx, body.id);
		if (id === null || !ctx.cacheService.getNode(id)) {
			return fail(404, {error: "Node not found"});
		}
		return moveNodes(ctx, client, [id], body.parent_id, body.index, body.position);
	},
});
