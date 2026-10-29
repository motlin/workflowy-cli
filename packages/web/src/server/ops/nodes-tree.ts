import {z} from "zod";
import {planBlockSlot} from "@workflowy/shared/cache";
import type {WorkflowyWriteThroughClient} from "@workflowy/shared/cache";
import type {NewTree} from "@workflowy/shared/internal";
import {MAX_COPY_ITEMS, copySubtree} from "../copy-tree.js";
import type {ServerContext} from "../context.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";
import {defineOp, fail, ok, toJson} from "./define.js";
import {CreatedIdsSchema, NodeListSchema} from "./schemas.js";
import type {OpResult} from "./define.js";
import type {BulkTree} from "../../node-types.js";
import {
	adapterParent,
	childIds,
	countChildren,
	getAdapter,
	getWriteClient,
	openCopies,
	originalsWithMirrors,
	AfterIdSchema,
	IndexSchema,
	LegacyPositionSchema,
	NodeIdsSchema,
	ParentIdSchema,
	parseParent,
	slotIndex,
	publicEnd,
	publicMovePosition,
	readSiblingDtos,
	resolveMirrorToOriginal,
	resolveNodeId,
} from "./nodes-shared.js";

const MAX_BULK_NODES = 10_000;

const WRITE_CLIENT_REQUIRED = "WORKFLOWY_API_KEY environment variable is required";

const BulkTreeSchema: z.ZodType<BulkTree> = z.lazy(() =>
	z.object({
		name: z.string(),
		note: z.string().optional(),
		completed: z.boolean().optional(),
		layoutMode: z.string().optional(),
		numberedStart: z.number().int().optional(),
		children: z.array(BulkTreeSchema).optional(),
	}),
);

/** How many nodes the trees hold, descendants included. */
function countTrees(trees: BulkTree[]): number {
	return trees.reduce((total, tree) => total + 1 + countTrees(tree.children ?? []), 0);
}

/** The request trees as the adapter's `NewTree`s. */
function toNewTrees(trees: BulkTree[]): NewTree[] {
	return trees.map((tree) => {
		const children = toNewTrees(tree.children ?? []);
		const metadata: Record<string, unknown> = {
			...(tree.layoutMode === undefined ? {} : {layoutMode: tree.layoutMode}),
			...(tree.numberedStart === undefined ? {} : {numbered_start: tree.numberedStart}),
		};
		return {
			name: tree.name,
			...(tree.note === undefined ? {} : {note: tree.note}),
			...(tree.completed === true ? {completed: true} : {}),
			...(Object.keys(metadata).length === 0 ? {} : {metadata}),
			...(children.length === 0 ? {} : {children}),
		};
	});
}

// POST /api/v1/nodes/trees - Create many trees at one slot with a single bulk_create
export const nodesTrees = defineOp({
	input: z.object({
		parent_id: ParentIdSchema,
		index: IndexSchema,
		after_id: AfterIdSchema,
		trees: z.array(BulkTreeSchema),
	}),
	output: CreatedIdsSchema,
	async run(ctx, body) {
		const parent = parseParent(ctx, body.parent_id);
		if (!parent.ok) {
			return fail(parent.status, {error: parent.error});
		}
		const total = countTrees(body.trees);
		if (total > MAX_BULK_NODES) {
			return fail(400, {error: `Too many nodes: ${total} (max ${MAX_BULK_NODES})`});
		}
		const adapter = getAdapter(ctx);
		if (!adapter) {
			return fail(503, {error: INTERNAL_API_NOT_CONFIGURED});
		}
		const {ids} = await adapter.createTreesAt({
			parentId: adapterParent(parent.parentId),
			...(body.index === undefined ? {} : {index: body.index}),
			...(body.after_id === undefined ? {} : {afterId: body.after_id}),
			trees: toNewTrees(body.trees),
		});
		return ok({ids}, {created: true});
	},
});

// POST /api/v1/nodes/duplicate - Deep-copy items to consecutive slots of a parent, with one bulk_create
export const nodesDuplicate = defineOp({
	input: z.object({ids: NodeIdsSchema, parent_id: ParentIdSchema, index: IndexSchema}),
	output: CreatedIdsSchema,
	async run(ctx, body) {
		const parent = parseParent(ctx, body.parent_id);
		if (!parent.ok) {
			return fail(parent.status, {error: parent.error});
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
			...(body.index === undefined ? {} : {index: body.index}),
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
	rawParent: string | null,
	index: number | undefined,
): Promise<OpResult<z.output<typeof NodeListSchema>>> {
	const parent = parseParent(ctx, rawParent);
	if (!parent.ok) {
		return fail(parent.status, {error: parent.error});
	}
	const {parentId} = parent;
	const oldParents = ids.map((id) => ctx.cacheService.getNode(id)?.parentId ?? null);
	const count = countChildren(ctx, parentId);

	const adapter = getAdapter(ctx);
	if (adapter) {
		await adapter.moveTo({
			ids,
			parentId: adapterParent(parentId),
			...(index === undefined ? {} : {index}),
		});
	} else {
		const end = publicEnd(index, count);
		if (end === undefined) {
			// A middle slot counts every child before removal; the rotation counts the others.
			const order = childIds(ctx, parentId);
			const moving = new Set(ids);
			const othersBefore = order.slice(0, index ?? order.length).filter((id) => !moving.has(id)).length;
			const {position, siblingIds} = planBlockSlot(order, ids, othersBefore);
			for (const id of [...(position === "top" ? ids.toReversed() : ids), ...siblingIds]) {
				await client.moveNode(id, parentId, publicMovePosition(position));
			}
		} else {
			for (const id of end === "top" ? ids.toReversed() : ids) {
				await client.moveNode(id, parentId, publicMovePosition(end));
			}
		}
	}

	return ok(toJson({nodes: readSiblingDtos(ctx, [...oldParents, parentId])}));
}

// POST /api/v1/nodes/move - Move a block of nodes, in the given order, to an exact `index`.
// `index` is a slot among ALL of the target parent's current children in order, the moved
// nodes included (counted before removal): the block lands right before the child now at
// `index`; omitted or >= the child count = bottom. Same contract as `MoveToInput.index`.
export const nodesMove = defineOp({
	input: z.object({ids: NodeIdsSchema, parent_id: ParentIdSchema, index: IndexSchema}),
	output: NodeListSchema,
	async run(ctx, body) {
		const client = getWriteClient(ctx);
		if (!client) {
			return fail(500, {error: WRITE_CLIENT_REQUIRED});
		}
		const ids: string[] = [];
		for (const rawId of body.ids) {
			const id = resolveNodeId(ctx, rawId);
			if (id === null || !ctx.cacheService.getNode(id)) {
				return fail(404, {error: `Node not found: ${rawId}`});
			}
			ids.push(id);
		}
		return moveNodes(ctx, client, ids, body.parent_id, body.index);
	},
});

// POST /api/v1/nodes/:id/move - Move a node to an exact `index` under a parent (omitted = bottom).
// `index` counts the moved node when it stays under the same parent (slot before removal):
// among a,b,c,d, moving b below c is `index: 3`, not 2. Same contract as `MoveToInput.index`.
export const nodesMoveOne = defineOp({
	input: z.object({
		id: z.string(),
		parent_id: ParentIdSchema,
		index: IndexSchema,
		position: LegacyPositionSchema,
	}),
	output: NodeListSchema,
	async run(ctx, body) {
		const client = getWriteClient(ctx);
		if (!client) {
			return fail(500, {error: WRITE_CLIENT_REQUIRED});
		}
		const id = resolveNodeId(ctx, body.id);
		if (id === null || !ctx.cacheService.getNode(id)) {
			return fail(404, {error: "Node not found"});
		}
		return moveNodes(ctx, client, [id], body.parent_id, slotIndex(body.index, body.position));
	},
});
