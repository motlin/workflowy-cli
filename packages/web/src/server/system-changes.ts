/**
 * Which cached rows changed since a system time, for caches that patch themselves after a write
 * instead of reloading the whole tree. Every cache write versions rows bitemporally: it opens a row
 * at its system time and closes the replaced one at the same time, so the rows a write touched are
 * exactly those with `system_from` or a closing `system_to` after the cache's last system time.
 */

import {FAR_FUTURE_DATE, formatTemporalTimestamp} from "@workflowy/shared/temporal";
import {sql} from "drizzle-orm";
import type {SQL} from "drizzle-orm";
import {nodeChangeLog} from "@workflowy/shared/db";
import type {AppDatabase} from "@workflowy/shared/db";

type Database = AppDatabase;

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

/**
 * The newest system time any node, metadata, mirror, references-root or AI-metadata row was opened or closed at.
 * One query per table and column: a Durable Object's SQLite rejects compound selects with more than a few terms.
 */
export function latestSystemTime(database: Database): string {
	let latest = "";
	for (const table of ["node_content", "node_metadata", "mirrors", "references_roots", "ai_metadata"]) {
		const name = sql.identifier(table);
		const {opened, closed} = database.get<{opened: string | null; closed: string | null}>(sql`
			SELECT
				(SELECT max(system_from) FROM ${name}) AS opened,
				(SELECT max(system_to) FROM ${name} WHERE ${CLOSED}) AS closed
		`);
		for (const at of [opened, closed]) {
			if (at !== null && at > latest) {
				latest = at;
			}
		}
	}
	return latest;
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

/**
 * Ids of nodes whose search row may have changed after `since`, or undefined when more than `limit` did:
 * changed content, metadata, mirror links, references roots or AI metadata, plus live mirrors of a changed original
 * (a mirror shows its original's text). Each leg is its own query, because a Durable Object's SQLite rejects
 * compound selects with more than a few terms.
 */
export function changedNodeIds(database: Database, since: string, limit: number): Set<string> | undefined {
	const ids = new Set<string>();
	const collect = (query: SQL): boolean => {
		const rows = database.all<{id: string}>(sql`${query} LIMIT ${limit + 1}`);
		for (const {id} of rows) {
			ids.add(id);
		}
		return rows.length <= limit && ids.size <= limit;
	};
	const content = changedIn("node_content", "id", since);
	return collect(content) &&
		collect(sql`
			WITH content(id) AS (${content})
			SELECT mirror_id AS id FROM mirrors
			WHERE system_to = ${FAR_FUTURE_DATE} AND original_id IN (SELECT id FROM content)
		`) &&
		collect(changedIn("node_metadata", "node_id", since)) &&
		collect(changedIn("mirrors", "mirror_id", since)) &&
		collect(changedIn("references_roots", "node_id", since)) &&
		collect(changedIn("ai_metadata", "node_id", since))
		? ids
		: undefined;
}

/** Run `read` in one transaction, so every query in it sees the same committed state. */
export function readConsistently<T>(database: Database, read: () => T): T {
	return database.transaction(() => read());
}

/**
 * The nodes changes feed's cursor: the newest `node_change_log` seq, "0" before any change. Unlike a system time it
 * is exact: SQLite runs one write transaction at a time and triggers assign seqs inside it, so a reader that has seen
 * seq N has seen every change at or below N, however the changes' system times repeat or interleave.
 */
export function latestChangeSeq(database: Database): string {
	const {seq} = database.get<{seq: number | null}>(
		sql`SELECT max(${nodeChangeLog.seq}) AS seq FROM ${nodeChangeLog}`,
	);
	return String(seq ?? 0);
}

/** What changed after a {@link latestChangeSeq} cursor. */
export interface ChangesAfter {
	/** The changed node ids, plus live mirrors of a changed original (a mirror shows its original's text). */
	ids: Set<string>;
	/** The parents changed node_content rows had before they closed: what a move or delete left. */
	formerParents: Set<string | null>;
}

/**
 * {@link ChangesAfter} the cursor `after`, or undefined when the client must refetch everything instead: the cursor is
 * not one this database issued (unparsable, or past its newest seq), the log was pruned past it, or more than `limit`
 * nodes changed.
 */
export function changesAfter(database: Database, after: string, limit: number): ChangesAfter | undefined {
	const cursor = /^\d+$/u.test(after) ? Number(after) : Number.NaN;
	const {oldest, newest} = database.get<{oldest: number | null; newest: number | null}>(
		sql`SELECT min(${nodeChangeLog.seq}) AS oldest, max(${nodeChangeLog.seq}) AS newest FROM ${nodeChangeLog}`,
	);
	if (Number.isNaN(cursor) || cursor > (newest ?? 0) || (oldest !== null && cursor < oldest - 1)) {
		return undefined;
	}
	const changed = sql`SELECT DISTINCT ${nodeChangeLog.nodeId} AS node_id FROM ${nodeChangeLog} WHERE ${nodeChangeLog.seq} > ${cursor}`;
	const ids = new Set<string>();
	for (const query of [
		changed,
		sql`
			SELECT mirror_id AS node_id FROM mirrors
			WHERE system_to = ${FAR_FUTURE_DATE} AND original_id IN (${changed})
		`,
	]) {
		for (const {node_id} of database.all<{node_id: string}>(sql`${query} LIMIT ${limit + 1}`)) {
			ids.add(node_id);
		}
		if (ids.size > limit) {
			return undefined;
		}
	}
	const former = database.all<{parent_id: string | null}>(sql`
		SELECT DISTINCT ${nodeChangeLog.parentId} AS parent_id FROM ${nodeChangeLog}
		WHERE ${nodeChangeLog.seq} > ${cursor} AND ${nodeChangeLog.leftParent} = 1
	`);
	return {ids, formerParents: new Set(former.map((row) => row.parent_id))};
}

/** Each live node of `ids` with its current parent (null: Home), in one query: the id set is one JSON parameter. */
export function liveParents(database: Database, ids: readonly string[]): Map<string, string | null> {
	const live = database.all<{id: string; parent_id: string | null}>(sql`
		SELECT id, parent_id FROM node_content
		WHERE system_to = ${FAR_FUTURE_DATE} AND id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))
	`);
	return new Map(live.map((row) => [row.id, row.parent_id]));
}
