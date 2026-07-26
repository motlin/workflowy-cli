import {and, eq, type SQL, sql} from 'drizzle-orm';
import type {SQLiteColumn, SQLiteTable} from 'drizzle-orm/sqlite-core';
import {FAR_FUTURE_DATE} from '../temporal/index.js';

/**
 * Batch size for bulk insert/phase-out operations.
 * Balances memory use against round-trip count, and keeps `sql.join()` argument
 * lists short enough to avoid a stack overflow when joining thousands of items.
 */
const BULK_BATCH_SIZE = 1000;

/**
 * Separator for composite merge keys. ASCII unit separator (U+001F) — a control
 * character that cannot appear in a Workflowy id, so joined keys never collide
 * (unlike ad-hoc `:` / `|` separators). Composite-key callers must build their
 * `incomingKey`/`currentKey` with {@link joinKey} so they match the SQL-side
 * concatenation used for phase-out.
 */
const KEY_SEP = '\u001F';

/** Join key parts with the composite-key separator. */
export function joinKey(...parts: string[]): string {
	return parts.join(KEY_SEP);
}

/** SQL expression concatenating the key columns with {@link KEY_SEP}. */
function keyExpression(columns: SQLiteColumn[]): SQL {
	let expr: SQL = sql`${columns[0]}`;
	for (let i = 1; i < columns.length; i++) {
		expr = sql`${expr} || ${KEY_SEP} || ${columns[i]}`;
	}
	return expr;
}

/**
 * Result of a {@link temporalMerge} call.
 */
export interface TemporalMergeResult {
	/** Rows inserted as new current versions (new keys + changed keys). */
	inserted: number;
	/** Current rows whose `systemTo` was closed (changed keys + removed keys). */
	phasedOut: number;
	/** Current rows left untouched because their content was identical. */
	unchanged: number;
}

/**
 * Configuration describing how a single temporal table is merged.
 */
export interface TemporalMergeConfig<TIncoming, TCurrent> {
	/**
	 * The Drizzle table to merge into. Must have `system_from` / `system_to`
	 * text columns following the project's temporal convention.
	 */
	table: SQLiteTable;
	/**
	 * Column(s) on `table` used to phase out current rows by key. For a
	 * single-column natural key, pass the id column as `keyColumn` (e.g.
	 * `nodeContent.id`). For a composite natural key (e.g. `mirrors` keyed by
	 * `(originalId, mirrorId)`), pass `keyColumns` and build `incomingKey`/
	 * `currentKey` with {@link joinKey}. Exactly one of the two must be set.
	 */
	keyColumn?: SQLiteColumn;
	keyColumns?: SQLiteColumn[];
	/**
	 * The `system_to` column on `table`. Phase-out filters and the closing
	 * update target this column.
	 */
	systemToColumn: SQLiteColumn;
	/**
	 * Extracts the merge key from an incoming desired-state row.
	 */
	incomingKey: (row: TIncoming) => string;
	/**
	 * Extracts the merge key from a current row loaded from the database.
	 */
	currentKey: (row: TCurrent) => string;
	/**
	 * Returns true when an incoming row's content is unchanged relative to the
	 * matching current row. When true, the current row is left alone; when
	 * false, the current row is phased out and a new version inserted.
	 */
	contentMatches: (current: TCurrent, incoming: TIncoming) => boolean;
	/**
	 * Builds the row to insert for a new or changed incoming row. The returned
	 * object must NOT include `systemFrom` / `systemTo`; those are appended by
	 * the merge engine.
	 */
	// oxlint-disable-next-line @typescript-eslint/no-explicit-any
	buildInsertRow: (incoming: TIncoming) => Record<string, any>;
	/**
	 * Keys that must never be phased out for being absent from `incoming`.
	 *
	 * A backup snapshot only testifies to the state of the tree at the moment it
	 * was taken, so it cannot prove that a node written after that moment was
	 * deleted. Callers importing an older snapshot pass those newer keys here to
	 * keep them open. A preserved key that *is* present in `incoming` follows the
	 * normal content-comparison path.
	 */
	preserveKeys?: ReadonlySet<string>;
}

/**
 * A Drizzle transaction handle. The import services pass `tx` from
 * `database.transaction(...)`; typing it loosely keeps this engine agnostic of
 * the concrete schema generic on `BetterSQLite3Database`.
 */
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
export type TemporalTransaction = any;

/**
 * Insert phase-out keys into the `temp_phase_out_ids` scratch table in batches.
 * Batching avoids a stack overflow inside `sql.join()` for large key sets.
 */
function batchInsertPhaseOutKeys(tx: TemporalTransaction, keys: string[]): void {
	tx.run(sql`DELETE FROM temp_phase_out_ids`);
	for (let i = 0; i < keys.length; i += BULK_BATCH_SIZE) {
		const batch = keys.slice(i, i + BULK_BATCH_SIZE);
		const values = batch.map((key) => sql`(${key})`);
		tx.run(sql`INSERT INTO temp_phase_out_ids (node_id) VALUES ${sql.join(values, sql`, `)}`);
	}
}

/**
 * Apply the temporal merge-list pattern to a single table.
 *
 * Given the desired set of current rows (`incoming`) and a `systemFrom`
 * timestamp, this:
 *
 *   - phases out current rows whose content changed (sets `system_to = importedAt`),
 *   - phases out current rows that are absent from `incoming` (deletions),
 *   - inserts new current versions for new and changed rows
 *     (`system_from = importedAt`, `system_to = FAR_FUTURE_DATE`),
 *   - leaves unchanged rows untouched (no new temporal version).
 *
 * The caller is responsible for opening the transaction. This function expects
 * the current rows for the table to already be loaded into `currentRows`
 * (callers typically need them for other bookkeeping anyway), so it performs no
 * SELECT of its own.
 *
 * @param tx          Active Drizzle transaction.
 * @param config      Table-specific merge configuration.
 * @param incoming    Desired-state rows.
 * @param currentRows Current (active) rows already loaded from the table.
 * @param importedAt  Temporal timestamp string for this import.
 */
export function temporalMerge<TIncoming, TCurrent>(
	tx: TemporalTransaction,
	config: TemporalMergeConfig<TIncoming, TCurrent>,
	incoming: TIncoming[],
	currentRows: TCurrent[],
	importedAt: string,
): TemporalMergeResult {
	const {
		table,
		keyColumn,
		keyColumns,
		systemToColumn,
		incomingKey,
		currentKey,
		contentMatches,
		buildInsertRow,
		preserveKeys,
	} = config;
	const columns = keyColumns ?? (keyColumn ? [keyColumn] : []);
	const keyMatchExpr = keyExpression(columns);

	const currentByKey = new Map<string, TCurrent>();
	for (const row of currentRows) {
		currentByKey.set(currentKey(row), row);
	}

	const incomingKeys = new Set<string>();
	const keysToPhaseOut: string[] = [];
	// oxlint-disable-next-line @typescript-eslint/no-explicit-any
	const rowsToInsert: Array<Record<string, any>> = [];
	let unchanged = 0;

	for (const row of incoming) {
		const key = incomingKey(row);
		incomingKeys.add(key);

		const current = currentByKey.get(key);
		if (current !== undefined && contentMatches(current, row)) {
			unchanged++;
			continue;
		}

		// New key, or changed key: insert a new current version. A changed key
		// also needs its old current row phased out.
		if (current !== undefined) {
			keysToPhaseOut.push(key);
		}
		rowsToInsert.push({
			...buildInsertRow(row),
			systemFrom: importedAt,
			systemTo: FAR_FUTURE_DATE,
		});
	}

	let phasedOut = keysToPhaseOut.length;
	for (const key of currentByKey.keys()) {
		if (!incomingKeys.has(key) && !preserveKeys?.has(key)) {
			keysToPhaseOut.push(key);
			phasedOut++;
		}
	}

	tx.run(sql`CREATE TEMP TABLE IF NOT EXISTS temp_phase_out_ids (node_id TEXT PRIMARY KEY)`);

	if (keysToPhaseOut.length > 0) {
		batchInsertPhaseOutKeys(tx, keysToPhaseOut);
		tx.update(table)
			.set({systemTo: importedAt})
			.where(
				and(
					eq(systemToColumn, FAR_FUTURE_DATE),
					sql`${keyMatchExpr} IN (SELECT node_id FROM temp_phase_out_ids)`,
				),
			)
			.run();
	}

	for (let i = 0; i < rowsToInsert.length; i += BULK_BATCH_SIZE) {
		const batch = rowsToInsert.slice(i, i + BULK_BATCH_SIZE);
		if (batch.length > 0) {
			tx.insert(table).values(batch).run();
		}
	}

	return {inserted: rowsToInsert.length, phasedOut, unchanged};
}
