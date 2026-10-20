import {and, eq, inArray, like} from "drizzle-orm";
import type {BaseSQLiteDatabase} from "drizzle-orm/sqlite-core";
import {z} from "zod";
import type {CreateMirrorResult} from "../api/workflowy-client.js";
import type {InternalSession, WorkflowyInternalClient} from "../api/workflowy-internal-client.js";
import type {WorkflowyWriteThroughClient} from "../cache/workflowy-write-through-client.js";
import {keptInternalMetadata} from "../cache/importer.js";
import {accountState, nodeContent, nodeInternalMetadata} from "../db/schema.js";
import {FAR_FUTURE_DATE} from "../temporal/constants.js";
import {HOME_TARGET} from "../types/targets.js";
import {hasInternalLink, internalLinkShortIds} from "../workflowy/internal-links.js";
import {uuidToShortId} from "../workflowy/constants.js";
import {
	CALENDAR_LEVELS,
	CalendarRootMissing,
	calendarDateId,
	calendarInsertIndex,
	calendarLevelMetadata,
	calendarLevelName,
	parseDateId,
} from "./calendar-day.js";
import {calendarNodeId} from "./calendar-ids.js";
import {LoggedOut, OperationRejected, TransportError} from "./errors.js";
import {applyMetadataPatches, buildMetadataChanges} from "./metadata-patch.js";
import type {MetadataChange} from "./metadata-patch.js";
import {bulkCreateOp, bulkMoveOp, deleteOp, editOp, moveOp, ROOT_PROJECT_ID, undeleteOp} from "./ops.js";
import type {Location, NewTree} from "./ops.js";
import {PushAndPoll} from "./push-and-poll.js";
import type {InternalOp, PushAndPollOptions} from "./push-and-poll.js";

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
type AdapterDatabase = BaseSQLiteDatabase<"sync", any, any>;

/** Account state older than this is refreshed from the server before a read. */
const FRESHNESS_MS = 30_000;

/** Settings the server stores; every other setting is client-only upstream. */
export type ServerSetting = "show_completed" | "show_keyboard_shortcuts" | "theme" | "font" | "saved_views_json_delta";

const FLAG_SETTINGS = new Set<ServerSetting>(["show_completed", "show_keyboard_shortcuts"]);

export interface Account {
	userId: number;
	joinedAt: Date;
}

const StoredAccountSchema = z.object({userId: z.number(), dateJoinedSec: z.number()});
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

type StoredAccount = z.infer<typeof StoredAccountSchema>;
type Metadata = z.infer<typeof MetadataSchema>;

interface AccountSnapshot {
	account: StoredAccount;
	rootMetadata: Metadata;
	settings: Metadata;
}

const KEYS = {
	account: "account",
	rootMetadata: "root_metadata",
	settings: "settings",
	expandedKeys: "expanded_keys",
	entropyKey: "entropy_key",
} as const;

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

/** Upstream's expansion key for a node: the first 8 chars of its id. */
function expansionKey(id: string): string {
	return id.slice(0, 8);
}

function clampIndex(index: number, length: number): number {
	return Math.min(Math.max(Math.trunc(index), 0), length);
}

export interface CreateAtInput {
	/** The new node's id; generated when absent. */
	id?: string;
	/** A node id, or `HOME`. */
	parentId: string;
	/** 0-based slot among all siblings, completed ones included; clamped to `[0, siblings]`. */
	index: number;
	name: string;
	note?: string;
	metadata?: Record<string, unknown>;
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
	dayId: string;
	/** The day's first child (the empty one created for a new or empty day). */
	firstChildId: string;
	/** Ids created by this call, outermost first. */
	created: string[];
}

export interface MoveToInput {
	ids: string[];
	/** A node id, or `HOME`. */
	parentId: string;
	/**
	 * Insertion slot among the target's current children, moved ones included (counted
	 * BEFORE removal): the nodes land right before the child now at `index`. Among a,b,c,d,
	 * moving b below c is index 3. Clamped to `[0, children]`. The web move endpoints and
	 * client planners use this same contract.
	 */
	index: number;
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
	pushAndPoll?: Omit<PushAndPollOptions, "now">;
	/** The public-API write-through client tree writes refresh the cache through; required for them. */
	writeThrough?: WorkflowyWriteThroughClient;
	/** Ids for created nodes; defaults to `crypto.randomUUID`. */
	generateId?: () => string;
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
 * The internal-API write path behind a purpose-built API. It is the only
 * module that speaks in upstream ops and `/push_and_poll`; callers see account
 * state, root metadata and settings.
 *
 * Account state is cached in `account_state` and refreshed (one initialization
 * GET) when older than 30s, so changes made on workflowy.com show up locally.
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
	private pushedDuringRefresh: Record<string, boolean>[] | undefined;

	constructor(options: WorkflowyInternalAdapterOptions) {
		this.client = options.client;
		this.db = options.db;
		this.now = options.now ?? Date.now;
		this.pusher = new PushAndPoll(options.client, {...options.pushAndPoll, now: this.now});
		this.writeThrough = options.writeThrough;
		this.generateId = options.generateId ?? (() => crypto.randomUUID());
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
			index: clampIndex(input.index, siblings.length),
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
		const items = await this.client.getTreeData();
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
		const tree = this.tree();
		const items = await this.client.getTreeData();
		const metadataOf = (id: string): Metadata | undefined => {
			const item = items.find((candidate) => candidate.id === id);
			return item === undefined ? undefined : (item.metadata ?? {});
		};
		const requested = metadataOf(input.originalId);
		if (requested === undefined) {
			throw new Error(`Cannot mirror ${input.originalId}: it is not in the Workflowy tree`);
		}
		const mirroredOriginal = getPath(requested, ["mirror", "originalId"]);
		const originId = typeof mirroredOriginal === "string" ? mirroredOriginal : input.originalId;
		const originMetadata = metadataOf(originId) ?? {};

		const parent = publicParent(input.parentId);
		const siblings = await tree.liveChildren(parent);
		const session = await this.session();
		const {op: createOp, ids} = bulkCreateOp({
			parentId: internalParent(parent),
			index: clampIndex(input.index, siblings.length),
			trees: [{name: "", metadata: {mirror: {originalId: originId, isMirrorRoot: true}}}],
			userId: session.userId,
			now: this.now(),
			dateJoinedSec: session.dateJoinedSec,
			generateId: this.generateId,
		});
		const [mirrorId] = ids;
		if (mirrorId === undefined) {
			throw new Error("bulk_create produced no id");
		}
		const {patches, inverse} = buildMetadataChanges(originMetadata, [
			{path: ["mirror", "mirrorRootIds", mirrorId], value: true},
		]);
		const linkOp = editOp({
			id: originId,
			metadataPatches: patches,
			metadataInversePatches: inverse,
			now: this.now(),
			dateJoinedSec: session.dateJoinedSec,
		});
		await this.pusher.pushAndPoll({ops: [createOp, linkOp]});
		await tree.refreshChildren([parent]);
		tree.recordMirror(originId, mirrorId);
		return {mirrorId, originId};
	}

	/**
	 * Find or create the `📆 Calendar` day node for a `YYYYMMDD` dateId the way
	 * upstream's Today does (`C9`): for each enabled level, a child whose
	 * calendar metadata (or id) matches is reused; otherwise the deterministic
	 * id `calendarNodeId(entropyKey, level, dateId)` is moved back under the
	 * parent when it exists elsewhere, or created there with
	 * `{restorableUniqueNode, calendar}` metadata at the timestamp-sorted slot.
	 * A new or empty day gets one empty child.
	 */
	async ensureCalendarDay(dateId: number): Promise<EnsuredCalendarDay> {
		const date = parseDateId(dateId);
		if (date === undefined) {
			throw new RangeError(`${dateId} is not a YYYYMMDD date`);
		}
		const root = this.findCalendarRoot();
		if (root.levels.week === true) {
			throw new Error("calendar week levels are not supported");
		}
		const levels = CALENDAR_LEVELS.filter((level) => root.levels[level] ?? true);
		const session = await this.session();
		const dateFormat = await this.getRootMeta(["dateFormat"]);
		const tree = this.tree();
		const created: string[] = [];
		let parentId = root.id;
		for (const level of levels) {
			const levelDateId = calendarDateId(level, date);
			const id =
				session.entropyKey === undefined ? undefined : calendarNodeId(session.entropyKey, level, levelDateId);
			const children = (await tree.liveChildren(parentId)).map((child) => child.id);
			const calendars = children.map((child) => this.readCalendar(child));
			const match = children.find((child, position) => {
				const calendar = calendars[position];
				return child === id || (calendar?.level === level && calendar.dateId === levelDateId);
			});
			if (match !== undefined) {
				parentId = match;
				continue;
			}
			const index = calendarInsertIndex(calendars, level, levelDateId);
			if (id !== undefined && this.isCached(id)) {
				await this.moveTo({ids: [id], parentId, index});
				parentId = id;
				continue;
			}
			const node = await this.createAt({
				parentId,
				index,
				...(id === undefined ? {} : {id}),
				name: calendarLevelName(level, date, typeof dateFormat === "string" ? dateFormat : ""),
				metadata: {restorableUniqueNode: true, calendar: calendarLevelMetadata(level, date)},
			});
			created.push(node.id);
			parentId = node.id;
		}
		let [firstChildId] = (await tree.liveChildren(parentId)).map((child) => child.id);
		if (firstChildId === undefined) {
			firstChildId = (await this.createAt({parentId, index: 0, name: ""})).id;
			created.push(firstChildId);
		}
		return {dayId: parentId, firstChildId, created};
	}

	private findCalendarRoot(): {id: string; levels: Record<string, boolean>} {
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
				return {id: row.nodeId, levels: parsed.data.calendar.levels ?? {}};
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
		const index = clampIndex(input.index, siblings.length);
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
		const linked: string[] = [];
		for (let level = [rootId]; level.length > 0;) {
			const rows = this.db
				.select({id: nodeContent.id, name: nodeContent.name, note: nodeContent.note})
				.from(nodeContent)
				.where(and(inArray(nodeContent.id, level), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
				.all();
			linked.push(
				...rows.filter((row) => hasInternalLink(`${row.name ?? ""} ${row.note ?? ""}`)).map((row) => row.id),
			);
			level = this.db
				.select({id: nodeContent.id})
				.from(nodeContent)
				.where(and(inArray(nodeContent.parentId, level), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
				.all()
				.map((row) => row.id);
		}
		if (linked.length > 0) {
			await this.syncBacklinks(linked);
		}
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
	 */
	async getExpandedIds(): Promise<string[]> {
		const cached = this.loadExpandedKeys();
		let keys: Set<string>;
		if (cached) {
			keys = cached.keys;
			if (cached.fetchedAt < this.now() - FRESHNESS_MS) {
				void this.refreshExpandedKeys().catch((error: unknown) => {
					console.error("Failed to refresh expanded keys", error);
				});
			}
		} else {
			keys = await this.refreshExpandedKeys();
		}
		return this.db
			.select({id: nodeContent.id})
			.from(nodeContent)
			.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
			.orderBy(nodeContent.id)
			.all()
			.map(({id}) => id)
			.filter((id) => keys.has(expansionKey(id)));
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
		const expansionsDelta = Object.fromEntries(entries.map(([id, expanded]) => [expansionKey(id), expanded]));
		await this.pusher.pushAndPoll({expansionsDelta});
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

	async getAccount(): Promise<Account> {
		const {account} = await this.snapshot();
		return {userId: account.userId, joinedAt: new Date(account.dateJoinedSec * 1000)};
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
	}

	/** The cached account state, refreshed first when missing or older than 30s. */
	private async snapshot(): Promise<AccountSnapshot> {
		const cached = this.load();
		if (cached) {
			return cached;
		}
		const fresh = this.fromSession(await this.client.bootstrap());
		this.store(fresh);
		return fresh;
	}

	private fromSession(session: InternalSession): AccountSnapshot {
		return {
			account: {userId: session.userId, dateJoinedSec: session.dateJoinedSec},
			rootMetadata: session.rootMetadata,
			settings: session.settings,
		};
	}

	private load(): AccountSnapshot | undefined {
		const rows = this.db.select().from(accountState).all();
		const byKey = new Map(rows.map((row) => [row.key, row]));
		const oldestAllowed = this.now() - FRESHNESS_MS;
		const read = <T>(key: string, schema: z.ZodType<T>): T | undefined => {
			const row = byKey.get(key);
			return row && row.fetchedAt >= oldestAllowed ? schema.safeParse(JSON.parse(row.json)).data : undefined;
		};
		const account = read(KEYS.account, StoredAccountSchema);
		const rootMetadata = read(KEYS.rootMetadata, MetadataSchema);
		const settings = read(KEYS.settings, MetadataSchema);
		if (!account || !rootMetadata || !settings) {
			return undefined;
		}
		return {account, rootMetadata, settings};
	}

	private store(snapshot: AccountSnapshot): void {
		const fetchedAt = this.now();
		const rows = [
			{key: KEYS.account, json: JSON.stringify(snapshot.account), fetchedAt},
			{key: KEYS.rootMetadata, json: JSON.stringify(snapshot.rootMetadata), fetchedAt},
			{key: KEYS.settings, json: JSON.stringify(snapshot.settings), fetchedAt},
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
