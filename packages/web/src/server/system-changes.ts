/**
 * Which cached rows changed since a system time, for caches that patch themselves after a write
 * instead of reloading the whole tree. Every cache write versions rows bitemporally: it opens a row
 * at its system time and closes the replaced one at the same time, so the rows a write touched are
 * exactly those with `system_from` or a closing `system_to` after the cache's last system time.
 */

import {FAR_FUTURE_DATE, formatTemporalTimestamp} from "@workflowy/shared/temporal";
import {sql} from "drizzle-orm";
import type {SQL} from "drizzle-orm";
import type {AppDatabase} from "@workflowy/shared/db";
import BetterSqlite3 from "better-sqlite3";

type Database = AppDatabase;

/** Step 3 removes this `$client` coupling; until then the Node server's database is a better-sqlite3 one. */
function clientOf(database: AppDatabase): BetterSqlite3.Database {
	if (!("$client" in database) || !(database.$client instanceof BetterSqlite3)) {
		throw new Error("The database has no better-sqlite3 client");
	}
	return database.$client;
}

/**
 * How far before a cache's last system time to look again for changes. A writer in another process can
 * take its system time before it commits, so a cache built between the two would otherwise miss that write.
 * Re-reading a few seconds of changes is cheap and patching a row twice is harmless.
 */
const LOOKBACK_MS = 5000;

/**
 * Closed rows, as a literal so the partial `*_closed_at_idx` indexes (whose WHERE is this same term) apply;
 * SQLite matches a partial index's WHERE only against literal terms, never bound parameters.
 */
const CLOSED = sql.raw(`system_to < '${FAR_FUTURE_DATE}'`);

/** The newest system time any node, metadata, mirror, references-root or AI-metadata row was opened or closed at. */
export function latestSystemTime(database: Database): string {
	const tables = ["node_content", "node_metadata", "mirrors", "references_roots", "ai_metadata"].map(
		(table) => sql`
			SELECT max(system_from) AS at FROM ${sql.identifier(table)}
			UNION ALL SELECT max(system_to) FROM ${sql.identifier(table)} WHERE ${CLOSED}
		`,
	);
	const {at} = database.get<{at: string | null}>(
		sql`SELECT max(at) AS at FROM (${sql.join(tables, sql` UNION ALL `)})`,
	);
	return at ?? "";
}

/** The system time to read changes from for a cache built at `latest`. */
export function changesSince(latest: string): string {
	const ms = Date.parse(`${latest.replace(" ", "T")}Z`);
	return Number.isNaN(ms) ? "" : formatTemporalTimestamp(new Date(ms - LOOKBACK_MS));
}

/**
 * The ids of `table` rows opened or closed after `since`, possibly repeated. UNION ALL keeps each leg a range
 * seek on its system-time index; a deduplicating UNION lets newer SQLite plan a merge over a full key scan.
 */
function changedIn(table: string, column: string, since: string): SQL {
	const name = sql.identifier(table);
	const id = sql.identifier(column);
	return sql`
		SELECT ${id} AS id FROM ${name} WHERE system_from > ${since}
		UNION ALL SELECT ${id} FROM ${name} WHERE ${CLOSED} AND system_to > ${since}
	`;
}

/** The distinct ids `query` returns, or undefined when it returns more than `limit` rows. */
function distinctIds(database: Database, query: SQL, limit: number): Set<string> | undefined {
	const rows = database.all<{id: string}>(sql`${query} LIMIT ${limit + 1}`);
	return rows.length > limit ? undefined : new Set(rows.map(({id}) => id));
}

/**
 * Ids of nodes whose search row may have changed after `since`, or undefined when more than `limit` did:
 * changed content, metadata, mirror links, references roots or AI metadata, plus live mirrors of a changed original
 * (a mirror shows its original's text).
 */
export function changedNodeIds(database: Database, since: string, limit: number): Set<string> | undefined {
	return distinctIds(
		database,
		sql`
			WITH content(id) AS (${changedIn("node_content", "id", since)})
			SELECT id FROM content
			UNION ALL SELECT mirror_id FROM mirrors
				WHERE system_to = ${FAR_FUTURE_DATE} AND original_id IN (SELECT id FROM content)
			UNION ALL ${changedIn("node_metadata", "node_id", since)}
			UNION ALL ${changedIn("mirrors", "mirror_id", since)}
			UNION ALL ${changedIn("references_roots", "node_id", since)}
			UNION ALL ${changedIn("ai_metadata", "node_id", since)}
		`,
		limit,
	);
}

/** Run `read` in one transaction, so every query in it sees the same committed state. */
export function readConsistently<T>(database: Database, read: () => T): T {
	return clientOf(database).transaction(read)();
}
