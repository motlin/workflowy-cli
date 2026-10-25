/**
 * The 📆 Calendar lookups live in `@workflowy/shared/calendar-lookup`;
 * this module adds the node DTO's calendar role and the root's picker settings.
 */

import {and, eq, inArray, sql} from "drizzle-orm";
import {dayNameDate, findCalendarRoot, findTaggedCalendarRoot} from "@workflowy/shared/calendar-lookup";
import type {CalendarDayDeps} from "@workflowy/shared/calendar-lookup";
import type {CacheService} from "@workflowy/shared/cache";
import {calendarMetadata, nodeInternalMetadata} from "@workflowy/shared/db";
import type {CalendarDate} from "@workflowy/shared/internal";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {z} from "zod";
import type {CalendarInfo} from "../node-types.js";

export {findCalendarDay, findCalendarDays, findTaggedCalendarRoot} from "@workflowy/shared/calendar-lookup";
export type {CalendarDayDeps} from "@workflowy/shared/calendar-lookup";

/** The `metadata.calendar` fields the node DTO carries. */
const CalendarInfoSchema = z
	.object({
		root: z.boolean().optional(),
		level: z.string().optional(),
		dateId: z.number().optional(),
		found_dates: z.boolean().optional(),
		day_prefix: z.boolean().optional(),
	})
	.loose();

/** The 📆 Calendar root's picker settings (upstream `T10`/`k10`): each is true unless the root sets it false. */
export interface CalendarSettings {
	foundDates: boolean;
	dayPrefix: boolean;
}

/** The calendar root's Found Dates and Friendly day names settings, each defaulting to true. */
export function readCalendarSettings(deps: Pick<CalendarDayDeps, "db" | "cache">): CalendarSettings {
	const rootId = findCalendarRoot(deps);
	const rootNode = rootId === undefined ? undefined : deps.cache.getNode(rootId);
	const info = rootNode === undefined ? undefined : loadCalendarInfo(deps, [rootNode]).get(rootNode.id);
	return {foundDates: info?.foundDates !== false, dayPrefix: info?.dayPrefix !== false};
}

/**
 * Each node's 📆 Calendar role for the node DTO; nodes with none are absent.
 * Once the calendar root's internal metadata is cached it alone decides, as it
 * does upstream. Otherwise tried in order: the internal-API metadata (fresh), the backup-imported
 * `calendar_metadata` row, then for days created since the last backup a
 * date-only `<time>` name under root > `YYYY` > `MM` (or `M`) unless
 * `fromNames` is false.
 */
export function loadCalendarInfo(
	deps: Pick<CalendarDayDeps, "db" | "cache">,
	nodes: readonly {id: string; parentId: string | null; name: string | null}[],
	{fromNames = true}: {fromNames?: boolean} = {},
): Map<string, CalendarInfo> {
	const map = new Map<string, CalendarInfo>();
	const ids = nodes.map(({id}) => id);
	if (ids.length === 0) {
		return map;
	}
	const internalRows = deps.db
		.select({
			nodeId: nodeInternalMetadata.nodeId,
			calendar: sql<string | null>`json_extract(${nodeInternalMetadata.metadataJson}, '$.calendar')`,
			restorable: sql<
				number | null
			>`json_extract(${nodeInternalMetadata.metadataJson}, '$.restorableUniqueNode')`,
		})
		.from(nodeInternalMetadata)
		.where(inArray(nodeInternalMetadata.nodeId, ids))
		.all();
	for (const {nodeId, calendar, restorable} of internalRows) {
		const parsed = calendar === null ? undefined : CalendarInfoSchema.safeParse(JSON.parse(calendar));
		if (parsed?.success === true) {
			const {root, level, dateId, found_dates: foundDates, day_prefix: dayPrefix} = parsed.data;
			map.set(nodeId, {
				level: level ?? null,
				dateId: dateId ?? null,
				root: root === true,
				foundDates: foundDates ?? null,
				dayPrefix: dayPrefix ?? null,
				restorableUniqueNode: restorable === 1,
			});
		}
	}
	if (findTaggedCalendarRoot(deps) !== undefined) {
		// Upstream's metadata is authoritative once imported: a node without it is no calendar node.
		return map;
	}
	const backupRows = deps.db
		.select()
		.from(calendarMetadata)
		.where(and(inArray(calendarMetadata.nodeId, ids), eq(calendarMetadata.systemTo, FAR_FUTURE_DATE)))
		.all();
	for (const row of backupRows) {
		if (!map.has(row.nodeId)) {
			map.set(row.nodeId, {
				level: row.level,
				dateId: row.dateId,
				root: row.root === 1,
				foundDates: intToBoolean(row.foundDates),
				dayPrefix: intToBoolean(row.dayPrefix),
				restorableUniqueNode: false,
			});
		}
	}
	if (!fromNames) {
		return map;
	}
	let root: string | undefined;
	for (const node of nodes) {
		const date = map.has(node.id) ? undefined : dayNameDate(node.name);
		if (date !== undefined) {
			root ??= findCalendarRoot(deps);
			if (root !== undefined && sitsInMonth(deps.cache, node.parentId, root, date)) {
				const dateId = date.year * 10_000 + date.month * 100 + date.day;
				map.set(node.id, {
					level: "day",
					dateId,
					root: false,
					foundDates: null,
					dayPrefix: null,
					restorableUniqueNode: false,
				});
			}
		}
	}
	return map;
}

/** A nullable 0/1 column as a boolean, keeping null. */
function intToBoolean(value: number | null): boolean | null {
	return value === null ? null : value === 1;
}

/** Whether `parentId` is the `MM` (or `M`) month node of `date` under its `YYYY` year under the calendar root. */
function sitsInMonth(cache: CacheService, parentId: string | null, root: string, date: CalendarDate): boolean {
	const month = parentId === null ? undefined : cache.getNode(parentId);
	const year = month?.parentId == null ? undefined : cache.getNode(month.parentId);
	return (
		year?.parentId === root &&
		year.name === String(date.year) &&
		(month?.name === String(date.month) || month?.name === String(date.month).padStart(2, "0"))
	);
}
