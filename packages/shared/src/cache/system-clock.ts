import {sql} from 'drizzle-orm';
import type {BaseSQLiteDatabase} from 'drizzle-orm/sqlite-core';
import {systemClock} from '../db/schema.js';
import {formatTemporalTimestamp} from '../temporal/constants.js';

/** A database or transaction that can advance the system clock. */
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
type ClockDatabase = BaseSQLiteDatabase<'sync', any, any>;

/**
 * The system time for a new temporal version: `Date.now()`, or one millisecond
 * after the last system time any writer issued, whichever is later. Versions are
 * keyed by (id, systemFrom) at millisecond precision, so two writes within one
 * millisecond would otherwise collide. The last issued time lives in the
 * database and advances in a single statement, so the order holds across cache
 * instances, connections and processes sharing one file. Call it inside the
 * write's transaction so the times also follow commit order.
 */
export function nextSystemTime(database: ClockDatabase): Date {
	const {lastMs} = database
		.update(systemClock)
		.set({lastMs: sql`max(${Date.now()}, ${systemClock.lastMs} + 1)`})
		.returning({lastMs: systemClock.lastMs})
		.get()!;
	return new Date(lastMs);
}

/** {@link nextSystemTime} formatted for a `system_from`/`system_to` column. */
export function nextSystemTimestamp(database: ClockDatabase): string {
	return formatTemporalTimestamp(nextSystemTime(database));
}
