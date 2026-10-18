import {eq} from "drizzle-orm";
import type {BaseSQLiteDatabase} from "drizzle-orm/sqlite-core";
import {z} from "zod";
import type {InternalSession, WorkflowyInternalClient} from "../api/workflowy-internal-client.js";
import type {WorkflowyWriteThroughClient} from "../cache/workflowy-write-through-client.js";
import {keptInternalMetadata} from "../cache/importer.js";
import {accountState, nodeInternalMetadata} from "../db/schema.js";
import {LoggedOut, OperationRejected, TransportError} from "./errors.js";
import {applyMetadataPatches, buildMetadataPatches} from "./metadata-patch.js";
import {bulkCreateOp, bulkMoveOp, editOp, moveOp, ROOT_PROJECT_ID, undeleteOp} from "./ops.js";
import type {Location, NewTree} from "./ops.js";
import {PushAndPoll} from "./push-and-poll.js";
import type {PushAndPollOptions} from "./push-and-poll.js";

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

type StoredAccount = z.infer<typeof StoredAccountSchema>;
type Metadata = z.infer<typeof MetadataSchema>;

interface AccountSnapshot {
	account: StoredAccount;
	rootMetadata: Metadata;
	settings: Metadata;
}

const KEYS = {account: "account", rootMetadata: "root_metadata", settings: "settings"} as const;

/** The id callers pass for Home (the root) in tree writes. */
export const HOME = "home";

/** Home is `null` to the public API and the cache. */
type PublicParent = string | null;

function publicParent(id: string): PublicParent {
	return id === HOME ? null : id;
}

function internalParent(parent: PublicParent): string {
	return parent ?? ROOT_PROJECT_ID;
}

function clampIndex(index: number, length: number): number {
	return Math.min(Math.max(Math.trunc(index), 0), length);
}

export interface CreateAtInput {
	/** A node id, or `HOME`. */
	parentId: string;
	/** 0-based slot among all siblings, completed ones included; clamped to `[0, siblings]`. */
	index: number;
	name: string;
	note?: string;
	metadata?: Record<string, unknown>;
}

export interface MoveToInput {
	ids: string[];
	/** A node id, or `HOME`. */
	parentId: string;
	/** Insertion slot among the target's current children, moved ones included; clamped to `[0, children]`. */
	index: number;
}

export interface RestoreInput {
	id: string;
	/** A node id, or `HOME`. Without it the node goes back where it was deleted from. */
	parentId?: string;
	/** Slot under `parentId`; defaults to the bottom. */
	index?: number;
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
		await tree.refreshChildren([parent]);
		const [id] = ids;
		if (id === undefined) {
			throw new Error("bulk_create produced no id");
		}
		return {id};
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
	 */
	async restore(input: RestoreInput): Promise<void> {
		const tree = this.tree();
		if (input.parentId === undefined) {
			await this.session();
			await this.postOk(`/trash/restore/${input.id}/`, new URLSearchParams(), true);
			const restored = await tree.liveNode(input.id);
			await tree.refreshChildren([restored.parent_id ?? null]);
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
		await tree.refreshChildren([parent]);
	}

	/**
	 * Set (or, with `undefined`, remove) a node's metadata value at `path` with
	 * one `edit`; `HOME` goes to {@link setRootMeta}. Patches are built against
	 * the node's fresh public-API `data` (which carries only keys such as
	 * `layoutMode`) overlaid with its cached internal metadata, and once the
	 * server accepts the edit the patched result is written back to
	 * `node_internal_metadata`.
	 */
	async setNodeMeta(id: string, path: string[], value: unknown): Promise<void> {
		if (id === HOME) {
			await this.setRootMeta(path, value);
			return;
		}
		const tree = this.tree();
		const node = await tree.liveNode(id);
		const base = {...node.data, ...this.readNodeMetadata(id)};
		const {patches, inverse} = buildMetadataPatches(base, path, value);
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

	async getAccount(): Promise<Account> {
		const {account} = await this.snapshot();
		return {userId: account.userId, joinedAt: new Date(account.dateJoinedSec * 1000)};
	}

	/** The root (Home) metadata value at `path`; the whole object for an empty path. */
	async getRootMeta(path: string[]): Promise<unknown> {
		return getPath((await this.snapshot()).rootMetadata, path);
	}

	/**
	 * Set (or, with `undefined`, remove) the root metadata value at `path`:
	 * refresh, build patches against the fresh metadata, push one edit, then
	 * cache the patched metadata.
	 */
	async setRootMeta(path: string[], value: unknown): Promise<void> {
		const session = await this.client.bootstrap();
		const fresh = this.fromSession(session);
		const {patches, inverse} = buildMetadataPatches(fresh.rootMetadata, path, value);
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
