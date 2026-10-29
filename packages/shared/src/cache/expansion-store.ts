import {eq} from "drizzle-orm";
import type {BaseSQLiteDatabase} from "drizzle-orm/sqlite-core";
import {z} from "zod";
import {accountState} from "../db/schema.js";

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
type Database = BaseSQLiteDatabase<"sync", any, any>;

/**
 * Our store of the account's expanded-node keys (the first 8 chars of each id, plus `v_` mirror-instance and
 * `leftbar__` keys), the source of truth for expansion. A whole-tree import seeds it and every local change applies
 * to it; nothing re-reads workflowy.com's list on a request path.
 *
 * Each change records its unit of work's own time as the mark. Times may repeat or go backward (the CLI and web
 * processes share the cache on separate clocks), so a poller compares content versions ({@link expansionVersion}),
 * never marks. The keys live in one `account_state` row today (its `fetched_at` is the mark); only this module touches
 * that row, so moving the storage elsewhere stays local to it.
 */
export const EXPANDED_KEYS_KEY = "expanded_keys";

/** The stored keys and the mark of their last change. */
export interface StoredExpansion {
	keys: Set<string>;
	mark: number;
}

const KeysSchema = z.array(z.string());

/** The stored keys, or undefined before any import seeded them. */
export function readExpansion(database: Database): StoredExpansion | undefined {
	const row = database.select().from(accountState).where(eq(accountState.key, EXPANDED_KEYS_KEY)).get();
	const keys = row && KeysSchema.safeParse(JSON.parse(row.json)).data;
	return row && keys ? {keys: new Set(keys), mark: row.fetchedAt} : undefined;
}

/**
 * A version of `keys` that changes exactly when their content does, whatever the change times: a change feed's
 * cursor, since two changes may share a timestamp or land out of order.
 */
export function expansionVersion(keys: ReadonlySet<string>): string {
	return hash64(canonicalJson(keys));
}

/**
 * A 64-bit string hash (cyrb53's mixing, both 32-bit halves kept) as 16 hex chars. Synchronous and free of Node
 * builtins, since the browser bundle reaches this module.
 */
function hash64(text: string): string {
	let h1 = 0xde_ad_be_ef;
	let h2 = 0x41_c6_ce_57;
	for (let index = 0; index < text.length; index++) {
		const code = text.codePointAt(index) ?? 0;
		h1 = Math.imul(h1 ^ code, 2_654_435_761);
		h2 = Math.imul(h2 ^ code, 1_597_334_677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
	return [h2, h1].map((half) => (half >>> 0).toString(16).padStart(8, "0")).join("");
}

function canonicalJson(keys: Iterable<string>): string {
	return JSON.stringify([...new Set(keys)].toSorted());
}

/** Store `keys` marked with `at`, the unit of work's own time. */
function write(database: Database, keys: Iterable<string>, at: number): number {
	const json = canonicalJson(keys);
	database
		.insert(accountState)
		.values({key: EXPANDED_KEYS_KEY, json, fetchedAt: at})
		.onConflictDoUpdate({target: accountState.key, set: {json, fetchedAt: at}})
		.run();
	return at;
}

/** Replace the stored keys, as a whole-tree import does; returns the new mark. */
export function replaceExpansion(database: Database, keys: Iterable<string>, at: number): number {
	return database.transaction((tx) => write(tx, keys, at));
}

/**
 * Apply an expansion delta (`true` adds a key, `false` removes it) to the stored keys and return the result; an
 * unseeded store stays unseeded (undefined), since a partial set would read as the whole account's.
 */
export function applyExpansionDelta(
	database: Database,
	delta: Record<string, boolean>,
	at: number,
): StoredExpansion | undefined {
	return database.transaction((tx) => {
		const stored = readExpansion(tx);
		return stored === undefined ? undefined : writeDelta(tx, stored.keys, delta, at);
	});
}

function writeDelta(
	database: Database,
	stored: Set<string>,
	delta: Record<string, boolean>,
	at: number,
): StoredExpansion {
	const keys = new Set(stored);
	for (const [key, expanded] of Object.entries(delta)) {
		if (expanded) {
			keys.add(key);
		} else {
			keys.delete(key);
		}
	}
	return {keys, mark: write(database, keys, at)};
}
