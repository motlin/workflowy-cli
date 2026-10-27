import {WorkflowyApiClient} from "@workflowy/shared/api";
import type {
	BacklinkCrumb,
	BacklinksResponse,
	CalendarInfo,
	FoundDatesResponse,
	NodeAttachment,
	NodeResponse,
	OutlineViewList,
	OutlineViewResponse,
	SaveEffects,
	TableMetadata,
	UpdateNodeResponse,
} from "../../node-types.js";
import {
	NodeReader,
	NodeTreeReader,
	WorkflowyWriteThroughClient,
	effectiveCompletedAt,
	planBlockSlot,
} from "@workflowy/shared/cache";
import type {ExactMover, SlotPlan} from "@workflowy/shared/cache";
import {MAX_COPY_ITEMS, copySubtree} from "../copy-tree.js";
import {planSwapOrigin} from "../../swap-origin.js";
import {mirrors as mirrorsTable, nodeContent, nodeInternalMetadata, nodeMetadata, s3Files} from "@workflowy/shared/db";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import type {RestoreInput, WorkflowyInternalAdapter, NewTree} from "@workflowy/shared/internal";
import {linkedSourcesInSubtree} from "@workflowy/shared/internal";
import type {Node} from "@workflowy/shared/types";
import {HOME_TARGET} from "@workflowy/shared/types";
import {internalLinkShortIds, isShortId, parseVirtualShortId} from "@workflowy/shared/workflowy";
import {and, eq, inArray, sql} from "drizzle-orm";
import {Hono} from "hono";
import {z} from "zod";
import type {Context} from "hono";
import {
	backlinksNeedSync,
	backlinkTargetsOfSource,
	childFlags,
	currentBacklinkSources,
	findReferencesRoot,
	notReferencesRoot,
	referencesRootLabel,
} from "../backlinks.js";
import {loadCalendarInfo} from "../calendar-day.js";
import {findFoundDates, timesDiffer} from "../calendar-found.js";
import type {AppEnv, ServerContext} from "../context.js";
import type {MirrorInstance} from "../../mirror-path.js";
import {childInstance, expansionId} from "../../mirror-path.js";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api.js";

/**
 * Resolve an ID parameter that could be a short ID (12 hex chars) or a full UUID.
 * Returns the full UUID, or null if a short ID couldn't be resolved.
 */
export function resolveNodeId(ctx: ServerContext, id: string): string | null {
	// A row inside a mirror (`v_<child12>_<mirror12>[_<path>]`) names the original child it shows.
	const virtual = parseVirtualShortId(id);
	if (virtual !== null) {
		return ctx.cacheService.resolveShortIdToUuid(virtual.nodeShortId);
	}
	if (!isShortId(id)) {
		return id;
	}
	return ctx.cacheService.resolveShortIdToUuid(id);
}

/**
 * What saving `name`/`note` over `before` (the text source's cached text) changes beyond the node itself: the
 * nodes a link was added to or removed from, and whether its `<time>` dates moved. The client refetches only those.
 */
function saveEffects(
	ctx: ServerContext,
	before: {name: string | null; note?: string | null} | undefined,
	name: string | undefined,
	note: string | undefined,
): SaveEffects {
	const beforeText = `${before?.name ?? ""} ${before?.note ?? ""}`;
	const afterText = `${name ?? before?.name ?? ""} ${note ?? before?.note ?? ""}`;
	const beforeLinks = new Set(internalLinkShortIds(beforeText));
	const afterLinks = new Set(internalLinkShortIds(afterText));
	const changed = [
		...[...beforeLinks].filter((id) => !afterLinks.has(id)),
		...[...afterLinks].filter((id) => !beforeLinks.has(id)),
	];
	return {
		backlinkTargets: changed.flatMap((id) => resolveNodeId(ctx, id) ?? []),
		dates: timesDiffer(beforeText, afterText),
	};
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
 * REST response. The child flags and the mirror name/note fallback
 * are derived per-request and supplied by the caller.
 */
function nodeToRestDto(
	node: Node,
	derived: {
		hasChildren: boolean;
		hasUncompletedChildren: boolean;
		hasMirrors?: boolean;
		name: string | null;
		note: string | null;
		attachment?: NodeAttachment | null;
		metadata?: InternalMetadataFields;
		calendar?: CalendarInfo;
	},
): NodeResponse {
	return {
		id: node.id,
		parent_id: node.parentId,
		name: derived.name,
		note: derived.note,
		priority: node.priority,
		data: {layoutMode: node.layoutMode},
		numberedStart: derived.metadata?.numberedStart ?? null,
		createdAt: toUnixSeconds(node.createdAt),
		modifiedAt: toUnixSeconds(node.modifiedAt),
		completedAt: toUnixSeconds(node.completedAt),
		hasChildren: derived.hasChildren,
		hasUncompletedChildren: derived.hasUncompletedChildren,
		isMirror: node.mirror.isMirror,
		hasMirrors: derived.hasMirrors ?? false,
		originalNodeId: node.mirror.originalNodeId,
		attachment: derived.attachment ?? null,
		defaultToBottom: derived.metadata?.defaultToBottom ?? false,
		calendar: derived.calendar ?? null,
		table: derived.metadata?.table ?? null,
	};
}

/**
 * Load file-attachment metadata for a batch of node IDs from the `s3_files`
 * cache table. Returns a map from node ID to its attachment; nodes without an
 * attachment are absent from the map. `isDeleted` is normalized to a boolean —
 * the column stores 1/0/NULL, and anything other than 1 means "not deleted".
 */
export function loadAttachments(ctx: ServerContext, nodeIds: string[]): Map<string, NodeAttachment> {
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
			imageOriginalPixels: s3Files.imageOriginalPixels,
			isAnimatedGif: s3Files.isAnimatedGif,
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
			imageOriginalPixels: row.imageOriginalPixels,
			isAnimatedGif: row.isAnimatedGif === 1,
			isDeleted: row.isDeleted === 1,
		});
	}
	return map;
}

/** `json_extract` returns an object as JSON text; anything but a JSON object is no table metadata. */
function parseTableMetadata(raw: unknown): TableMetadata | null {
	if (typeof raw !== "string") {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** The node DTO fields read from the cached internal metadata. */
interface InternalMetadataFields {
	numberedStart: number | null;
	defaultToBottom: boolean;
	table: TableMetadata | null;
}

/**
 * Load each node's `numbered_start` (the first number of a numbered list) and
 * `priority.defaultToBottom` from the cached internal metadata; nodes without
 * metadata are absent from the map.
 */
function loadInternalMetadataFields(ctx: ServerContext, nodeIds: string[]): Map<string, InternalMetadataFields> {
	const map = new Map<string, InternalMetadataFields>();
	if (nodeIds.length === 0) {
		return map;
	}
	const rows = ctx.db
		.select({
			nodeId: nodeInternalMetadata.nodeId,
			numberedStart: sql<unknown>`json_extract(${nodeInternalMetadata.metadataJson}, '$.numbered_start')`,
			defaultToBottom: sql<unknown>`json_extract(${nodeInternalMetadata.metadataJson}, '$.priority.defaultToBottom')`,
			table: sql<unknown>`json_extract(${nodeInternalMetadata.metadataJson}, '$.table')`,
		})
		.from(nodeInternalMetadata)
		.where(inArray(nodeInternalMetadata.nodeId, nodeIds))
		.all();
	for (const row of rows) {
		map.set(row.nodeId, {
			numberedStart: typeof row.numberedStart === "number" ? row.numberedStart : null,
			// SQLite's json_extract returns a JSON true as 1.
			defaultToBottom: row.defaultToBottom === 1,
			table: parseTableMetadata(row.table),
		});
	}
	return map;
}

/**
 * Build the write-through client from the context, or undefined when no API key
 * is configured (read-only mode).
 */
function getApiClient(ctx: ServerContext): WorkflowyApiClient | undefined {
	return ctx.apiKey ? new WorkflowyApiClient(ctx.apiKey, undefined, ctx.config.apiUrl) : undefined;
}

function getWriteClient(ctx: ServerContext): WorkflowyWriteThroughClient | undefined {
	const apiClient = getApiClient(ctx);
	if (!apiClient) {
		return undefined;
	}
	// With the internal API, a mirror-delete promotion is one exact-index move instead of a sibling rotation.
	const adapter = getAdapter(ctx);
	const exactMover: ExactMover | undefined = adapter && {
		moveTo: async ({ids, parentId, index}) => adapter.moveTo({ids, parentId: adapterParent(parentId), index}),
	};
	return new WorkflowyWriteThroughClient(apiClient, ctx.cacheService, exactMover);
}

/**
 * The internal-API adapter for exact-index tree writes, or undefined when the
 * internal API (or the public API key its write-through refresh needs) is not
 * configured.
 */
function getAdapter(ctx: ServerContext): WorkflowyInternalAdapter | undefined {
	return ctx.apiKey ? ctx.internalAdapter?.() : undefined;
}

/** Which of `ids` are originals with at least one live mirror: one query for the whole list. */
function originalsWithMirrors(ctx: ServerContext, ids: string[]): Set<string> {
	if (ids.length === 0) {
		return new Set();
	}
	const rows = ctx.db
		.selectDistinct({originalId: mirrorsTable.originalId})
		.from(mirrorsTable)
		.where(and(inArray(mirrorsTable.originalId, ids), eq(mirrorsTable.systemTo, FAR_FUTURE_DATE)))
		.all();
	return new Set(rows.map((row) => row.originalId));
}

/** A node as the REST API returns it, read from the cache; undefined when it is not cached. */
export async function readNodeDto(ctx: ServerContext, id: string): Promise<NodeResponse | undefined> {
	// NodeTreeReader gives a mirror its original's name and note, and sets mirror flags.
	const [node] = await new NodeTreeReader(ctx.cacheService).readNodes([id], {depth: 0});
	if (node === undefined) {
		return undefined;
	}
	const flags = childFlags(ctx.db, [node.mirror.originalNodeId ?? id]);
	const attachment = loadAttachments(ctx, [id]).get(id) ?? null;
	const metadata = loadInternalMetadataFields(ctx, [id]).get(id);
	const calendar = loadCalendarInfo({db: ctx.db, cache: ctx.cacheService}, [node]).get(id);
	const label = referencesRootLabel(ctx.db, id);
	const dto = nodeToRestDto(node, {
		hasMirrors: !node.mirror.isMirror && originalsWithMirrors(ctx, [id]).has(id),
		hasChildren: flags.withChildren.size > 0,
		hasUncompletedChildren: flags.withUncompletedChildren.size > 0,
		name: node.name,
		note: node.note,
		attachment,
		metadata,
		calendar,
	});
	return label === null ? dto : {...dto, isReferencesRoot: true, backlinksLabel: label};
}

/** A parent's children (Home's for `null`) as the REST API returns them, read from the cache. */
async function readChildDtos(ctx: ServerContext, parentId: string | null): Promise<NodeResponse[]> {
	// NodeTreeReader gives each mirror its original's name and note. A references
	// root is never a row: its backlinks render as the parent's Backlinks section.
	// Neither is an `ai.inChat` item (upstream's "AI Messages" mailbox).
	const nodes = (await new NodeTreeReader(ctx.cacheService).readChildren(parentId, {depth: 0})).filter(
		(node) => !node.hasReferencesRoot && !node.inChat,
	);
	// Determine which nodes have children (single query for efficiency)
	const flags = childFlags(
		ctx.db,
		nodes.map((node) => node.mirror.originalNodeId ?? node.id),
	);
	const mirrored = originalsWithMirrors(
		ctx,
		nodes.map((node) => node.id),
	);
	// Batch-load file attachments for all returned nodes.
	const attachments = loadAttachments(
		ctx,
		nodes.map((node) => node.id),
	);
	const metadata = loadInternalMetadataFields(
		ctx,
		nodes.map((node) => node.id),
	);
	const calendar = loadCalendarInfo({db: ctx.db, cache: ctx.cacheService}, nodes);
	return nodes.map((node) =>
		nodeToRestDto(node, {
			hasMirrors: !node.mirror.isMirror && mirrored.has(node.id),
			hasChildren: flags.withChildren.has(node.mirror.originalNodeId ?? node.id),
			hasUncompletedChildren: flags.withUncompletedChildren.has(node.mirror.originalNodeId ?? node.id),
			name: node.name,
			note: node.note,
			attachment: attachments.get(node.id) ?? null,
			metadata: metadata.get(node.id),
			calendar: calendar.get(node.id),
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

function childIds(ctx: ServerContext, parentId: string | null): string[] {
	return ctx.cacheService.getChildren(parentId).map((child) => child.id);
}

function countChildren(ctx: ServerContext, parentId: string | null): number {
	return ctx.cacheService.getChildren(parentId).length;
}

/** A client-generated node id: a lowercase UUID, as upstream's own clients mint. */
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

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

// POST /api/v1/nodes/children - The children of many parents in one round trip, keyed by the requested id. A
// mirror lists its original's children; an unresolvable short id is left out. Spares the client one GET per expanded row.
nodesRouter.post("/children", async (c) => {
	const ctx = c.get("ctx");
	const body = await c.req.json<{parentIds?: unknown}>();
	const {parentIds} = body;
	if (!Array.isArray(parentIds) || !parentIds.every((id) => typeof id === "string")) {
		return c.json({error: "parentIds must be an array of strings"}, 400);
	}
	const entries = await Promise.all(
		[...new Set(parentIds)].map(async (requested) => {
			const resolved = resolveNodeId(ctx, requested);
			return resolved === null
				? undefined
				: ([requested, await readChildDtos(ctx, resolveMirrorToOriginal(ctx, resolved))] as const);
		}),
	);
	return c.json({children: Object.fromEntries(entries.filter((entry) => entry !== undefined))});
});

// POST /api/v1/nodes/view - Everything an outline view under `rootId` first renders, in one round trip: the root's
// children and, depth-first in document order, those of every expanded row the row budget reaches, each with its
// Backlinks section (Home has none). Spares the client one children request per depth level and one backlinks GET
// per expanded row, so a zoom swaps in the whole expanded view at once; a day page's view carries its Found Dates too.
// `expandedIds: null` expands the account's expanded rows (none without the internal API) and answers which of the
// listed rows those are, so the page load's first view need not wait on the client fetching the account's whole
// expanded set.
const ViewSchema = z.object({
	rootId: z.string().nullable(),
	expandedIds: z.array(z.string()).nullable(),
	limit: z.number().int().nonnegative(),
	showCompleted: z.boolean(),
});

nodesRouter.post("/view", async (c) => {
	const ctx = c.get("ctx");
	const body = ViewSchema.safeParse(await c.req.json().catch(() => {}));
	if (!body.success) {
		return c.json({error: "body must be {rootId, expandedIds, limit, showCompleted}"}, 400);
	}
	const {rootId, limit, showCompleted} = body.data;
	const resolvedRoot = rootId === null ? null : resolveNodeId(ctx, rootId);
	if (rootId !== null && resolvedRoot === null) {
		return c.json({error: "Node not found"}, 404);
	}
	const isExpanded = await viewExpansionTest(ctx, body.data.expandedIds);
	const lists: OutlineViewList[] = [];
	let used = 0;
	// A parent's list is sent once however often it repeats, and a cyclical mirror instance is not expanded.
	const listed = new Set<string | null>();
	const visit = async (
		parentId: string | null,
		resolved: string | null,
		instance: MirrorInstance | null,
	): Promise<void> => {
		const nodes = await readChildDtos(ctx, resolved === null ? null : resolveMirrorToOriginal(ctx, resolved));
		if (!listed.has(parentId)) {
			listed.add(parentId);
			lists.push({parentId, nodes, backlinks: resolved === null ? null : await readBacklinks(ctx, resolved)});
		}
		for (const node of nodes) {
			if (used >= limit) {
				return;
			}
			if (!showCompleted && node.completedAt !== null) {
				continue;
			}
			used += 1;
			if (isExpanded(expansionId(node.id, instance))) {
				await visit(node.id, node.id, childInstance(node, instance));
			}
		}
	};
	await visit(rootId, resolvedRoot, null);
	const rootNode = resolvedRoot === null ? undefined : ctx.cacheService.getNode(resolvedRoot);
	const foundDates = rootNode === undefined ? null : await readFoundDates(ctx, rootNode);
	const response: OutlineViewResponse = {
		lists,
		...(body.data.expandedIds === null
			? {expandedIds: lists.flatMap((list) => list.nodes.map((node) => node.id).filter(isExpanded))}
			: {}),
		...(foundDates === null ? {} : {foundDates}),
	};
	return c.json(response);
});

/** The requested expanded ids, or for null the account's expansion (nothing without the internal API). */
async function viewExpansionTest(ctx: ServerContext, expandedIds: string[] | null): Promise<(id: string) => boolean> {
	if (expandedIds !== null) {
		const ids = new Set(expandedIds);
		return (id) => ids.has(id);
	}
	const adapter = ctx.internalAdapter?.();
	return adapter === undefined ? () => false : adapter.expansionTest();
}

/** Fetch a node missing from the cache through the write-through client, cache it with its parent chain, and read it. */
async function readUncachedNodeLive(ctx: ServerContext, id: string): Promise<NodeResponse | undefined> {
	const client = getWriteClient(ctx);
	if (client === undefined) {
		return undefined;
	}
	try {
		const live = await client.liveNode(id);
		const parentId = live.parent_id ?? null;
		if (parentId === null) {
			ctx.cacheService.insertNode(live, null);
		} else {
			await client.refreshChain([parentId]);
		}
	} catch {
		return undefined;
	}
	return readNodeDto(ctx, id);
}

// GET /api/v1/nodes/:id - Get single node (accepts UUID or short ID)
nodesRouter.get("/:id", async (c) => {
	const ctx = c.get("ctx");
	const rawId = c.req.param("id");
	const id = resolveNodeId(ctx, rawId);
	if (!id) {
		return c.json({error: "Node not found"}, 404);
	}

	let nodeResponse = await readNodeDto(ctx, id);
	// A full uuid the cache lacks (a pasted link, a backlink to a node made elsewhere) is read live and cached with
	// its parent chain. The API cannot resolve short ids, so those stay cache-only; a real 404 stays a 404.
	if (nodeResponse === undefined && id === rawId && !isShortId(rawId)) {
		nodeResponse = await readUncachedNodeLive(ctx, id);
	}
	if (nodeResponse === undefined) {
		return c.json({error: "Node not found"}, 404);
	}

	// Wrap in { node: ... } to match Workflowy API format
	return c.json({node: nodeResponse});
});

const MAX_BULK_NODES = 10_000;

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

/** One node of `POST /export-tree`: the raw stored text and the fields the export formatters read. */
interface ExportTreeItem {
	id: string;
	name: string;
	note: string;
	layoutMode: string | null;
	numberedStart: number | null;
	completed: boolean;
	children: ExportTreeItem[];
}

/**
 * `ids` and everything below them as export items. A mirror takes its original's text and children, and a mirror
 * inside its own original's subtree stops there. Completed descendants are dropped unless `includeCompleted`;
 * the roots always stay.
 */
async function readExportTree(ctx: ServerContext, ids: string[], includeCompleted: boolean): Promise<ExportTreeItem[]> {
	const reader = new NodeTreeReader(ctx.cacheService);
	const toItems = async (nodes: Node[], path: ReadonlySet<string>): Promise<ExportTreeItem[]> => {
		const metadata = loadInternalMetadataFields(
			ctx,
			nodes.map((node) => node.id),
		);
		const items: ExportTreeItem[] = [];
		for (const node of nodes) {
			const fetchId = node.mirror.originalNodeId ?? node.id;
			const below = new Set([...path, fetchId]);
			const children = path.has(fetchId)
				? []
				: (await reader.readChildren(fetchId, {depth: 0})).filter(
						(child) =>
							!child.hasReferencesRoot &&
							!child.inChat &&
							(includeCompleted || child.completedAt === null),
					);
			items.push({
				id: node.id,
				name: node.name ?? "",
				note: node.note ?? "",
				layoutMode: node.layoutMode,
				numberedStart: metadata.get(node.id)?.numberedStart ?? null,
				completed: node.completedAt !== null,
				children: await toItems(children, below),
			});
		}
		return items;
	};
	return toItems(await reader.readNodes(ids, {depth: 0}), new Set());
}

// POST /api/v1/nodes/export-tree - The subtrees the export dialog formats, in one round trip
nodesRouter.post("/export-tree", async (c) => {
	const ctx = c.get("ctx");
	const body = await c.req.json<{ids?: unknown; includeCompleted?: unknown}>();
	const {ids} = body;
	if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
		return c.json({error: "ids must be an array of strings"}, 400);
	}
	const resolved = ids.flatMap((id) => resolveNodeId(ctx, id) ?? []);
	return c.json({items: await readExportTree(ctx, resolved, body.includeCompleted === true)});
});

// POST /api/v1/nodes/trees - Create many trees at one slot with a single bulk_create
nodesRouter.post("/trees", async (c) => {
	const ctx = c.get("ctx");
	const body = await c.req.json<{parent_id?: string | null; index?: number; after_id?: unknown; trees?: unknown}>();
	const parent = parseParent(ctx, body.parent_id);
	if (!parent.ok) {
		return c.json({error: parent.error}, parent.status);
	}
	const slot = parseIndex(body.index, undefined);
	if (!slot.ok) {
		return c.json({error: slot.error}, 400);
	}
	const afterId = body.after_id;
	if (afterId !== undefined && afterId !== null && typeof afterId !== "string") {
		return c.json({error: "after_id must be a node id or null"}, 400);
	}
	const count = {total: 0};
	const trees = parseBulkTrees(body.trees, count);
	if (typeof trees === "string") {
		return c.json({error: trees}, 400);
	}
	if (count.total > MAX_BULK_NODES) {
		return c.json({error: `Too many nodes: ${count.total} (max ${MAX_BULK_NODES})`}, 400);
	}
	const adapter = getAdapter(ctx);
	if (!adapter) {
		return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	}
	const {ids} = await adapter.createTreesAt({
		parentId: adapterParent(parent.parentId),
		...(slot.index === undefined ? {} : {index: slot.index}),
		...(afterId === undefined ? {} : {afterId}),
		trees,
	});
	return c.json({ids}, 201);
});

// POST /api/v1/nodes/duplicate - Deep-copy items to consecutive slots of a parent, with one bulk_create
nodesRouter.post("/duplicate", async (c) => {
	const ctx = c.get("ctx");
	const body = await c.req.json<{ids?: unknown; parent_id?: unknown; index?: unknown}>();
	if (!Array.isArray(body.ids) || body.ids.length === 0 || !body.ids.every((id) => typeof id === "string")) {
		return c.json({error: "ids must be a non-empty array of node ids"}, 400);
	}
	const parent = parseParent(ctx, body.parent_id);
	if (!parent.ok) {
		return c.json({error: parent.error}, parent.status);
	}
	const slot = parseIndex(body.index, undefined);
	if (!slot.ok) {
		return c.json({error: slot.error}, 400);
	}
	const adapter = getAdapter(ctx);
	if (!adapter) {
		return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	}
	const trees: NewTree[] = [];
	const sourceToNew = new Map<string, string>();
	for (const raw of body.ids) {
		const resolved = resolveNodeId(ctx, raw);
		if (resolved === null) {
			return c.json({error: `Node not found: ${raw}`}, 404);
		}
		// A mirror duplicates its original's content, with the mirror's own expansion.
		const sourceId = resolveMirrorToOriginal(ctx, resolved);
		const copied = await copySubtree(ctx.cacheService, sourceId, {
			rootCompleted: (ctx.cacheService.getNode(sourceId)?.completedAt ?? null) !== null,
			mirrorOriginals: false,
			originalsWithMirrors: (ids) => originalsWithMirrors(ctx, ids),
		});
		if (copied === undefined) {
			return c.json({error: `Node not found: ${raw}`}, 404);
		}
		if (!copied.ok) {
			return c.json({error: `Too many nodes: ${copied.count} (max ${MAX_COPY_ITEMS})`}, 400);
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
	return c.json({ids}, 201);
});

// POST /api/v1/nodes/mirror - Mirror items under a parent, in order at consecutive indexes
nodesRouter.post("/mirror", async (c) => {
	const ctx = c.get("ctx");
	const body = await c.req.json<{item_ids?: unknown; parent_id?: unknown; index?: unknown}>();
	if (
		!Array.isArray(body.item_ids) ||
		body.item_ids.length === 0 ||
		!body.item_ids.every((id) => typeof id === "string")
	) {
		return c.json({error: "item_ids must be a non-empty array of node ids"}, 400);
	}
	const parent = parseParent(ctx, body.parent_id);
	if (!parent.ok) {
		return c.json({error: parent.error}, parent.status);
	}
	const slot = parseIndex(body.index, undefined);
	if (!slot.ok) {
		return c.json({error: slot.error}, 400);
	}
	const originals: string[] = [];
	const sourceRows: string[] = [];
	for (const raw of body.item_ids) {
		if (raw === "None" || raw === "" || raw === HOME_TARGET) {
			return c.json({error: "Cannot mirror Home"}, 400);
		}
		const resolved = resolveNodeId(ctx, raw);
		if (resolved === null) {
			return c.json({error: `Node not found: ${raw}`}, 404);
		}
		sourceRows.push(resolved);
		originals.push(resolveMirrorToOriginal(ctx, resolved));
	}
	// A mirror parent writes into its original's child list.
	const parentId = parent.parentId === null ? null : resolveMirrorToOriginal(ctx, parent.parentId);
	// The parent and each of its ancestors, which no source may be.
	const lineage = new Set<string>();
	for (let current = parentId; current !== null; current = ctx.cacheService.getNode(current)?.parentId ?? null) {
		lineage.add(current);
	}
	if (originals.some((id) => lineage.has(id))) {
		return c.json({error: "Cannot mirror an item into itself"}, 400);
	}
	const adapter = getAdapter(ctx);
	if (!adapter) {
		return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	}
	const {mirrors} = await adapter.createMirrorsAt({
		originalIds: originals,
		parentId: adapterParent(parentId),
		index: slot.index ?? countChildren(ctx, parentId),
	});
	const mirrorIds = mirrors.map((mirror) => mirror.mirrorId);
	// A new mirror opens like its source row (upstream `mirrorProjectTree`: `expanded: source.isExpanded`).
	const isExpanded = await adapter.expansionTest();
	const opened = Object.fromEntries(
		mirrorIds.flatMap((mirrorId, offset) =>
			isExpanded(sourceRows[offset] ?? "") ? [[mirrorId, true] as const] : [],
		),
	);
	if (Object.keys(opened).length > 0) {
		await adapter.setExpanded(opened);
	}
	const nodes = (await Promise.all(mirrorIds.map(async (id) => readNodeDto(ctx, id)))).filter(
		(node): node is NodeResponse => node !== undefined,
	);
	return c.json({nodes}, 201);
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

// POST /api/v1/nodes/move - Move a block of nodes, in the given order, to an exact `index`.
// `index` is a slot among ALL of the target parent's current children in order, the moved
// nodes included (counted before removal): the block lands right before the child now at
// `index`; omitted or >= the child count = bottom. Same contract as `MoveToInput.index`.
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

/** One descendant row of `GET /:id/subtree-ids`; `parentId` is the row it renders under (a mirror, not its original). */
interface SubtreeItem {
	id: string;
	parentId: string | null;
	completed: boolean;
	hasChildren: boolean;
}

/** Every current node's parent and completion in sibling order, plus each mirror's original, in two queries. */
function readTreeShape(ctx: ServerContext) {
	const rows = ctx.db
		.select({
			id: nodeContent.id,
			parentId: nodeContent.parentId,
			completedAt: effectiveCompletedAt(nodeContent.id, nodeMetadata.completedAt),
		})
		.from(nodeContent)
		.leftJoin(
			nodeMetadata,
			and(eq(nodeMetadata.nodeId, nodeContent.id), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)),
		)
		.where(and(eq(nodeContent.systemTo, FAR_FUTURE_DATE), notReferencesRoot()))
		.orderBy(nodeMetadata.priority, nodeMetadata.createdAt)
		.all();
	const children = new Map<string | null, {id: string; completed: boolean}[]>();
	for (const row of rows) {
		const siblings = children.get(row.parentId) ?? [];
		siblings.push({id: row.id, completed: row.completedAt !== null});
		children.set(row.parentId, siblings);
	}
	const originals = new Map(
		ctx.db
			.select({mirrorId: mirrorsTable.mirrorId, originalId: mirrorsTable.originalId})
			.from(mirrorsTable)
			.where(eq(mirrorsTable.systemTo, FAR_FUTURE_DATE))
			.all()
			.map((row) => [row.mirrorId, row.originalId]),
	);
	return {children, originals};
}

/** Every cached descendant of `rootId` (Home's tree for null) in depth-first outline order. */
function readSubtreeItems(ctx: ServerContext, rootId: string | null): SubtreeItem[] {
	const {children, originals} = readTreeShape(ctx);
	const items: SubtreeItem[] = [];
	// `path` holds the originals on the way down, so a mirror inside its own original's subtree stops there.
	const walk = (parentId: string | null, childrenOf: string | null, path: ReadonlySet<string>) => {
		for (const child of children.get(childrenOf) ?? []) {
			const original = originals.get(child.id) ?? child.id;
			const hasChildren = children.has(original);
			items.push({id: child.id, parentId, completed: child.completed, hasChildren});
			if (hasChildren && !path.has(original)) {
				walk(child.id, original, new Set([...path, original]));
			}
		}
	};
	const rootOriginal = rootId === null ? null : (originals.get(rootId) ?? rootId);
	walk(rootId, rootOriginal, new Set(rootOriginal === null ? [] : [rootOriginal]));
	return items;
}

// GET /api/v1/nodes/:id/subtree-ids - Every cached descendant of the node ("home" = the whole tree), for Expand/Collapse all
nodesRouter.get("/:id/subtree-ids", (c) => {
	const ctx = c.get("ctx");
	const rawId = c.req.param("id");
	if (rawId === HOME_TARGET) {
		return c.json({items: readSubtreeItems(ctx, null)});
	}
	const id = resolveNodeId(ctx, rawId);
	if (id === null || ctx.cacheService.getNode(id) === undefined) {
		return c.json({error: "Node not found"}, 404);
	}
	return c.json({items: readSubtreeItems(ctx, id)});
});

// GET /api/v1/nodes/:id/ancestors - Get all ancestors from root to node
nodesRouter.get("/:id/ancestors", (c) => {
	const ctx = c.get("ctx");
	const rawId = c.req.param("id");
	const id = resolveNodeId(ctx, rawId);
	if (!id) {
		return c.json({error: "Node not found"}, 404);
	}

	const reader = new NodeReader(ctx.db);

	// Build ancestor chain by following parent_id pointers
	type Chain = NonNullable<ReturnType<NodeReader["getById"]>>[];
	const chainTo = (nodeId: string): Chain => {
		const links: Chain = [];
		let currentId: string | null = nodeId;
		while (currentId !== null) {
			const node = reader.getById(currentId);
			if (!node) {
				break;
			}
			links.unshift(node);
			currentId = node.parentId;
		}
		return links;
	};
	let chain = chainTo(id);

	// A row inside a mirror (`v_<child12>_<mirror12>[_<path>]`): the mirror's ancestors and the mirror, then the rows
	// below its original down to the row.
	const virtual = parseVirtualShortId(rawId);
	const mirrorId = virtual === null ? null : ctx.cacheService.resolveShortIdToUuid(virtual.mirrorShortId);
	const originalId = mirrorId === null ? null : ctx.cacheService.getMirrorOriginal(mirrorId);
	if (mirrorId !== null && originalId !== null) {
		const originalIndex = chain.findIndex((node) => node.id === originalId);
		if (originalIndex !== -1) {
			chain = [...chainTo(mirrorId), ...chain.slice(originalIndex + 1)];
		}
	}

	// A day page reads the calendar root's settings (Friendly day names) from its ancestors.
	const calendar = loadCalendarInfo({db: ctx.db, cache: ctx.cacheService}, chain);
	const ancestors: NodeResponse[] = chain.map((node) => ({
		...nodeToRestDto(node, {
			hasChildren: true,
			hasUncompletedChildren: true,
			// A references root reads "N Backlinks", never "Untitled" (upstream `displayLabel`).
			name: referencesRootLabel(ctx.db, node.id) ?? node.name,
			note: node.note,
			calendar: calendar.get(node.id),
		}),
		isMirror: false,
		originalNodeId: null,
	}));

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
	return c.json(await readBacklinks(ctx, id));
});

/** The Backlinks section of the resolved node `id` (a mirror shows its original's). */
async function readBacklinks(ctx: ServerContext, id: string): Promise<BacklinksResponse> {
	const {db} = ctx;
	const rootId = findReferencesRoot(db, resolveMirrorToOriginal(ctx, id));
	if (rootId === null) {
		return {rootId: null, items: []};
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
	const flags = childFlags(db, sourceIds);
	const reader = new NodeReader(db);

	const crumbsOf = (sourceId: string): BacklinkCrumb[] => {
		const crumbs: BacklinkCrumb[] = [];
		let currentId = reader.getById(sourceId)?.parentId ?? null;
		while (currentId !== null) {
			const ancestor = reader.getById(currentId);
			if (!ancestor) {
				break;
			}
			crumbs.unshift({id: ancestor.id, name: referencesRootLabel(db, ancestor.id) ?? ancestor.name ?? ""});
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
							hasChildren: flags.withChildren.has(sourceId),
							hasUncompletedChildren: flags.withUncompletedChildren.has(sourceId),
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
	return body;
}

// GET /api/v1/nodes/:id/found-dates - A day page's Found Dates section: the nodes
// elsewhere whose <time> covers the day, each as a mirror row of itself with its crumbs.
nodesRouter.get("/:id/found-dates", async (c) => {
	const ctx = c.get("ctx");
	const id = resolveNodeId(ctx, c.req.param("id"));
	const node = id === null ? undefined : ctx.cacheService.getNode(id);
	if (!node) {
		return c.json({error: "Node not found"}, 404);
	}
	return c.json((await readFoundDates(ctx, node)) ?? {items: []});
});

/** `node`'s Found Dates section when it is a day page, else null. */
async function readFoundDates(ctx: ServerContext, node: Node): Promise<FoundDatesResponse | null> {
	const deps = {db: ctx.db, cache: ctx.cacheService};
	const calendar = loadCalendarInfo(deps, [node]).get(node.id);
	if (calendar?.level !== "day") {
		return null;
	}
	const found = calendar.dateId === null ? [] : findFoundDates(deps, node.id, calendar.dateId);
	const ids = found.map((item) => item.id);
	const trees = new Map(
		(await new NodeTreeReader(ctx.cacheService).readNodes(ids, {depth: 0})).map((tree) => [tree.id, tree]),
	);
	const flags = childFlags(ctx.db, ids);
	return {
		items: found.flatMap(({id: foundId, crumbs}) => {
			const tree = trees.get(foundId);
			return tree
				? [
						{
							node: {
								...nodeToRestDto(tree, {
									hasChildren: flags.withChildren.has(foundId),
									hasUncompletedChildren: flags.withUncompletedChildren.has(foundId),
									name: tree.name,
									note: tree.note,
								}),
								isMirror: true,
								originalNodeId: foundId,
							},
							crumbs,
						},
					]
				: [];
		}),
	};
}

/** Open each copy whose source row is expanded (upstream `syncWith`); `rootSource` overrides the top copy's source row. */
async function openCopies(
	adapter: WorkflowyInternalAdapter,
	sourceToNew: ReadonlyMap<string, string>,
	rootSource?: {original: string; row: string},
): Promise<void> {
	const isExpanded = await adapter.expansionTest();
	const opened: Record<string, boolean> = {};
	for (const [sourceId, copyId] of sourceToNew) {
		const row = sourceId === rootSource?.original ? rootSource.row : sourceId;
		if (isExpanded(row)) {
			opened[copyId] = true;
		}
	}
	if (Object.keys(opened).length > 0) {
		await adapter.setExpanded(opened);
	}
}

const DETACH_TOO_BIG = `Detaching mirror subtrees containing more than ${MAX_COPY_ITEMS} items is not supported.`;

// POST /api/v1/nodes/:id/detach-mirror - Replace a mirror root (a mirror, or an original that has mirrors) with a copy
nodesRouter.post("/:id/detach-mirror", async (c) => {
	const ctx = c.get("ctx");
	const client = getWriteClient(ctx);
	const adapter = getAdapter(ctx);
	if (!client || !adapter) {
		return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	}
	const id = resolveNodeId(ctx, c.req.param("id"));
	const node = id === null ? undefined : ctx.cacheService.getNode(id);
	if (id === null || node === undefined) {
		return c.json({error: "Node not found"}, 404);
	}
	const originalId = resolveMirrorToOriginal(ctx, id);
	const isOriginal = originalId === id;
	if (isOriginal && !originalsWithMirrors(ctx, [id]).has(id)) {
		return c.json({error: "Node is not a mirror"}, 400);
	}
	// A mirror has no completion of its own, so its copy is open; an original keeps its own.
	const copied = await copySubtree(ctx.cacheService, originalId, {
		rootCompleted: isOriginal && (node.completedAt ?? null) !== null,
		mirrorOriginals: true,
		originalsWithMirrors: (ids) => originalsWithMirrors(ctx, ids),
	});
	if (copied === undefined) {
		return c.json({error: "Node not found"}, 404);
	}
	if (!copied.ok) {
		return c.json({error: DETACH_TOO_BIG}, 400);
	}
	const index = Math.max(
		ctx.cacheService.getChildren(node.parentId).findIndex((sibling) => sibling.id === id),
		0,
	);
	const {ids} = await adapter.createTreesAt({
		parentId: adapterParent(node.parentId),
		index,
		trees: [copied.tree],
	});
	await openCopies(adapter, copied.sourceToNew, {original: originalId, row: id});
	await client.deleteNode(id);
	const [copyId] = ids;
	const copy = copyId === undefined ? undefined : await readNodeDto(ctx, copyId);
	return c.json({node: copy ?? null}, 201);
});

// POST /api/v1/nodes/:id/swap-mirror-origin - Make a mirror the origin: it and its original exchange slots
nodesRouter.post("/:id/swap-mirror-origin", async (c) => {
	const ctx = c.get("ctx");
	const adapter = getAdapter(ctx);
	if (!adapter) {
		return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	}
	const id = resolveNodeId(ctx, c.req.param("id"));
	const node = id === null ? undefined : ctx.cacheService.getNode(id);
	if (id === null || node === undefined) {
		return c.json({error: "Node not found"}, 404);
	}
	const originalId = resolveMirrorToOriginal(ctx, id);
	if (originalId === id) {
		if (originalsWithMirrors(ctx, [id]).has(id)) {
			return c.json({warning: "This item is already the origin."});
		}
		return c.json({error: "Node is not a mirror"}, 400);
	}
	const original = ctx.cacheService.getNode(originalId);
	if (original === undefined) {
		return c.json({error: "Original not found"}, 404);
	}
	// The original would land inside its own subtree.
	for (let current = node.parentId; current !== null; current = ctx.cacheService.getNode(current)?.parentId ?? null) {
		if (current === originalId) {
			return c.json({error: "Cannot swap a mirror that sits inside its own original"}, 400);
		}
	}
	const orders = new Map<string | null, string[]>(
		[node.parentId, original.parentId].map((parentId) => [
			parentId,
			ctx.cacheService.getChildren(parentId).map((child) => child.id),
		]),
	);
	const moves = planSwapOrigin(orders, {id, parentId: node.parentId}, {id: originalId, parentId: original.parentId});
	for (const move of moves) {
		await adapter.moveTo({ids: [move.id], parentId: adapterParent(move.parentId), index: move.index});
	}
	return c.json({swapped: {mirrorId: id, originalId}});
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

// POST /api/v1/nodes/:id/move - Move a node to an exact `index` under a parent (omitted = bottom).
// `index` counts the moved node when it stays under the same parent (slot before removal):
// among a,b,c,d, moving b below c is `index: 3`, not 2. Same contract as `MoveToInput.index`.
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

	return c.json({nodes: await readSiblingDtos(ctx, [...oldParents, parentId])});
}

export const homeRouter = new Hono<AppEnv>();

// GET /api/v1/home - Home's layoutMode, read from the root metadata ("bullets" when unset)
homeRouter.get("/", async (c) => {
	const adapter = getAdapter(c.get("ctx"));
	if (!adapter) {
		return c.json({error: INTERNAL_API_NOT_CONFIGURED}, 503);
	}
	const layoutMode = await adapter.getRootMeta(["layoutMode"]);
	return c.json({layoutMode: typeof layoutMode === "string" ? layoutMode : "bullets"});
});
