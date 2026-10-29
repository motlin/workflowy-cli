import {createHash} from "node:crypto";
import {and, eq, inArray, like} from "drizzle-orm";
import type {BaseSQLiteDatabase} from "drizzle-orm/sqlite-core";
import {z} from "zod";
import type {CreateMirrorResult} from "../api/workflowy-client.js";
import type {InternalSession, VisibleFeature, WorkflowyInternalClient} from "../api/workflowy-internal-client.js";
import type {WorkflowyWriteThroughClient} from "../cache/workflowy-write-through-client.js";
import {keptInternalMetadata} from "../cache/importer.js";
import {collectItemRelationships, emptyItemRelationships} from "../cache/item-relationships.js";
import {runUnitOfWork} from "../cache/node-composite.js";
import {applyRelationshipOps} from "../cache/relationship-log.js";
import {advanceTreeTxId, EXPANDED_KEYS_KEY, readTreeTxId} from "../cache/tree-transaction.js";
import type {ItemRelationships} from "../cache/item-relationships.js";
import {accountState, localSettings, mirrors as mirrorsTable, nodeContent, nodeInternalMetadata} from "../db/schema.js";
import {FAR_FUTURE_DATE} from "../temporal/constants.js";
import {HOME_TARGET} from "../types/targets.js";
import {hasInternalLink, internalLinkShortIds} from "../workflowy/internal-links.js";
import {uuidToShortId} from "../workflowy/constants.js";
import {upstreamExpansionKey, virtualId} from "../workflowy/virtual-id.js";
import {
	CALENDAR_LEVELS,
	DEFAULT_CALENDAR_LEVELS,
	CalendarRootMissing,
	calendarDateId,
	calendarInsertIndex,
	calendarLevelMetadata,
	calendarLevelName,
	parseDateId,
} from "./calendar-day.js";
import type {CalendarLevel} from "./calendar-day.js";
import {calendarNodeId} from "./calendar-ids.js";
import {calendarLayoutWrites, layoutWriteParents} from "./calendar-layout-apply.js";
import type {LayoutWrite} from "./calendar-layout-apply.js";
import {planCalendarLayout} from "./calendar-layout.js";
import type {CalendarLayoutLevels, LayoutNode} from "./calendar-layout.js";
import {LoggedOut, OperationRejected, TransportError, TreeNotSeeded, TreeRefreshRequired} from "./errors.js";
import {applyMetadataPatches, buildMetadataChanges} from "./metadata-patch.js";
import type {MetadataChange} from "./metadata-patch.js";
import {bulkCreateOp, bulkMoveOp, deleteOp, editOp, moveOp, ROOT_PROJECT_ID, undeleteOp} from "./ops.js";
import type {Location, NewTree} from "./ops.js";
import {PushAndPoll} from "./push-and-poll.js";
import type {InternalOp, PushAndPollOptions, PushResult} from "./push-and-poll.js";

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
type AdapterDatabase = BaseSQLiteDatabase<"sync", any, any>;

/** Cached state older than this is refreshed from the server in the background on a read. */
const FRESHNESS_MS = 30_000;
/** A `fresh` expanded-ids read waits on `/get_tree_data/` at most this often. */
const FRESH_EXPANSION_THROTTLE_MS = 5000;

/** A fresh or waiting expansion read waits on `/get_tree_data/` at most this long, then answers the cached keys. */
const FRESH_WAIT_MS = 15_000;

/** Settings the server stores; every other setting is client-only upstream. */
export type ServerSetting =
	| "show_completed"
	| "show_keyboard_shortcuts"
	| "same_color_for_links"
	| "display_image_previews_as_thumbnails"
	| "ignore_youtube"
	| "ignore_yt_short"
	| "ignore_twitter"
	| "ignore_loom"
	| "unsubscribe_from_summary_emails"
	| "unsubscribe_from_comments_emails"
	| "theme"
	| "font"
	| "saved_views_json_delta";

const FLAG_SETTINGS = new Set<ServerSetting>([
	"show_completed",
	"show_keyboard_shortcuts",
	"same_color_for_links",
	"display_image_previews_as_thumbnails",
	"ignore_youtube",
	"ignore_yt_short",
	"ignore_twitter",
	"ignore_loom",
	"unsubscribe_from_summary_emails",
	"unsubscribe_from_comments_emails",
]);

export interface Account {
	userId: number;
	joinedAt: Date;
	fullName: string | null;
}

const StoredAccountSchema = z.object({userId: z.number(), dateJoinedSec: z.number(), fullName: z.string().nullish()});
const MetadataSchema = z.record(z.string(), z.unknown());
const SucceededSchema = z.object({succeeded: z.boolean()});
const CalendarMetadataSchema = z.object({
	calendar: z
		.object({
			root: z.boolean().optional(),
			level: z.string().optional(),
			dateId: z.number().optional(),
			levels: z.record(z.string(), z.boolean()).optional(),
		})
		.loose(),
});

/** The `true`/`"yes"` entries of a `settings.features` value. */
function enabledDict(value: unknown): Record<string, true> {
	const dict: Record<string, true> = {};
	if (typeof value === "object" && value !== null) {
		for (const [name, flag] of Object.entries(value)) {
			if (flag === true || flag === "yes") {
				dict[name] = true;
			}
		}
	}
	return dict;
}

type StoredAccount = z.infer<typeof StoredAccountSchema>;
type Metadata = z.infer<typeof MetadataSchema>;

interface AccountSnapshot {
	account: StoredAccount;
	rootMetadata: Metadata;
	settings: Metadata;
	visibleFeatures: VisibleFeature[];
}

const VisibleFeaturesSchema = z.array(
	z.object({
		codename: z.string(),
		name: z.string(),
		label: z.string().nullable(),
		description: z.string().nullable(),
	}),
);

/** Codenames go into `/features/<enable|disable>/<codename>`, so only slug characters pass. */
const FEATURE_CODENAME = /^[a-z0-9_-]+$/u;

const KEYS = {
	account: "account",
	rootMetadata: "root_metadata",
	settings: "settings",
	visibleFeatures: "visible_features",
	expandedKeys: EXPANDED_KEYS_KEY,
	entropyKey: "entropy_key",
	calendarLayoutUndo: "calendar_layout_undo",
} as const;

/** The writes that undo the last applied calendar layout, with the metadata the edited and restored nodes go back to. */
const LayoutUndoSchema = z.object({
	rootId: z.string(),
	writes: z.array(z.custom<LayoutWrite>()),
	metadata: z.record(z.string(), MetadataSchema),
});

/** What `getExpansionState` reports besides the ids; see there. */
export interface ExpansionState {
	expandedIds: string[];
	fetchedAt: number;
	refreshing: boolean;
	fingerprint: string;
}

const ExpandedKeysSchema = z.array(z.string());

/** The id callers pass for Home (the root) in tree writes. */
export const HOME = HOME_TARGET;

/** Home is `null` to the public API and the cache. */
type PublicParent = string | null;

function publicParent(id: string): PublicParent {
	return id === HOME ? null : id;
}

function internalParent(parent: PublicParent): string {
	return parent ?? ROOT_PROJECT_ID;
}

/** Upstream's expansion key for a node: the first 8 chars of its id, or `v_<child4><mirror4><path>` for a mirror instance. */
const expansionKey = upstreamExpansionKey;
const KEY_CHUNK = 4;

function clampIndex(index: number, length: number): number {
	return Math.min(Math.max(Math.trunc(index), 0), length);
}

/**
 * The slot right after `afterId` among `siblingIds` (0 for null) while it is still one of them, else `index`
 * clamped: a client whose sibling list missed another client's write still lands the row below the one it saw.
 */
export function anchoredIndex(
	siblingIds: readonly string[],
	afterId: string | null | undefined,
	index: number,
): number {
	if (afterId === null) {
		return 0;
	}
	const anchor = afterId === undefined ? -1 : siblingIds.indexOf(afterId);
	return anchor === -1 ? clampIndex(index, siblingIds.length) : anchor + 1;
}

export interface CreateAtInput {
	/** The new node's id; generated when absent. */
	id?: string;
	/** A node id, or `HOME`. */
	parentId: string;
	/** 0-based slot among all siblings, completed ones included; clamped to `[0, siblings]`. Omitted = after the last live child. */
	index?: number;
	/** The sibling the new node follows (null: first); while it is a live sibling it decides the slot over `index`. */
	afterId?: string | null;
	name: string;
	note?: string;
	metadata?: Record<string, unknown>;
}

/** Every mirror root among `trees` (ids already assigned), with the original it mirrors. */
function mirrorRootsIn(trees: NewTree[]): {mirrorId: string; originId: string}[] {
	return trees.flatMap((node) => {
		const originId = getPath(node.metadata ?? {}, ["mirror", "originalId"]);
		const isRoot = getPath(node.metadata ?? {}, ["mirror", "isMirrorRoot"]) === true;
		const own =
			typeof originId === "string" && isRoot && node.id !== undefined ? [{mirrorId: node.id, originId}] : [];
		return [...own, ...mirrorRootsIn(node.children ?? [])];
	});
}

/**
 * The edge rows the nodes of `trees` (ids already assigned) carry in their
 * metadata: each one's own mirror, backlink and references-root rows. Mirror
 * rows naming a created node as someone else's original are left out, since a
 * copied `mirrorRootIds` describes the copied node, not the new one.
 */
function createdRelationships(trees: NewTree[]): ItemRelationships {
	const relationships = emptyItemRelationships();
	const created = new Set<string>();
	const collect = (nodes: NewTree[]): void => {
		for (const node of nodes) {
			if (node.id !== undefined) {
				created.add(node.id);
				collectItemRelationships(relationships, node.id, node.metadata);
			}
			collect(node.children ?? []);
		}
	};
	collect(trees);
	return {...relationships, mirrors: relationships.mirrors.filter((row) => created.has(row.mirrorId))};
}

export interface CreateTreesAtInput {
	parentId: string;
	index?: number;
	afterId?: string | null;
	trees: NewTree[];
}

export interface CreateMirrorsAtInput {
	/** The nodes to mirror, in order; a mirror resolves to its original. */
	originalIds: string[];
	/** A node id, or `HOME`. */
	parentId: string;
	/** 0-based slot of the first mirror among all siblings; clamped to `[0, siblings]`. */
	index: number;
}

export interface CreateMirrorAtInput {
	/** The node to mirror; a mirror resolves to its original. */
	originalId: string;
	/** A node id, or `HOME`. */
	parentId: string;
	/** 0-based slot among all siblings; clamped to `[0, siblings]`. */
	index: number;
}

export interface EnsuredCalendarDay {
	/** The ensured node: the day, or the month or year when `stopAt` says so. */
	dayId: string;
	/** The node's first child (the empty one created for a new or empty node), or null when `createChild` is false and it has none. */
	firstChildId: string | null;
	/** Ids created by this call, outermost first. */
	created: string[];
}

/** A calendar level node {@link WorkflowyInternalAdapter.ensureCalendarDay} creates. */
interface CalendarChainNode {
	id: string;
	name: string;
	metadata: Metadata;
}

/** What {@link WorkflowyInternalAdapter.applyCalendarLayout} (or its undo) pushed. */
export interface AppliedCalendarLayout {
	rootId: string;
	/** Tree writes pushed; 0 when the layout was already in place. */
	writes: number;
}

/** The calendar a layout is planned from: the root's subtree as the restructure walks it, and its current levels. */
export interface CalendarLayoutSnapshot {
	root: LayoutNode;
	/** The root's `calendar.levels`, or undefined for upstream's default. */
	levels: CalendarLayoutLevels | undefined;
}

/** Milliseconds per phase of {@link WorkflowyInternalAdapter.applyCalendarLayout}, summed when a phase repeats. */
export type LayoutTimings = Record<string, number>;

/** Throw unless a layout write names its target calendar root: there is no fallback to the tagged root. */
function requireRootId(rootId: string | undefined): asserts rootId is string {
	if (typeof rootId !== "string" || rootId === "") {
		throw new Error("calendar layout: rootId is required");
	}
}

/** A function recording the time since its previous call (or creation) under a phase name; a no-op without `timings`. */
function phaseTimer(timings: LayoutTimings | undefined): (phase: string) => void {
	let last = performance.now();
	return (phase) => {
		if (timings !== undefined) {
			const now = performance.now();
			timings[phase] = (timings[phase] ?? 0) + now - last;
			last = now;
		}
	};
}

/**
 * The snapshot nodes whose children the writes depend on: every parent they
 * insert into or take from, and every node they delete, which must be empty.
 * Level nodes the writes create are not in the snapshot and are left out.
 */
function layoutWriteReads(writes: LayoutWrite[], childIds: ReadonlyMap<string, string[]>): string[] {
	const reads = writes.flatMap((write) => {
		if (write.op === "create" || write.op === "undelete") {
			return [write.parentId];
		}
		if (write.op === "move") {
			return [write.from.parentId, write.parentId];
		}
		return write.op === "delete" ? [write.from.parentId, write.id] : [];
	});
	return [...new Set(reads)].filter((id) => childIds.has(id));
}

/** Each snapshot node's child ids, in order, keyed by its id. */
function layoutChildIds(root: LayoutNode): Map<string, string[]> {
	const childIds = new Map<string, string[]>();
	const visit = (node: LayoutNode): void => {
		childIds.set(
			node.id,
			node.children.map((child) => child.id),
		);
		node.children.forEach(visit);
	};
	visit(root);
	return childIds;
}

export interface MoveToInput {
	ids: string[];
	/** A node id, or `HOME`. */
	parentId: string;
	/**
	 * Insertion slot among the target's current children, moved ones included (counted
	 * BEFORE removal): the nodes land right before the child now at `index`. Among a,b,c,d,
	 * moving b below c is index 3. Clamped to `[0, children]`. The web move endpoints and
	 * client planners use this same contract. Omitted = after the last live child.
	 */
	index?: number;
}

export interface RestoreInput {
	id: string;
	/** A node id, or `HOME`. Without it the node goes back where it was deleted from. */
	parentId?: string;
	/** Slot under `parentId`; defaults to the bottom. */
	index?: number;
}

/** What {@link WorkflowyInternalAdapter.syncBacklinks} changed upstream. */
export interface BacklinkSync {
	/** Backlink items created: a mirror of `sourceId` under `targetId`'s references root. */
	created: {id: string; sourceId: string; targetId: string}[];
	/** References roots created under targets that had none. */
	referencesRoots: string[];
	/** Backlink items deleted because their source no longer links to their target. */
	deleted: string[];
}

export interface WorkflowyInternalAdapterOptions {
	client: WorkflowyInternalClient;
	db: AdapterDatabase;
	/** Defaults to `Date.now`; drives both cache freshness and op timestamps. */
	now?: () => number;
	pushAndPoll?: Omit<PushAndPollOptions, "now" | "transactionLog">;
	/** The public-API write-through client tree writes refresh the cache through; required for them. */
	writeThrough?: WorkflowyWriteThroughClient;
	/** Ids for created nodes; defaults to `crypto.randomUUID`. */
	generateId?: () => string;
}

/** Log a resync error at error level before it propagates, so a missing or stale seed never goes unnoticed. */
function loud<E extends Error>(error: E): E {
	console.error(error);
	return error;
}

function applyExpansionsDelta(keys: Set<string>, delta: Record<string, boolean>): Set<string> {
	const next = new Set(keys);
	for (const [key, expanded] of Object.entries(delta)) {
		if (expanded) {
			next.add(key);
		} else {
			next.delete(key);
		}
	}
	return next;
}

function getPath(value: unknown, path: string[]): unknown {
	let current = value;
	for (const key of path) {
		if (typeof current !== "object" || current === null || !Object.hasOwn(current, key)) {
			return undefined;
		}
		current = Reflect.get(current, key);
	}
	return current;
}

function stringKeys(value: unknown): string[] {
	return typeof value === "object" && value !== null ? Object.keys(value) : [];
}

/** A backlink item's `{sourceID, targetID}`, from its metadata. */
function backlinkOf(metadata: Metadata | undefined): {sourceID: string; targetID: string} | undefined {
	const sourceID = getPath(metadata, ["backlink", "sourceID"]);
	const targetID = getPath(metadata, ["backlink", "targetID"]);
	return typeof sourceID === "string" && typeof targetID === "string" ? {sourceID, targetID} : undefined;
}

/**
 * The cached nodes in `rootId`'s subtree (itself included) whose name or note
 * holds an internal link: the only ones that can be backlink sources. Read
 * before a delete, since the cache drops the subtree with it.
 */
export function linkedSourcesInSubtree(db: AdapterDatabase, rootId: string): string[] {
	const linked: string[] = [];
	for (let level = [rootId]; level.length > 0;) {
		const rows = db
			.select({id: nodeContent.id, name: nodeContent.name, note: nodeContent.note})
			.from(nodeContent)
			.where(and(inArray(nodeContent.id, level), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
			.all();
		linked.push(
			...rows.filter((row) => hasInternalLink(`${row.name ?? ""} ${row.note ?? ""}`)).map((row) => row.id),
		);
		level = db
			.select({id: nodeContent.id})
			.from(nodeContent)
			.where(and(inArray(nodeContent.parentId, level), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
			.all()
			.map((row) => row.id);
	}
	return linked;
}

/**
 * The internal-API write path behind a purpose-built API. It is the only
 * module that speaks in upstream ops and `/push_and_poll`; callers see account
 * state, root metadata and settings.
 *
 * Account state is cached in `account_state`; a read of state older than 30s
 * answers from the cache and refreshes it (one initialization GET) in the
 * background, so changes made on workflowy.com show up locally without
 * stalling the read.
 * The cache is written only after the server accepts a change.
 *
 * Tree writes (exact-index create and move, restore, node metadata) read the
 * affected siblings fresh through the public API, push one op, and only after
 * the push succeeds re-read every affected parent's children and replace them
 * in the node cache in one transaction.
 */
export class WorkflowyInternalAdapter {
	private readonly client: WorkflowyInternalClient;
	private readonly db: AdapterDatabase;
	private readonly now: () => number;
	private readonly pusher: PushAndPoll;
	private readonly writeThrough: WorkflowyWriteThroughClient | undefined;
	private readonly generateId: () => string;
	private expandedKeysRefresh: Promise<Set<string>> | undefined;
	private accountRefresh: Promise<void> | undefined;
	/** Bumped on every account snapshot store, so a background refresh never overwrites a newer write. */
	private accountStores = 0;
	private pushedDuringRefresh: Record<string, boolean>[] | undefined;
	/** The stored id the push in flight started from, for the refresh error. */
	private startedFrom: string | undefined;

	constructor(options: WorkflowyInternalAdapterOptions) {
		this.client = options.client;
		this.db = options.db;
		this.now = options.now ?? Date.now;
		this.pusher = new PushAndPoll(options.client, {
			...options.pushAndPoll,
			now: this.now,
			transactionLog: {
				start: () => this.startTxId(),
				accept: (result) => {
					this.acceptTransactions(result);
				},
			},
		});
		this.writeThrough = options.writeThrough;
		this.generateId = options.generateId ?? (() => crypto.randomUUID());
	}

	/**
	 * Bring the cache's edge rows up to the tree's latest transaction with one
	 * pure poll from the stored transaction id (about 279 bytes when nothing
	 * changed). Every push does the same as a side effect.
	 */
	async catchUp(): Promise<void> {
		await this.session();
		await this.pusher.pushAndPoll();
	}

	/** Where every push starts: the stored tree transaction id, or a loud error without one. */
	private startTxId(): string {
		const txId = readTreeTxId(this.db);
		if (txId === undefined) {
			throw loud(new TreeNotSeeded());
		}
		this.startedFrom = txId;
		return txId;
	}

	/**
	 * Apply an accepted push's transactions to the edge rows, oldest first, and
	 * store its id, in one unit of work. Our own server-run transaction can also
	 * come back among the remote ones, so a transaction id is applied once.
	 */
	private acceptTransactions(result: PushResult): void {
		if (result.needsRefresh) {
			throw loud(new TreeRefreshRequired(this.startedFrom ?? "unknown"));
		}
		const seen = new Set<string>();
		const ops: InternalOp[] = [];
		for (const {id, ops: transactionOps} of [
			...result.remote,
			{...(result.serverRunId === undefined ? {} : {id: result.serverRunId}), ops: result.serverRun},
		]) {
			if (id !== undefined && seen.has(id)) {
				continue;
			}
			if (id !== undefined) {
				seen.add(id);
			}
			ops.push(...transactionOps);
		}
		runUnitOfWork(this.db, (unitOfWork) => {
			applyRelationshipOps(unitOfWork, ops);
			advanceTreeTxId(unitOfWork.tx, result.txId, this.now());
		});
	}

	/** Create one node at an exact slot with a `bulk_create`; the id is chosen here, so none is read back. */
	async createAt(input: CreateAtInput): Promise<{id: string}> {
		const tree = this.tree();
		const parent = publicParent(input.parentId);
		const siblings = await tree.liveChildren(parent);
		const session = await this.session();
		const newTree: NewTree = {name: input.name};
		if (input.id !== undefined) {
			newTree.id = input.id;
		}
		if (input.note !== undefined) {
			newTree.note = input.note;
		}
		if (input.metadata !== undefined) {
			newTree.metadata = input.metadata;
		}
		const {op, ids} = bulkCreateOp({
			parentId: internalParent(parent),
			index: anchoredIndex(
				siblings.map((sibling) => sibling.id),
				input.afterId,
				input.index ?? siblings.length,
			),
			trees: [newTree],
			userId: session.userId,
			now: this.now(),
			dateJoinedSec: session.dateJoinedSec,
			generateId: this.generateId,
		});
		await this.pusher.pushAndPoll({ops: [op]});
		const [id] = ids;
		if (id === undefined) {
			throw new Error("bulk_create produced no id");
		}
		const kept = keptInternalMetadata(input.metadata);
		if (kept !== undefined) {
			this.writeNodeMetadata(id, kept);
		}
		await tree.refreshChildren([parent]);
		if (hasInternalLink(`${input.name} ${input.note ?? ""}`)) {
			await this.syncBacklinks([id]);
		}
		return {id};
	}

	/** Create N trees at one slot with a single `bulk_create`; like `createAt` but recursive. */
	async createTreesAt(input: CreateTreesAtInput): Promise<{ids: string[]}> {
		const tree = this.tree();
		const parent = publicParent(input.parentId);
		const siblings = await tree.liveChildren(parent);
		const session = await this.session();
		const withIds = (trees: NewTree[]): NewTree[] =>
			trees.map((node) => ({
				...node,
				id: node.id ?? this.generateId(),
				...(node.children === undefined ? {} : {children: withIds(node.children)}),
			}));
		const trees = withIds(input.trees);
		const {op, ids} = bulkCreateOp({
			parentId: internalParent(parent),
			index: anchoredIndex(
				siblings.map((sibling) => sibling.id),
				input.afterId,
				input.index ?? siblings.length,
			),
			trees,
			userId: session.userId,
			now: this.now(),
			dateJoinedSec: session.dateJoinedSec,
		});
		const linkOps = await this.mirrorLinkOps(trees, session.dateJoinedSec);
		await this.pusher.pushAndPoll({ops: [op, ...linkOps]});
		const writeKept = (nodes: NewTree[]) => {
			for (const node of nodes) {
				const kept = keptInternalMetadata(node.metadata);
				if (node.id !== undefined && kept !== undefined) {
					this.writeNodeMetadata(node.id, kept);
				}
				writeKept(node.children ?? []);
			}
		};
		writeKept(trees);
		await tree.refreshChildren(
			[parent],
			trees.flatMap((node) => (node.id !== undefined && (node.children?.length ?? 0) > 0 ? [node.id] : [])),
		);
		tree.recordRelationships(createdRelationships(trees));
		return {ids};
	}

	/** The `edit`s that list each mirror root created inside `trees` on its original's `mirror.mirrorRootIds`. */
	private async mirrorLinkOps(trees: NewTree[], dateJoinedSec: number): Promise<InternalOp[]> {
		const roots = mirrorRootsIn(trees);
		if (roots.length === 0) {
			return [];
		}
		const items = (await this.client.getTreeSnapshot()).items;
		return [...new Set(roots.map((root) => root.originId))].map((originId) => {
			const metadata = items.find((candidate) => candidate.id === originId)?.metadata ?? {};
			const {patches, inverse} = buildMetadataChanges(
				metadata,
				roots
					.filter((root) => root.originId === originId)
					.map((root) => ({path: ["mirror", "mirrorRootIds", root.mirrorId], value: true})),
			);
			return editOp({
				id: originId,
				metadataPatches: patches,
				metadataInversePatches: inverse,
				now: this.now(),
				dateJoinedSec,
			});
		});
	}

	/**
	 * Bring each source's backlinks in line with the internal links in its
	 * name and note, as upstream's client does after an edit, create or
	 * undelete (`Ui1` in wf-base). For each linked target without a backlink
	 * from the source: create the target's references root (a last child with
	 * `isReferencesRoot`) when it has none, and a mirror of the source at its
	 * top carrying `backlink: {sourceID, targetID}`. Each backlink item of the
	 * source whose target is no longer linked is deleted. The source's
	 * `mirror.backlinkMirrorRootIds` follows with one edit.
	 *
	 * Mirrors and references roots are never sources, and links to the
	 * source itself or to nodes outside the tree are skipped. A link to a
	 * mirror targets its original. Everything goes out in one push; the
	 * changed parents are then read back and recorded as one unit of work.
	 */
	async syncBacklinks(sourceIds: string[]): Promise<BacklinkSync> {
		const result: BacklinkSync = {created: [], referencesRoots: [], deleted: []};
		const tree = this.tree();
		const items = (await this.client.getTreeSnapshot()).items;
		const metadataById = new Map(items.map((item) => [item.id, item.metadata ?? {}]));
		const idByShortId = new Map(items.map((item) => [uuidToShortId(item.id), item.id]));
		const originalOf = (id: string): string => {
			const original = getPath(metadataById.get(id), ["mirror", "originalId"]);
			return typeof original === "string" && metadataById.has(original) ? original : id;
		};
		// The session is read only once there is an op to build.
		let sessionRead: Promise<InternalSession> | undefined;
		const opContext = async () => {
			const {userId, dateJoinedSec} = await (sessionRead ??= this.session());
			return {userId, clock: {now: this.now(), dateJoinedSec}};
		};
		const childOrders = new Map<string, string[]>();
		const childOrder = async (parentId: string): Promise<string[]> => {
			let order = childOrders.get(parentId);
			if (order === undefined) {
				order = (await tree.liveChildren(parentId)).map((child) => child.id);
				childOrders.set(parentId, order);
			}
			return order;
		};
		const rootOf = new Map<string, string>();
		const changedParents = new Set<string>();
		const ops: InternalOp[] = [];

		for (const sourceId of new Set(sourceIds)) {
			const metadata = metadataById.get(sourceId);
			if (metadata === undefined || metadata.isReferencesRoot === true || originalOf(sourceId) !== sourceId) {
				continue;
			}
			const source = await tree.liveNode(sourceId);
			const targets = [
				...new Set(
					internalLinkShortIds(`${source.name} ${source.note ?? ""}`).flatMap((shortId) => {
						const id = idByShortId.get(shortId);
						return id === undefined ? [] : [originalOf(id)];
					}),
				),
			].filter((id) => id !== sourceId);
			const changes: MetadataChange[] = [];

			for (const itemId of stringKeys(getPath(metadata, ["mirror", "backlinkMirrorRootIds"]))) {
				if (!metadataById.has(itemId)) {
					// The item is gone from the tree; upstream's detach drops its id from the source.
					changes.push({path: ["mirror", "backlinkMirrorRootIds", itemId], value: undefined});
					continue;
				}
				const backlink = backlinkOf(metadataById.get(itemId));
				if (backlink?.sourceID !== sourceId) {
					continue;
				}
				const kept = targets.indexOf(backlink.targetID);
				if (kept !== -1) {
					targets.splice(kept, 1);
					continue;
				}
				const parentId = (await tree.liveNode(itemId)).parent_id ?? null;
				if (parentId === null) {
					continue;
				}
				const siblings = await childOrder(parentId);
				const {clock} = await opContext();
				ops.push(deleteOp({...clock, id: itemId, from: {parentId, index: siblings.indexOf(itemId)}}));
				siblings.splice(siblings.indexOf(itemId), 1);
				changes.push({path: ["mirror", "backlinkMirrorRootIds", itemId], value: undefined});
				changedParents.add(parentId);
				result.deleted.push(itemId);
			}

			for (const targetId of targets) {
				let rootId = rootOf.get(targetId);
				if (rootId === undefined) {
					const children = await childOrder(targetId);
					rootId = children.find((child) => metadataById.get(child)?.isReferencesRoot === true);
					if (rootId === undefined) {
						const {userId, clock} = await opContext();
						const created = bulkCreateOp({
							...clock,
							parentId: targetId,
							index: children.length,
							trees: [{name: "", metadata: {isReferencesRoot: true}}],
							userId,
							generateId: this.generateId,
						});
						[rootId] = created.ids;
						if (rootId === undefined) {
							throw new Error("bulk_create produced no id");
						}
						ops.push(created.op);
						children.push(rootId);
						childOrders.set(rootId, []);
						changedParents.add(targetId);
						result.referencesRoots.push(rootId);
					}
					rootOf.set(targetId, rootId);
				}
				const {userId, clock} = await opContext();
				const created = bulkCreateOp({
					...clock,
					parentId: rootId,
					index: 0,
					trees: [
						{
							name: "",
							metadata: {
								mirror: {originalId: sourceId, isMirrorRoot: true},
								backlink: {sourceID: sourceId, targetID: targetId},
							},
						},
					],
					userId,
					generateId: this.generateId,
				});
				const [itemId] = created.ids;
				if (itemId === undefined) {
					throw new Error("bulk_create produced no id");
				}
				ops.push(created.op);
				(await childOrder(rootId)).unshift(itemId);
				changes.push({path: ["mirror", "backlinkMirrorRootIds", itemId], value: true});
				changedParents.add(rootId);
				result.created.push({id: itemId, sourceId, targetId});
			}

			if (changes.length > 0) {
				const {patches, inverse} = buildMetadataChanges(metadata, changes);
				const {clock} = await opContext();
				ops.push(editOp({...clock, id: sourceId, metadataPatches: patches, metadataInversePatches: inverse}));
			}
		}

		if (ops.length === 0) {
			return result;
		}
		await this.pusher.pushAndPoll({ops});
		// A new references root is read back after its target, which first caches it.
		const newRoots = new Set(result.referencesRoots);
		await tree.refreshBacklinks(
			[...changedParents].toSorted((a, b) => Number(newRoots.has(a)) - Number(newRoots.has(b))),
			{
				referencesRoots: result.referencesRoots,
				backlinks: result.created.map(({id, sourceId, targetId}) => ({nodeId: id, sourceId, targetId})),
				deleted: result.deleted,
			},
		);
		return result;
	}

	/**
	 * Create a live mirror of a node at an exact slot, the way upstream's
	 * `mirrorProjectTree` does: one push of a `bulk_create` for an empty mirror
	 * root carrying `mirror.{originalId, isMirrorRoot}`, and an `edit` adding the
	 * mirror to the original's `mirror.mirrorRootIds`. Unlike the public mirror
	 * endpoint, this takes `HOME`. The original's metadata is read fresh from
	 * `/get_tree_data/` so the patch keeps the mirrors it already has.
	 */
	async createMirrorAt(input: CreateMirrorAtInput): Promise<CreateMirrorResult> {
		const {mirrors} = await this.createMirrorsAt({
			originalIds: [input.originalId],
			parentId: input.parentId,
			index: input.index,
		});
		const [only] = mirrors;
		if (only === undefined) {
			throw new Error("bulk_create produced no id");
		}
		return only;
	}

	/**
	 * Mirror several nodes at consecutive slots with one push: one `bulk_create` of an empty mirror root per
	 * source, then one `edit` per distinct original adding its new mirrors to `mirror.mirrorRootIds`. A source
	 * that is itself a mirror mirrors its original.
	 */
	async createMirrorsAt(input: CreateMirrorsAtInput): Promise<{mirrors: CreateMirrorResult[]}> {
		const tree = this.tree();
		const items = (await this.client.getTreeSnapshot()).items;
		const metadataOf = (id: string): Metadata | undefined => {
			const item = items.find((candidate) => candidate.id === id);
			return item === undefined ? undefined : (item.metadata ?? {});
		};
		const originIds = input.originalIds.map((requestedId) => {
			const requested = metadataOf(requestedId);
			if (requested === undefined) {
				throw new Error(`Cannot mirror ${requestedId}: it is not in the Workflowy tree`);
			}
			const mirroredOriginal = getPath(requested, ["mirror", "originalId"]);
			return typeof mirroredOriginal === "string" ? mirroredOriginal : requestedId;
		});

		const parent = publicParent(input.parentId);
		const siblings = await tree.liveChildren(parent);
		const session = await this.session();
		const {op: createOp, ids} = bulkCreateOp({
			parentId: internalParent(parent),
			index: clampIndex(input.index, siblings.length),
			trees: originIds.map((originId) => ({
				name: "",
				metadata: {mirror: {originalId: originId, isMirrorRoot: true}},
			})),
			userId: session.userId,
			now: this.now(),
			dateJoinedSec: session.dateJoinedSec,
			generateId: this.generateId,
		});
		const mirrors = ids.map((mirrorId, offset) => ({mirrorId, originId: originIds[offset] ?? ""}));
		const linkOps = [...new Set(originIds)].map((originId) => {
			const {patches, inverse} = buildMetadataChanges(
				metadataOf(originId) ?? {},
				mirrors
					.filter((mirror) => mirror.originId === originId)
					.map((mirror) => ({path: ["mirror", "mirrorRootIds", mirror.mirrorId], value: true})),
			);
			return editOp({
				id: originId,
				metadataPatches: patches,
				metadataInversePatches: inverse,
				now: this.now(),
				dateJoinedSec: session.dateJoinedSec,
			});
		});
		await this.pusher.pushAndPoll({ops: [createOp, ...linkOps]});
		await tree.refreshChildren([parent]);
		tree.recordRelationships({
			...emptyItemRelationships(),
			mirrors: mirrors.map(({mirrorId, originId}) => ({mirrorId, originalId: originId})),
		});
		return {mirrors};
	}

	/**
	 * Find or create the `📆 Calendar` day node for a `YYYYMMDD` dateId the way
	 * upstream's Today does (`C9`): for each enabled level, a child whose
	 * calendar metadata (or id) matches is reused; otherwise the deterministic
	 * id `calendarNodeId(entropyKey, level, dateId)` is moved back under the
	 * parent when it exists elsewhere, or created there with
	 * `{restorableUniqueNode, calendar}` metadata at the timestamp-sorted slot.
	 * `stopAt` ends the walk at that level (upstream's strip arrows and month
	 * cells). With `createChild` (the default) a new or empty final node gets
	 * one empty child.
	 *
	 * The walk reads the cache. Workflowy is read only to confirm a miss before
	 * writing, and for the rest of the walk after one, since the cache can lag
	 * it. The missing levels and the empty child go in one nested `bulk_create`
	 * push, then one parallel re-read caches them.
	 */
	async ensureCalendarDay(
		dateId: number,
		{stopAt = "day", createChild = true}: {stopAt?: CalendarLevel; createChild?: boolean} = {},
	): Promise<EnsuredCalendarDay> {
		const date = parseDateId(dateId);
		if (date === undefined) {
			throw new RangeError(`${dateId} is not a YYYYMMDD date`);
		}
		const root = this.findCalendarRoot();
		// Upstream `GO`: the root's levels (a missing key is off), else year, month and day.
		const shown = root.levels ?? DEFAULT_CALENDAR_LEVELS;
		const levels = CALENDAR_LEVELS.slice(0, CALENDAR_LEVELS.indexOf(stopAt) + 1).filter((level) => shown[level]);
		const session = await this.session();
		const rootMetadata = await this.getRootMeta([]);
		const dateFormat = getPath(rootMetadata, ["dateFormat"]);
		const weekStartDay = getPath(rootMetadata, ["weekStartDay"]);
		const weekStart = typeof weekStartDay === "number" ? weekStartDay : 0;
		const specs = levels.map((level) => {
			const levelDateId = calendarDateId(level, date, weekStart);
			const id =
				session.entropyKey === undefined
					? undefined
					: calendarNodeId(session.entropyKey, level, levelDateId, date.year);
			return {level, levelDateId, id};
		});
		const toCreate = ({level, id}: (typeof specs)[number]): CalendarChainNode => ({
			id: id ?? this.generateId(),
			name: calendarLevelName(level, date, typeof dateFormat === "string" ? dateFormat : "", weekStart),
			metadata: {restorableUniqueNode: true, calendar: calendarLevelMetadata(level, date, weekStart)},
		});
		const tree = this.tree();
		let live = false;
		// Parents read live: the cache lagged Workflowy there, so they are cached before returning.
		const liveParents: string[] = [];
		const cacheLiveParents = async (parents: string[]): Promise<void> => {
			if (parents.length > 0) {
				await tree.refreshChain(parents);
			}
		};
		const lookUp = async (
			parentId: string,
			matches: (ids: string[]) => string | undefined,
		): Promise<{found: string | undefined; children: string[]}> => {
			if (!live) {
				const cached = tree.cachedChildIds(parentId);
				const found = matches(cached);
				if (found !== undefined) {
					return {found, children: cached};
				}
				live = true;
			}
			const children = (await tree.liveChildren(parentId)).map((child) => child.id);
			liveParents.push(parentId);
			return {found: matches(children), children};
		};

		const created: string[] = [];
		let parentId = root.id;
		for (let position = 0; position < specs.length; position += 1) {
			const spec = specs[position];
			if (spec === undefined) {
				break;
			}
			const {level, levelDateId, id} = spec;
			const {found, children} = await lookUp(parentId, (ids) =>
				ids.find((child) => {
					const calendar = this.readCalendar(child);
					return child === id || (calendar?.level === level && calendar.dateId === levelDateId);
				}),
			);
			if (found !== undefined) {
				parentId = found;
				continue;
			}
			const index = calendarInsertIndex(
				children.map((child) => this.readCalendar(child)),
				level,
				levelDateId,
			);
			if (id !== undefined && this.isCached(id)) {
				await this.moveTo({ids: [id], parentId, index});
				parentId = id;
				continue;
			}
			// This level and each deeper one whose deterministic node is not elsewhere are created together.
			let end = position + 1;
			while (end < specs.length && !this.isCachedLevel(specs[end]?.id)) {
				end += 1;
			}
			const chain = specs.slice(position, end).map(toCreate);
			const childId = end === specs.length && createChild ? this.generateId() : undefined;
			const chainParentId = parentId;
			await this.createCalendarChain(parentId, index, chain, childId);
			created.push(...chain.map((node) => node.id), ...(childId === undefined ? [] : [childId]));
			parentId = chain.at(-1)?.id ?? parentId;
			if (end === specs.length) {
				await cacheLiveParents(liveParents.filter((other) => other !== chainParentId));
				return {dayId: parentId, firstChildId: childId ?? null, created};
			}
			position = end - 1;
		}
		let {found: firstChildId = null} = await lookUp(parentId, (ids) => ids[0]);
		let alreadyCached: string | undefined;
		if (firstChildId === null && createChild) {
			firstChildId = this.generateId();
			await this.createCalendarChain(parentId, 0, [], firstChildId);
			created.push(firstChildId);
			alreadyCached = parentId;
		}
		await cacheLiveParents(liveParents.filter((other) => other !== alreadyCached));
		return {dayId: parentId, firstChildId, created};
	}

	/** Whether a level's deterministic node is cached (so it is moved, not created). */
	private isCachedLevel(id: string | undefined): boolean {
		return id !== undefined && this.isCached(id);
	}

	/**
	 * Create `chain` (each node nesting the next) at `index` under `parentId`,
	 * with an empty `childId` under its last node (or under `parentId` for an
	 * empty chain), in one push; then cache their calendar metadata and re-read
	 * the parent and every new node with children at once.
	 */
	private async createCalendarChain(
		parentId: string,
		index: number,
		chain: CalendarChainNode[],
		childId: string | undefined,
	): Promise<void> {
		const leaf: NewTree[] = childId === undefined ? [] : [{id: childId, name: ""}];
		const trees = chain.reduceRight<NewTree[]>((children, node) => [{...node, children}], leaf);
		const session = await this.session();
		const {op} = bulkCreateOp({
			parentId,
			index,
			trees,
			userId: session.userId,
			now: this.now(),
			dateJoinedSec: session.dateJoinedSec,
			generateId: this.generateId,
		});
		await this.pusher.pushAndPoll({ops: [op]});
		for (const node of chain) {
			this.writeNodeMetadata(node.id, keptInternalMetadata(node.metadata));
		}
		const parents = childId === undefined ? chain.slice(0, -1) : chain;
		await this.tree().refreshChain([parentId, ...parents.map((node) => node.id)]);
	}

	/**
	 * Restructure a calendar to show `levels` the way upstream's Calendar Layout
	 * Update Layout does (`JX4`), in one push. The plan comes from
	 * `loadSnapshot` (the cached calendar, as the preview plans it) and the
	 * cached metadata, so no full `/get_tree_data/` read is paid. Before the
	 * push, only the parents the writes touch are read live and compared with
	 * the snapshot; when one changed, those parents are cached fresh and the
	 * layout re-planned once. A root tagged `calendar.root` gets the account's
	 * deterministic ids for new level nodes; any other root (a sandbox copy)
	 * gets random ones. Every touched parent is then re-read into the cache,
	 * and the inverse writes are stored for {@link undoCalendarLayout}.
	 * `timings` (when given) receives each phase's milliseconds.
	 */
	async applyCalendarLayout(
		levels: CalendarLayoutLevels,
		{
			rootId: requestedRootId,
			loadSnapshot,
			timings,
		}: {rootId: string; loadSnapshot: () => CalendarLayoutSnapshot | undefined; timings?: LayoutTimings},
	): Promise<AppliedCalendarLayout> {
		requireRootId(requestedRootId);
		const time = phaseTimer(timings);
		const dateFormat = await this.getRootMeta(["dateFormat"]);
		const weekStartDay = await this.getRootMeta(["weekStartDay"]);
		const tree = this.tree();
		time("settings");

		const planFromCache = async () => {
			const snapshot = loadSnapshot();
			if (snapshot === undefined) {
				throw new CalendarRootMissing();
			}
			const rootId = snapshot.root.id;
			if (rootId !== requestedRootId) {
				throw new Error(`calendar layout: planned root ${rootId} is not the requested root ${requestedRootId}`);
			}
			const rootMetadata = CalendarMetadataSchema.safeParse(this.readNodeMetadata(rootId));
			const tagged = rootMetadata.success && rootMetadata.data.calendar.root === true;
			const entropyKey = tagged ? (await this.session()).entropyKey : undefined;
			const steps = planCalendarLayout(snapshot.root, levels, {
				...(snapshot.levels === undefined ? {} : {currentLevels: snapshot.levels}),
				dateFormat: typeof dateFormat === "string" ? dateFormat : "",
				...(typeof weekStartDay === "number" ? {weekStartDay} : {}),
				...(entropyKey === undefined ? {} : {entropyKey}),
				generateId: this.generateId,
			});
			for (const step of steps) {
				if (step.op === "create" && this.isCached(step.id)) {
					throw new Error(`calendar layout: new level node ${step.id} already exists outside the calendar`);
				}
			}
			const ids = new Set(steps.map((step) => step.id));
			const metadataById = new Map([...ids].map((id) => [id, this.readNodeMetadata(id)]));
			const layoutWrites = calendarLayoutWrites(steps, metadataById);
			this.assertLayoutWritesUnder(rootId, layoutWrites.writes);
			return {
				rootId,
				childIds: layoutChildIds(snapshot.root),
				metadataById,
				...layoutWrites,
			};
		};

		let planned = await planFromCache();
		time("plan");
		for (let attempt = 0; planned.writes.length > 0; attempt += 1) {
			const {childIds, writes} = planned;
			const live = await Promise.all(
				layoutWriteReads(writes, childIds).map(async (parentId) => ({
					parentId,
					nodes: await tree.liveChildren(parentId),
				})),
			);
			time("verify");
			const stale = live.filter(
				({parentId, nodes}) => nodes.map((child) => child.id).join() !== childIds.get(parentId)?.join(),
			);
			if (stale.length === 0) {
				break;
			}
			if (attempt > 0) {
				throw new Error("calendar layout: the calendar changed while planning; try again");
			}
			await tree.refreshChildren(stale.map(({parentId}) => parentId));
			planned = await planFromCache();
			time("replan");
		}
		const {rootId, writes, undo, touchedParents, metadata, metadataById} = planned;
		if (writes.length === 0) {
			return {rootId, writes: 0};
		}
		await this.pushLayoutWrites(writes);
		time("push");
		const restored = Object.fromEntries(
			undo.flatMap((write) =>
				write.op === "edit" || write.op === "undelete" ? [[write.id, metadataById.get(write.id) ?? {}]] : [],
			),
		);
		// Stored before the cache refresh, so a failed read-back still leaves the pushed layout undoable.
		this.storeAccountValue(KEYS.calendarLayoutUndo, {rootId, writes: undo, metadata: restored});
		await this.refreshLayout(touchedParents, metadata);
		time("refresh");
		return {rootId, writes: writes.length};
	}

	/**
	 * Undo the last {@link applyCalendarLayout} with the inverse writes it
	 * stored, in one push; undefined when there is nothing to undo. Once used,
	 * the undo is cleared. Throws, pushing nothing, when the stored undo was
	 * applied under another root than `rootId` or would write outside it.
	 */
	async undoCalendarLayout(rootId: string): Promise<AppliedCalendarLayout | undefined> {
		requireRootId(rootId);
		const row = this.db.select().from(accountState).where(eq(accountState.key, KEYS.calendarLayoutUndo)).get();
		const stored = row && LayoutUndoSchema.safeParse(JSON.parse(row.json)).data;
		if (!stored) {
			return undefined;
		}
		if (stored.rootId !== rootId) {
			throw new Error(`calendar layout: the stored undo is for root ${stored.rootId}, not ${rootId}`);
		}
		this.assertLayoutWritesUnder(rootId, stored.writes);
		await this.pushLayoutWrites(stored.writes);
		this.db.delete(accountState).where(eq(accountState.key, KEYS.calendarLayoutUndo)).run();
		await this.refreshLayout(layoutWriteParents(stored.writes), new Map(Object.entries(stored.metadata)));
		return {rootId: stored.rootId, writes: stored.writes.length};
	}

	/**
	 * Throw unless every node `writes` touch (each written node and every
	 * parent it leaves or enters) lies under `rootId` in the cache, or is a
	 * node an earlier write in the batch creates or undeletes there. An
	 * undeleted node is in the trash, so only its new parent is checked.
	 */
	private assertLayoutWritesUnder(rootId: string, writes: readonly LayoutWrite[]): void {
		const verdicts = new Map<string, boolean>([[rootId, true]]);
		const cachedUnder = (id: string): boolean => {
			const path: string[] = [];
			let current: string | null | undefined = id;
			let verdict = false;
			while (current !== null && current !== undefined) {
				const known = verdicts.get(current);
				if (known !== undefined) {
					verdict = known;
					break;
				}
				path.push(current);
				current = this.db
					.select({parentId: nodeContent.parentId})
					.from(nodeContent)
					.where(and(eq(nodeContent.id, current), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
					.get()?.parentId;
			}
			for (const visited of path) {
				verdicts.set(visited, verdict);
			}
			return verdict;
		};
		const added = new Set<string>();
		const inside = (id: string) => added.has(id) || cachedUnder(id);
		const check = (id: string, ok: boolean) => {
			if (!ok) {
				throw new Error(`calendar layout: a write to ${id} lies outside the calendar root ${rootId}`);
			}
		};
		for (const write of writes) {
			if (write.op === "move" || write.op === "delete") {
				check(write.from.parentId, inside(write.from.parentId));
			}
			if (write.op === "create" || write.op === "move" || write.op === "undelete") {
				check(write.parentId, inside(write.parentId));
			}
			if (write.op === "create" || write.op === "undelete") {
				check(write.id, !this.isCached(write.id) || cachedUnder(write.id));
				added.add(write.id);
			} else {
				check(write.id, inside(write.id));
			}
		}
	}

	/** Push layout writes as one batch of ops. */
	private async pushLayoutWrites(writes: LayoutWrite[]): Promise<void> {
		const session = await this.session();
		const clock = {now: this.now(), dateJoinedSec: session.dateJoinedSec};
		const ops = writes.map((write): InternalOp => {
			if (write.op === "edit") {
				return editOp({
					...clock,
					id: write.id,
					metadataPatches: write.patches,
					metadataInversePatches: write.inverse,
				});
			}
			if (write.op === "create") {
				const {id, name, metadata: treeMetadata} = write;
				return bulkCreateOp({
					...clock,
					parentId: write.parentId,
					index: write.index,
					trees: [{id, name, metadata: treeMetadata}],
					userId: session.userId,
				}).op;
			}
			if (write.op === "move") {
				return moveOp({...clock, id: write.id, parentId: write.parentId, index: write.index, from: write.from});
			}
			if (write.op === "delete") {
				return deleteOp({...clock, id: write.id, from: write.from});
			}
			return undeleteOp({...clock, id: write.id, parentId: write.parentId, index: write.index});
		});
		await this.pusher.pushAndPoll({ops});
	}

	/** Re-read the touched parents into the cache, then cache the edited and created nodes' metadata. */
	private async refreshLayout(touchedParents: string[], metadata: ReadonlyMap<string, Metadata>): Promise<void> {
		// Parents come first-touched first, so a created level node is cached before the days moved into it.
		await this.tree().refreshChildren(touchedParents);
		for (const [id, value] of metadata) {
			if (this.isCached(id)) {
				this.writeNodeMetadata(id, keptInternalMetadata(value));
			}
		}
	}

	private storeAccountValue(key: string, value: unknown): void {
		const json = JSON.stringify(value);
		const fetchedAt = this.now();
		this.db
			.insert(accountState)
			.values({key, json, fetchedAt})
			.onConflictDoUpdate({target: accountState.key, set: {json, fetchedAt}})
			.run();
	}

	private findCalendarRoot(): {id: string; levels: Record<string, boolean> | undefined} {
		const rows = this.db
			.select({nodeId: nodeInternalMetadata.nodeId, metadataJson: nodeInternalMetadata.metadataJson})
			.from(nodeInternalMetadata)
			.innerJoin(nodeContent, eq(nodeContent.id, nodeInternalMetadata.nodeId))
			.where(
				and(
					eq(nodeContent.systemTo, FAR_FUTURE_DATE),
					like(nodeInternalMetadata.metadataJson, '%"root":true%'),
				),
			)
			.all();
		for (const row of rows) {
			const parsed = CalendarMetadataSchema.safeParse(JSON.parse(row.metadataJson));
			if (parsed.success && parsed.data.calendar.root === true) {
				return {id: row.nodeId, levels: parsed.data.calendar.levels};
			}
		}
		throw new CalendarRootMissing();
	}

	/** A node's cached calendar level and dateId, if it has both. */
	private readCalendar(id: string): {level: string; dateId: number} | undefined {
		const parsed = CalendarMetadataSchema.safeParse(this.readNodeMetadata(id));
		const calendar = parsed.success ? parsed.data.calendar : undefined;
		return calendar?.level === undefined || calendar.dateId === undefined
			? undefined
			: {level: calendar.level, dateId: calendar.dateId};
	}

	private isCached(id: string): boolean {
		return (
			this.db
				.select({id: nodeContent.id})
				.from(nodeContent)
				.where(and(eq(nodeContent.id, id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
				.get() !== undefined
		);
	}

	/** Move nodes to an exact slot: one `move` for one id, one `bulk_move` (keeping their order) for several. */
	async moveTo(input: MoveToInput): Promise<void> {
		if (input.ids.length === 0) {
			return;
		}
		const tree = this.tree();
		const target = publicParent(input.parentId);
		const moving = await Promise.all(input.ids.map(async (id) => tree.liveNode(id)));
		const parents = [...new Set([...moving.map((node) => node.parent_id ?? null), target])];
		const orders = new Map(
			await Promise.all(
				parents.map(async (parent) => {
					const children = await tree.liveChildren(parent);
					return [parent, children.map((child) => child.id)] as const;
				}),
			),
		);
		const order = (parent: PublicParent) => orders.get(parent) ?? [];
		const from = (id: string, parent: PublicParent): Location => ({
			parentId: internalParent(parent),
			index: order(parent).indexOf(id),
		});
		const siblings = order(target);
		const index = clampIndex(input.index ?? siblings.length, siblings.length);
		const session = await this.session();
		const clock = {now: this.now(), dateJoinedSec: session.dateJoinedSec};
		const items = moving.map((node) => ({id: node.id, from: from(node.id, node.parent_id ?? null)}));
		const [only] = items;
		const op =
			only !== undefined && items.length === 1
				? moveOp({...clock, id: only.id, parentId: internalParent(target), index, from: only.from})
				: bulkMoveOp({...clock, items, parentId: internalParent(target), siblings, index});
		await this.pusher.pushAndPoll({ops: [op]});
		await tree.refreshChildren(parents);
	}

	/**
	 * Bring back a deleted node with its original id: an `undelete` into the
	 * given slot, or `POST /trash/restore/<id>/` (back where it was) without one.
	 * The descendants come back too, so the cache re-reads the restored subtree
	 * along with the parent's children.
	 */
	async restore(input: RestoreInput): Promise<void> {
		const tree = this.tree();
		if (input.parentId === undefined) {
			await this.session();
			await this.postOk(`/trash/restore/${input.id}/`, new URLSearchParams(), true);
			const restored = await tree.liveNode(input.id);
			await tree.refreshChildren([restored.parent_id ?? null], [input.id]);
			await this.syncRestoredBacklinks(input.id);
			return;
		}
		const parent = publicParent(input.parentId);
		const siblings = await tree.liveChildren(parent);
		const session = await this.session();
		const op = undeleteOp({
			id: input.id,
			parentId: internalParent(parent),
			index: clampIndex(input.index ?? siblings.length, siblings.length),
			now: this.now(),
			dateJoinedSec: session.dateJoinedSec,
		});
		await this.pusher.pushAndPoll({ops: [op]});
		await tree.refreshChildren([parent], [input.id]);
		await this.syncRestoredBacklinks(input.id);
	}

	/** Upstream re-syncs the backlinks of every undeleted item; only cached nodes with a link can have any to create. */
	private async syncRestoredBacklinks(rootId: string): Promise<void> {
		const linked = linkedSourcesInSubtree(this.db, rootId);
		if (linked.length > 0) {
			await this.syncBacklinks(linked);
		}
	}

	/**
	 * After a delete, remove the backlink items of each of `sourceIds` that
	 * left the tree, as upstream's client does when it deletes an item
	 * (`item.delete-iteration.backlink` in wf-base): every item whose
	 * `backlink.sourceID` is a deleted source goes in one push, and the target's
	 * references root stays, even when emptied. Sources still in the tree, such
	 * as an original whose mirror was the one removed, keep theirs. Pass
	 * {@link linkedSourcesInSubtree} read before the delete.
	 */
	async deleteBacklinksOf(sourceIds: string[]): Promise<string[]> {
		if (sourceIds.length === 0) {
			return [];
		}
		const items = (await this.client.getTreeSnapshot()).items;
		const live = new Set(items.map((item) => item.id));
		const deletedSources = new Set(sourceIds.filter((id) => !live.has(id)));
		const itemIds = items
			.filter((item) => {
				const backlink = backlinkOf(item.metadata);
				return backlink !== undefined && deletedSources.has(backlink.sourceID);
			})
			.map((item) => item.id);
		if (itemIds.length === 0) {
			return [];
		}
		const tree = this.tree();
		const session = await this.session();
		const clock = {now: this.now(), dateJoinedSec: session.dateJoinedSec};
		const orders = new Map<string, string[]>();
		const ops: InternalOp[] = [];
		const deleted: string[] = [];
		for (const itemId of itemIds) {
			const parentId = (await tree.liveNode(itemId)).parent_id ?? null;
			if (parentId === null) {
				continue;
			}
			let siblings = orders.get(parentId);
			if (siblings === undefined) {
				siblings = (await tree.liveChildren(parentId)).map((child) => child.id);
				orders.set(parentId, siblings);
			}
			const index = siblings.indexOf(itemId);
			ops.push(deleteOp({...clock, id: itemId, from: {parentId, index}}));
			siblings.splice(index, 1);
			deleted.push(itemId);
		}
		if (ops.length === 0) {
			return [];
		}
		await this.pusher.pushAndPoll({ops});
		await tree.refreshBacklinks([...orders.keys()], {referencesRoots: [], backlinks: [], deleted});
		return deleted;
	}

	/** Set (or, with `undefined`, remove) one node metadata value; see {@link setNodeMetaValues}. */
	async setNodeMeta(id: string, path: string[], value: unknown): Promise<void> {
		await this.setNodeMetaValues(id, [{path, value}]);
	}

	/**
	 * Set (or, with `undefined`, remove) several of a node's metadata values
	 * with one `edit`; `HOME` goes to {@link setRootMetaValues}. Patches are
	 * built against the node's fresh public-API `data` (which carries only keys
	 * such as `layoutMode`) overlaid with its cached internal metadata, and once
	 * the server accepts the edit the patched result is written back to
	 * `node_internal_metadata`.
	 */
	async setNodeMetaValues(id: string, changes: MetadataChange[]): Promise<void> {
		if (id === HOME) {
			await this.setRootMetaValues(changes);
			return;
		}
		const tree = this.tree();
		const node = await tree.liveNode(id);
		const base = {...node.data, ...this.readNodeMetadata(id)};
		const {patches, inverse} = buildMetadataChanges(base, changes);
		if (patches.length === 0) {
			return;
		}
		const session = await this.session();
		const op = editOp({
			id,
			metadataPatches: patches,
			metadataInversePatches: inverse,
			now: this.now(),
			dateJoinedSec: session.dateJoinedSec,
		});
		await this.pusher.pushAndPoll({ops: [op]});
		this.writeNodeMetadata(id, keptInternalMetadata(applyMetadataPatches(base, patches)));
		await tree.refreshChildren([node.parent_id ?? null]);
	}

	private readNodeMetadata(id: string): Metadata {
		const row = this.db
			.select({metadataJson: nodeInternalMetadata.metadataJson})
			.from(nodeInternalMetadata)
			.where(eq(nodeInternalMetadata.nodeId, id))
			.get();
		return row === undefined ? {} : MetadataSchema.parse(JSON.parse(row.metadataJson));
	}

	private writeNodeMetadata(id: string, metadata: Metadata | undefined): void {
		if (metadata === undefined) {
			this.db.delete(nodeInternalMetadata).where(eq(nodeInternalMetadata.nodeId, id)).run();
			return;
		}
		const row = {metadataJson: JSON.stringify(metadata), fetchedAt: this.now()};
		this.db
			.insert(nodeInternalMetadata)
			.values({nodeId: id, ...row})
			.onConflictDoUpdate({target: nodeInternalMetadata.nodeId, set: row})
			.run();
	}

	private tree(): WorkflowyWriteThroughClient {
		if (!this.writeThrough) {
			throw new TypeError("tree writes need the writeThrough option");
		}
		return this.writeThrough;
	}

	private async session(): Promise<InternalSession> {
		return this.client.session ?? this.client.bootstrap();
	}

	/** POST a form; a redirect means logged out, a non-2xx (or, when `checkSucceeded`, `succeeded:false`) fails. */
	private async postOk(path: string, form: URLSearchParams, checkSucceeded = false): Promise<void> {
		let response: Response;
		try {
			response = await this.client.postForm(path, form);
		} catch (error) {
			throw new TransportError(`POST ${path} failed`, {cause: error});
		}
		if (response.status >= 300 && response.status < 400) {
			throw new LoggedOut(`redirect to ${response.headers.get("location") ?? "unknown"}`);
		}
		if (!response.ok) {
			throw new TransportError(`POST ${path} returned ${response.status} ${response.statusText}`);
		}
		if (checkSucceeded) {
			const body = SucceededSchema.safeParse(await response.json().catch(() => {}));
			if (!body.success || !body.data.succeeded) {
				throw new OperationRejected(`POST ${path} did not succeed`);
			}
		}
	}

	/**
	 * Every cached node the server records as expanded. The server keys
	 * expansion by the first 8 chars of the id, so a key resolves to every
	 * cached id it prefixes (twins expand together, as upstream) and keys with
	 * no cached node are dropped.
	 *
	 * The keys are cached in `account_state`: only the first read ever waits
	 * on `/get_tree_data/`; a read of keys older than 30s answers from the
	 * cache and refreshes them in the background (see {@link expandedKeysRefreshed}).
	 * A `fresh` read (tab focus) instead waits on the refresh once the keys are
	 * 5s old, so a change made on workflowy.com shows on that read.
	 */
	async getExpandedIds({fresh = false}: {fresh?: boolean} = {}): Promise<string[]> {
		return (await this.getExpansionState({fresh})).expandedIds;
	}

	/**
	 * {@link getExpandedIds} plus what a client needs to judge it: when the keys were fetched, whether a refresh is
	 * still running, and a fingerprint of the keys for ETags. With `wait`, a running refresh is awaited (at most
	 * {@link FRESH_WAIT_MS}) before the cache is read, so a client that got `refreshing: true` can collect the result.
	 * A `fresh` read waits the same bounded time and otherwise falls back to the cached keys.
	 */
	async getExpansionState({
		fresh = false,
		wait = false,
	}: {fresh?: boolean; wait?: boolean} = {}): Promise<ExpansionState> {
		const keys = await this.expandedKeys(fresh, wait);
		const fetchedAt = this.loadExpandedKeys()?.fetchedAt ?? this.now();
		return {
			expandedIds: this.resolveExpandedIds(keys),
			fetchedAt,
			refreshing: this.expandedKeysRefresh !== undefined,
			fingerprint: createHash("sha1")
				.update(JSON.stringify([...keys].toSorted()))
				.digest("hex"),
		};
	}

	private resolveExpandedIds(keys: Set<string>): string[] {
		const plain = this.db
			.select({id: nodeContent.id})
			.from(nodeContent)
			.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
			.orderBy(nodeContent.id)
			.all()
			.map(({id}) => id)
			.filter((id) => keys.has(expansionKey(id)));
		const instances = [...keys].filter((key) => key.startsWith("v_")).flatMap((key) => this.instanceIds(key));
		return [...plain, ...instances];
	}

	/**
	 * The virtual ids a `v_<child4><mirror4><path>` key expands. The key holds only id prefixes, so it is read back by
	 * walking: from each mirror root whose id starts with the mirror chunk, down the original's rows (children of a
	 * mirror are its original's), following only the rows whose chunk is the key path's next one. A row met when the
	 * walk's path equals the key's path and whose id starts with the child chunk is an expanded instance.
	 */
	private instanceIds(key: string): string[] {
		const child = key.slice(2, 2 + KEY_CHUNK);
		const mirror = key.slice(2 + KEY_CHUNK, 2 + 2 * KEY_CHUNK);
		const path = key.slice(2 + 2 * KEY_CHUNK);
		if (child.length < KEY_CHUNK || mirror.length < KEY_CHUNK || !path.startsWith(mirror)) {
			return [];
		}
		const roots = this.db
			.select({id: mirrorsTable.mirrorId, originalId: mirrorsTable.originalId})
			.from(mirrorsTable)
			.where(and(like(mirrorsTable.mirrorId, `${mirror}%`), eq(mirrorsTable.systemTo, FAR_FUTURE_DATE)))
			.all();
		const found: string[] = [];
		const walk = (rootId: string, rowId: string, walked: string): void => {
			const childIds = this.shownChildIds(rowId);
			if (walked === path) {
				found.push(
					...childIds
						.filter((id) => id.startsWith(child))
						.map((id) => virtualId({childId: id, mirrorRootId: rootId, path})),
				);
				return;
			}
			const chunk = path.slice(walked.length, walked.length + KEY_CHUNK);
			for (const id of childIds) {
				if (id.startsWith(chunk)) {
					walk(rootId, id, walked + chunk);
				}
			}
		};
		for (const root of roots) {
			walk(root.id, root.id, mirror);
		}
		return found;
	}

	/** The ids of a row's current children, taken from its original when it is a mirror. */
	private shownChildIds(rowId: string): string[] {
		const original = this.db
			.select({originalId: mirrorsTable.originalId})
			.from(mirrorsTable)
			.where(and(eq(mirrorsTable.mirrorId, rowId), eq(mirrorsTable.systemTo, FAR_FUTURE_DATE)))
			.get();
		return this.db
			.select({id: nodeContent.id})
			.from(nodeContent)
			.where(
				and(eq(nodeContent.parentId, original?.originalId ?? rowId), eq(nodeContent.systemTo, FAR_FUTURE_DATE)),
			)
			.orderBy(nodeContent.id)
			.all()
			.map(({id}) => id);
	}

	/**
	 * Whether an id is expanded, per the same cached keys {@link getExpandedIds} reads, without listing every cached
	 * node: an outline view tests only the rows it reaches.
	 */
	async expansionTest(): Promise<(id: string) => boolean> {
		const keys = await this.expandedKeys(false);
		return (id) => keys.has(expansionKey(id));
	}

	private async expandedKeys(fresh: boolean, wait = false): Promise<Set<string>> {
		const cached = this.loadExpandedKeys();
		if (!cached) {
			return this.refreshExpandedKeys();
		}
		if (wait && this.expandedKeysRefresh !== undefined) {
			await this.boundedRefresh(this.expandedKeysRefresh);
			return this.loadExpandedKeys()?.keys ?? cached.keys;
		}
		if (fresh && cached.fetchedAt <= this.now() - FRESH_EXPANSION_THROTTLE_MS) {
			const keys = await this.boundedRefresh(this.refreshExpandedKeys());
			return keys ?? cached.keys;
		}
		if (cached.fetchedAt < this.now() - FRESHNESS_MS) {
			void this.refreshExpandedKeys().catch((error: unknown) => {
				console.error("Failed to refresh expanded keys", error);
			});
		}
		return cached.keys;
	}

	/** Await `refresh` for at most {@link FRESH_WAIT_MS}; undefined on a timeout, with the refresh left running. */
	private async boundedRefresh(refresh: Promise<Set<string>>): Promise<Set<string> | undefined> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<undefined>((resolve) => {
			timer = setTimeout(() => {
				resolve(undefined);
			}, FRESH_WAIT_MS);
		});
		try {
			const keys = await Promise.race([refresh, timeout]);
			if (keys === undefined) {
				refresh.catch((error: unknown) => {
					console.error("Failed to refresh expanded keys", error);
				});
			}
			return keys;
		} finally {
			clearTimeout(timer);
		}
	}

	/** Settles once the in-flight expanded-keys refresh, if any, has finished. */
	async expandedKeysRefreshed(): Promise<void> {
		await this.expandedKeysRefresh?.catch(() => {});
	}

	/** Expand (`true`) or collapse (`false`) nodes with one push carrying only `project_expansions_delta`. */
	async setExpanded(changes: Record<string, boolean>): Promise<void> {
		const entries = Object.entries(changes);
		if (entries.length === 0) {
			return;
		}
		await this.session();
		await this.pushExpansionsDelta(
			Object.fromEntries(entries.map(([id, expanded]) => [expansionKey(id), expanded])),
		);
	}

	/** The account's left-bar expansion keys (`leftbar__<section>__<context>__<id8>`), as stored, unresolved. */
	async getLeftBarExpansionKeys(): Promise<string[]> {
		const keys = await this.expandedKeys(false);
		return [...keys].filter((key) => key.startsWith("leftbar__")).toSorted();
	}

	/** Push expansion changes keyed by raw upstream keys, with no id-prefix mapping. */
	async setRawExpansionKeys(changes: Record<string, boolean>): Promise<void> {
		if (Object.keys(changes).length === 0) {
			return;
		}
		await this.session();
		await this.pushExpansionsDelta(changes);
	}

	private async pushExpansionsDelta(expansionsDelta: Record<string, boolean>): Promise<void> {
		await this.pusher.pushAndPoll({expansionsDelta});
		this.saveLocalSettings(
			Object.fromEntries(
				Object.entries(expansionsDelta).map(([key, expanded]) => [`expansion:${key}`, expanded]),
			),
		);
		this.pushedDuringRefresh?.push(expansionsDelta);
		const cached = this.loadExpandedKeys();
		if (cached) {
			this.storeExpandedKeys(applyExpansionsDelta(cached.keys, expansionsDelta), cached.fetchedAt);
		}
	}

	/** One `/get_tree_data/` at a time; deltas pushed while it runs are replayed onto its snapshot. */
	private async refreshExpandedKeys(): Promise<Set<string>> {
		this.expandedKeysRefresh ??= (async () => {
			const pushed: Record<string, boolean>[] = [];
			this.pushedDuringRefresh = pushed;
			try {
				const fetchedAt = this.now();
				let keys = new Set(await this.client.getExpandedKeys());
				for (const delta of pushed) {
					keys = applyExpansionsDelta(keys, delta);
				}
				this.storeExpandedKeys(keys, fetchedAt);
				return keys;
			} finally {
				this.pushedDuringRefresh = undefined;
				this.expandedKeysRefresh = undefined;
			}
		})();
		return this.expandedKeysRefresh;
	}

	private loadExpandedKeys(): {keys: Set<string>; fetchedAt: number} | undefined {
		const row = this.db.select().from(accountState).where(eq(accountState.key, KEYS.expandedKeys)).get();
		const keys = row && ExpandedKeysSchema.safeParse(JSON.parse(row.json)).data;
		return row && keys ? {keys: new Set(keys), fetchedAt: row.fetchedAt} : undefined;
	}

	private storeExpandedKeys(keys: Set<string>, fetchedAt: number): void {
		const json = JSON.stringify([...keys].toSorted());
		this.db
			.insert(accountState)
			.values({key: KEYS.expandedKeys, json, fetchedAt})
			.onConflictDoUpdate({target: accountState.key, set: {json, fetchedAt}})
			.run();
	}

	/**
	 * The account's `entropyKey`, which upstream mixes into deterministic node
	 * ids (`calendarNodeId`). It never changes, so it is cached in
	 * `account_state` with no expiry; undefined when the account data has none.
	 */
	async getEntropyKey(): Promise<string | undefined> {
		const row = this.db.select().from(accountState).where(eq(accountState.key, KEYS.entropyKey)).get();
		const cached = row && z.string().safeParse(JSON.parse(row.json)).data;
		if (cached !== undefined) {
			return cached;
		}
		const {entropyKey} = await this.session();
		if (entropyKey !== undefined) {
			const json = JSON.stringify(entropyKey);
			this.db
				.insert(accountState)
				.values({key: KEYS.entropyKey, json, fetchedAt: this.now()})
				.onConflictDoUpdate({target: accountState.key, set: {json, fetchedAt: this.now()}})
				.run();
		}
		return entropyKey;
	}

	/** The id upstream's `/file-proxy/` paths carry as the file owner. */
	async fileOwnerId(): Promise<number> {
		return (await this.session()).ownerId;
	}

	/** The signed S3 URL a `/file-proxy/signed-preview|signed-original/...` path resolves to. */
	async signedFileUrl(path: string): Promise<string> {
		return this.client.signedFileUrl(path);
	}

	async getAccount(): Promise<Account> {
		const {account} = await this.snapshot();
		return {
			userId: account.userId,
			joinedAt: new Date(account.dateJoinedSec * 1000),
			fullName: account.fullName ?? null,
		};
	}

	/** The root (Home) metadata value at `path`; the whole object for an empty path. */
	async getRootMeta(path: string[]): Promise<unknown> {
		return getPath((await this.snapshot()).rootMetadata, path);
	}

	/** Set (or, with `undefined`, remove) one root metadata value; see {@link setRootMetaValues}. */
	async setRootMeta(path: string[], value: unknown): Promise<void> {
		await this.setRootMetaValues([{path, value}]);
	}

	/**
	 * Set (or, with `undefined`, remove) several root metadata values: refresh,
	 * build patches against the fresh metadata, push one edit, then cache the
	 * patched metadata.
	 */
	async setRootMetaValues(changes: MetadataChange[]): Promise<void> {
		const session = await this.client.bootstrap();
		const fresh = this.fromSession(session);
		const {patches, inverse} = buildMetadataChanges(fresh.rootMetadata, changes);
		if (patches.length > 0) {
			const op = editOp({
				id: ROOT_PROJECT_ID,
				metadataPatches: patches,
				metadataInversePatches: inverse,
				now: this.now(),
				dateJoinedSec: session.dateJoinedSec,
			});
			await this.pusher.pushAndPoll({ops: [op]});
		}
		this.store({...fresh, rootMetadata: applyMetadataPatches(fresh.rootMetadata, patches)});
	}

	async getSetting(name: string): Promise<unknown> {
		return (await this.snapshot()).settings[name];
	}

	/** The server's visible feature list (one Settings > Features row each), from the account cache. */
	async visibleFeatures(): Promise<VisibleFeature[]> {
		return (await this.snapshot()).visibleFeatures;
	}

	/** The enabled-feature dict: codename -> true. Disabled flags are absent. */
	async enabledFeatures(): Promise<Record<string, true>> {
		return enabledDict((await this.snapshot()).settings.features);
	}

	/**
	 * Enable or disable one account feature like upstream's `WF.Features.toggle`: POST
	 * `/features/<enable|disable>/<codename>`, then cache the new dict (a disabled flag drops
	 * out) and keep the durable copy in `local_settings` under `setting:features`.
	 * A failed POST changes nothing.
	 */
	async setFeature(codename: string, on: boolean): Promise<Record<string, true>> {
		if (!FEATURE_CODENAME.test(codename)) {
			throw new TypeError(`invalid feature codename: ${codename}`);
		}
		const session = await this.session();
		await this.postOk(
			`/features/${on ? "enable" : "disable"}/${codename}`,
			new URLSearchParams({clientId: session.clientId}),
		);
		const current = await this.snapshot();
		const next: Record<string, true> = on
			? {...enabledDict(current.settings.features), [codename]: true}
			: Object.fromEntries(
					Object.entries(enabledDict(current.settings.features)).filter(([name]) => name !== codename),
				);
		this.store({...current, settings: {...current.settings, features: next}});
		this.saveLocalSettings({"setting:features": next});
		return next;
	}

	/** POST one server-saved setting; flags go over the wire as `"yes"`/`"no"`. */
	async setSetting(name: ServerSetting, value: string | boolean): Promise<void> {
		if (FLAG_SETTINGS.has(name) !== (typeof value === "boolean")) {
			throw new TypeError(`setting ${name} takes a ${FLAG_SETTINGS.has(name) ? "boolean" : "string"}`);
		}
		const session = await this.session();
		const wireValue = typeof value === "boolean" ? (value ? "yes" : "no") : value;
		await this.postOk("/change_settings", new URLSearchParams({[name]: wireValue, clientId: session.clientId}));
		const current = await this.snapshot();
		this.store({...current, settings: {...current.settings, [name]: value}});
		this.saveLocalSettings({[`setting:${name}`]: value});
	}

	/**
	 * Keep the app's own durable copy of settings written to workflowy.com, in `local_settings`.
	 * Unlike the account cache this is never refreshed from the server, so the values outlive
	 * the upstream account. Keys are `setting:<name>` for account settings and `root:<key>`
	 * for root-metadata preferences.
	 */
	saveLocalSettings(values: Record<string, unknown>): void {
		const updatedAt = this.now();
		this.db.transaction((tx) => {
			for (const [key, value] of Object.entries(values)) {
				const json = JSON.stringify(value ?? null);
				tx.insert(localSettings)
					.values({key, json, updatedAt})
					.onConflictDoUpdate({target: localSettings.key, set: {json, updatedAt}})
					.run();
			}
		});
	}

	/** Every durable local setting, by key. */
	localSettings(): Record<string, unknown> {
		return Object.fromEntries(
			this.db
				.select()
				.from(localSettings)
				.all()
				.map((row) => [row.key, JSON.parse(row.json) as unknown]),
		);
	}

	/**
	 * The cached account state. Only a missing snapshot waits on a bootstrap;
	 * one older than 30s is answered from the cache and refreshed in the
	 * background (see {@link accountRefreshed}), since date format, week start
	 * and settings rarely change and the bootstrap costs 0.3-1.1s.
	 */
	private async snapshot(): Promise<AccountSnapshot> {
		const cached = this.load();
		if (!cached) {
			const fresh = this.fromSession(await this.client.bootstrap());
			this.store(fresh);
			return fresh;
		}
		if (cached.fetchedAt < this.now() - FRESHNESS_MS) {
			void this.refreshAccount().catch((error: unknown) => {
				console.error("Failed to refresh account state", error);
			});
		}
		return cached.snapshot;
	}

	/** One background bootstrap at a time; its result is dropped if a write stored a newer snapshot meanwhile. */
	private async refreshAccount(): Promise<void> {
		this.accountRefresh ??= (async () => {
			try {
				const storesBefore = this.accountStores;
				const fresh = this.fromSession(await this.client.bootstrap());
				if (this.accountStores === storesBefore) {
					this.store(fresh);
				}
			} finally {
				this.accountRefresh = undefined;
			}
		})();
		return this.accountRefresh;
	}

	/** Settles once the in-flight account refresh, if any, has finished. */
	async accountRefreshed(): Promise<void> {
		await this.accountRefresh?.catch(() => {});
	}

	private fromSession(session: InternalSession): AccountSnapshot {
		return {
			account: {
				userId: session.userId,
				dateJoinedSec: session.dateJoinedSec,
				...(session.fullName === undefined ? {} : {fullName: session.fullName}),
			},
			rootMetadata: session.rootMetadata,
			settings: session.settings,
			visibleFeatures: session.visibleFeatures,
		};
	}

	/** The cached snapshot with the fetch time of its oldest part, if every part is cached. */
	private load(): {snapshot: AccountSnapshot; fetchedAt: number} | undefined {
		const rows = this.db.select().from(accountState).all();
		const byKey = new Map(rows.map((row) => [row.key, row]));
		let fetchedAt = Number.POSITIVE_INFINITY;
		const read = <T>(key: string, schema: z.ZodType<T>): T | undefined => {
			const row = byKey.get(key);
			if (!row) {
				return undefined;
			}
			fetchedAt = Math.min(fetchedAt, row.fetchedAt);
			return schema.safeParse(JSON.parse(row.json)).data;
		};
		const account = read(KEYS.account, StoredAccountSchema);
		const rootMetadata = read(KEYS.rootMetadata, MetadataSchema);
		const settings = read(KEYS.settings, MetadataSchema);
		if (!account || !rootMetadata || !settings) {
			return undefined;
		}
		const visibleFeatures = read(KEYS.visibleFeatures, VisibleFeaturesSchema) ?? [];
		return {snapshot: {account, rootMetadata, settings, visibleFeatures}, fetchedAt};
	}

	private store(snapshot: AccountSnapshot): void {
		this.accountStores += 1;
		const fetchedAt = this.now();
		const rows = [
			{key: KEYS.account, json: JSON.stringify(snapshot.account), fetchedAt},
			{key: KEYS.rootMetadata, json: JSON.stringify(snapshot.rootMetadata), fetchedAt},
			{key: KEYS.settings, json: JSON.stringify(snapshot.settings), fetchedAt},
			{key: KEYS.visibleFeatures, json: JSON.stringify(snapshot.visibleFeatures), fetchedAt},
		];
		this.db.transaction((tx) => {
			for (const row of rows) {
				tx.insert(accountState)
					.values(row)
					.onConflictDoUpdate({target: accountState.key, set: {json: row.json, fetchedAt}})
					.run();
			}
		});
	}
}
