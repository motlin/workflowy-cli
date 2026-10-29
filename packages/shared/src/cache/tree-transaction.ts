import {eq} from "drizzle-orm";
import type {BaseSQLiteDatabase} from "drizzle-orm/sqlite-core";
import {z} from "zod";
import {accountState} from "../db/schema.js";

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
type Database = BaseSQLiteDatabase<"sync", any, any>;

/**
 * `account_state` key of the main tree's transaction id the cache is current
 * to: the edge tables match upstream as of this transaction, and every
 * `/push_and_poll` starts from it.
 */
export const TREE_TX_ID_KEY = "tree_tx_id";

/** `account_state` key of the expanded-node keys (first 8 chars of each id), a sorted JSON array. */
export const EXPANDED_KEYS_KEY = "expanded_keys";

/** The stored tree transaction id, or undefined before the first whole-tree import. */
export function readTreeTxId(database: Database): string | undefined {
	const row = database.select().from(accountState).where(eq(accountState.key, TREE_TX_ID_KEY)).get();
	return row === undefined ? undefined : z.string().parse(JSON.parse(row.json));
}

function write(database: Database, key: string, value: unknown, fetchedAt: number): void {
	const json = JSON.stringify(value);
	database
		.insert(accountState)
		.values({key, json, fetchedAt})
		.onConflictDoUpdate({target: accountState.key, set: {json, fetchedAt}})
		.run();
}

/** Replace the stored tree transaction id, as a whole-tree import does. */
export function replaceTreeTxId(database: Database, txId: string, fetchedAt: number): void {
	write(database, TREE_TX_ID_KEY, txId, fetchedAt);
}

/**
 * Store `txId` unless the stored id is already larger. Only ids the server
 * returned are ever stored, so with CLI and web processes sharing one cache
 * the larger id is always the later point in the tree's log.
 */
export function advanceTreeTxId(database: Database, txId: string, fetchedAt: number): void {
	database.transaction((tx) => {
		const current = readTreeTxId(tx);
		if (current === undefined || BigInt(txId) > BigInt(current)) {
			write(tx, TREE_TX_ID_KEY, txId, fetchedAt);
		}
	});
}

/** Replace the stored expanded keys. */
export function storeExpandedKeys(database: Database, keys: Iterable<string>, fetchedAt: number): void {
	write(database, EXPANDED_KEYS_KEY, [...new Set(keys)].toSorted(), fetchedAt);
}
