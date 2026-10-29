import {formatTemporalTimestamp} from "../temporal/constants.js";

/**
 * The system time for one unit of work: the application's UTC clock, read once.
 * Following Reladomo's per-transaction processing time, every `system_from` and
 * `system_to` a unit writes takes this one value, even when the unit spans
 * several transactions. Two units may share a millisecond and need not be
 * monotonic: a unit that lands after another but read the clock earlier is
 * normal. {@link closeCurrentVersions} handles a unit closing a version stamped
 * at its own millisecond.
 */
export function newSystemTime(): Date {
	return new Date(Date.now());
}

/** {@link newSystemTime} formatted for a `system_from`/`system_to` column. */
export function newSystemTimestamp(): string {
	return formatTemporalTimestamp(newSystemTime());
}
