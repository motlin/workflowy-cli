import type {BaseSQLiteDatabase} from "drizzle-orm/sqlite-core";
import {z} from "zod";
import type {InternalSession, WorkflowyInternalClient} from "../api/workflowy-internal-client.js";
import {accountState} from "../db/schema.js";
import {LoggedOut, TransportError} from "./errors.js";
import {applyMetadataPatches, buildMetadataPatches} from "./metadata-patch.js";
import {editOp, ROOT_PROJECT_ID} from "./ops.js";
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

type StoredAccount = z.infer<typeof StoredAccountSchema>;
type Metadata = z.infer<typeof MetadataSchema>;

interface AccountSnapshot {
	account: StoredAccount;
	rootMetadata: Metadata;
	settings: Metadata;
}

const KEYS = {account: "account", rootMetadata: "root_metadata", settings: "settings"} as const;

export interface WorkflowyInternalAdapterOptions {
	client: WorkflowyInternalClient;
	db: AdapterDatabase;
	/** Defaults to `Date.now`; drives both cache freshness and op timestamps. */
	now?: () => number;
	pushAndPoll?: Omit<PushAndPollOptions, "now">;
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
 */
export class WorkflowyInternalAdapter {
	private readonly client: WorkflowyInternalClient;
	private readonly db: AdapterDatabase;
	private readonly now: () => number;
	private readonly pusher: PushAndPoll;

	constructor(options: WorkflowyInternalAdapterOptions) {
		this.client = options.client;
		this.db = options.db;
		this.now = options.now ?? Date.now;
		this.pusher = new PushAndPoll(options.client, {...options.pushAndPoll, now: this.now});
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
		const session = this.client.session ?? (await this.client.bootstrap());
		const wireValue = typeof value === "boolean" ? (value ? "yes" : "no") : value;
		const form = new URLSearchParams({[name]: wireValue, clientId: session.clientId});
		let response: Response;
		try {
			response = await this.client.postForm("/change_settings", form);
		} catch (error) {
			throw new TransportError("POST /change_settings failed", {cause: error});
		}
		if (response.status >= 300 && response.status < 400) {
			throw new LoggedOut(`redirect to ${response.headers.get("location") ?? "unknown"}`);
		}
		if (!response.ok) {
			throw new TransportError(`POST /change_settings returned ${response.status} ${response.statusText}`);
		}
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
