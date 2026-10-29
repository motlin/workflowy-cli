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
 * Every change advances a high-water mark, so a client polls for "changed after my mark" instead of the whole set.
 * The keys live in one `account_state` row today (its `fetched_at` is the mark); only this module touches that row,
 * so moving the storage elsewhere stays local to it.
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
 * Store `keys` with a mark later than the stored one: `at`, or one past the stored mark when `at` is not later
 * (clock skew between the CLI and web processes sharing the cache), so a poller never misses a change.
 */
function write(database: Database, keys: Iterable<string>, at: number): number {
	const previous = readExpansion(database)?.mark;
	const mark = previous === undefined ? at : Math.max(at, previous + 1);
	const json = JSON.stringify([...new Set(keys)].toSorted());
	database
		.insert(accountState)
		.values({key: EXPANDED_KEYS_KEY, json, fetchedAt: mark})
		.onConflictDoUpdate({target: accountState.key, set: {json, fetchedAt: mark}})
		.run();
	return mark;
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
