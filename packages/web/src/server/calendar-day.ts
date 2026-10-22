/**
 * Find the `📆 Calendar` day node for a `YYYYMMDD` dateId in the cache,
 * without writing anything. Upstream's Today creates days with deterministic
 * ids and calendar metadata; older days only carry a `<time>` name.
 */

import {and, eq, exists, inArray, like, sql} from "drizzle-orm";
import {parseTimeAttrs} from "@workflowy/shared";
import type {CacheService} from "@workflowy/shared/cache";
import {calendarMetadata, nodeContent, nodeInternalMetadata} from "@workflowy/shared/db";
import {calendarDateId, calendarNodeId, parseDateId} from "@workflowy/shared/internal";
import type {CalendarDate, CalendarLevel} from "@workflowy/shared/internal";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {z} from "zod";
import type {CalendarInfo} from "../node-types.js";
import type {ServerContext} from "./context.js";

export interface CalendarDayDeps {
	db: ServerContext["db"];
	cache: CacheService;
	/** The account's entropy key; without it the deterministic-id lookup is skipped. */
	entropyKey?: string;
	/** The account's `weekStartDay` (1 is Monday, else Sunday), which places weeks. */
	weekStartDay?: number;
}

const CALENDAR_ROOT_NAME = "📆 Calendar";
const CalendarSchema = z.object({
	calendar: z
		.object({root: z.boolean().optional(), level: z.string().optional(), dateId: z.number().optional()})
		.loose(),
});
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
const DAY_NAME = /^<time\b([^>]*)>[^<]*<\/time>$/iu;

/**
 * The node id of the `level` node holding the day `dateId` (the day itself by
 * default, or its week, month or year), or null when the cache has none. Tried
 * in order: the deterministic id `calendarNodeId(entropyKey, level, levelDateId)`,
 * a node whose cached `calendar` metadata is that level and dateId, then
 * (except for weeks, which upstream always tags) the name walk root > `YYYY` >
 * `MM` (or `M`) > a child whose `<time>` is this date. Only nodes under the
 * calendar root count.
 */
export function findCalendarDay(deps: CalendarDayDeps, dateId: number, level: CalendarLevel = "day"): string | null {
	const date = parseDateId(dateId);
	const root = findCalendarRoot(deps);
	if (date === undefined || root === undefined) {
		return null;
	}
	const levelDateId = calendarDateId(level, date, deps.weekStartDay);
	if (deps.entropyKey !== undefined) {
		const id = calendarNodeId(deps.entropyKey, level, levelDateId, date.year);
		if (isUnder(deps.cache, id, root)) {
			return id;
		}
	}
	const tagged = calendarRows(deps, `%"dateId":${levelDateId}%`).find(
		({id, calendar}) =>
			calendar.level === level && calendar.dateId === levelDateId && isUnder(deps.cache, id, root),
	);
	return tagged?.id ?? (level === "week" ? null : walkNames(deps.cache, root, date, level));
}

/**
 * Each of `dateIds`' day nodes, as {@link findCalendarDay} finds them, keyed by
 * dateId; days without one are absent. One root lookup, then one metadata scan
 * and one name walk per month instead of per day, for the date picker's dots.
 */
export function findCalendarDays(deps: CalendarDayDeps, dateIds: readonly number[]): Map<number, string> {
	const found = new Map<number, string>();
	const root = findCalendarRoot(deps);
	if (root === undefined) {
		return found;
	}
	const under = underRoot(deps.cache, root);
	const days = dateIds.flatMap((dateId) => {
		const date = parseDateId(dateId);
		return date === undefined ? [] : [{dateId, date}];
	});
	const {entropyKey} = deps;
	const deterministic = new Map(
		entropyKey === undefined
			? []
			: days.map(({dateId, date}) => [dateId, calendarNodeId(entropyKey, "day", dateId, date.year)] as const),
	);
	const nodes = deps.cache.getMultipleNodes([...deterministic.values()]);
	const months = new Map<number, {tagged: Map<number, string>; named: Map<number, string>}>();
	for (const {dateId, date} of days) {
		const id = deterministic.get(dateId);
		const node = id === undefined ? undefined : nodes.get(id);
		if (id !== undefined && node !== undefined && under(node.parentId)) {
			found.set(dateId, id);
			continue;
		}
		const monthKey = Math.floor(dateId / 100);
		let month = months.get(monthKey);
		if (month === undefined) {
			month = {tagged: taggedDaysInMonth(deps, under, monthKey), named: namedDaysInMonth(deps.cache, root, date)};
			months.set(monthKey, month);
		}
		const dayId = month.tagged.get(dateId) ?? month.named.get(date.day);
		if (dayId !== undefined) {
			found.set(dateId, dayId);
		}
	}
	return found;
}

/**
 * Whether a node with parent `parentId` sits strictly below `root`, as
 * {@link isUnder} answers, remembering the ancestors it climbs so sibling days
 * share one walk.
 */
function underRoot(cache: CacheService, root: string): (parentId: string | null) => boolean {
	const answers = new Map<string, boolean>([[root, true]]);
	return (start) => {
		const climbed: string[] = [];
		let parentId = start;
		let answer = false;
		while (parentId !== null) {
			const known = answers.get(parentId);
			if (known !== undefined) {
				answer = known;
				break;
			}
			if (climbed.includes(parentId)) {
				break;
			}
			climbed.push(parentId);
			parentId = cache.getNode(parentId)?.parentId ?? null;
		}
		for (const ancestor of climbed) {
			answers.set(ancestor, answer);
		}
		return answer;
	};
}

/** The month's (`YYYYMM`) day nodes under the root that cached calendar metadata tags, the first per dateId. */
function taggedDaysInMonth(
	deps: Pick<CalendarDayDeps, "db" | "cache">,
	under: (parentId: string | null) => boolean,
	monthKey: number,
): Map<number, string> {
	const rows = calendarRows(deps, `%"dateId":${monthKey}%`).filter(
		({calendar}) =>
			calendar.level === "day" && calendar.dateId !== undefined && Math.floor(calendar.dateId / 100) === monthKey,
	);
	const nodes = deps.cache.getMultipleNodes(rows.map(({id}) => id));
	const days = new Map<number, string>();
	for (const {id, calendar} of rows) {
		const node = nodes.get(id);
		if (calendar.dateId !== undefined && !days.has(calendar.dateId) && node !== undefined && under(node.parentId)) {
			days.set(calendar.dateId, id);
		}
	}
	return days;
}

/** The day nodes of `date`'s month found by the root > `YYYY` > `MM` name walk, keyed by day of month, the first per day. */
function namedDaysInMonth(cache: CacheService, root: string, date: CalendarDate): Map<number, string> {
	const days = new Map<number, string>();
	const month = walkNames(cache, root, date, "month");
	for (const child of month === null ? [] : cache.getChildren(month)) {
		const named = dayNameDate(child.name);
		if (named?.year === date.year && named.month === date.month && !days.has(named.day)) {
			days.set(named.day, child.id);
		}
	}
	return days;
}

/** The node whose cached metadata marks it the calendar root, else the Home child named `📆 Calendar`. */
function findCalendarRoot(deps: Pick<CalendarDayDeps, "db" | "cache">): string | undefined {
	return findTaggedCalendarRoot(deps) ?? deps.cache.getChildByName(null, CALENDAR_ROOT_NAME)?.id;
}

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
 * The calendar root whose cached internal metadata marks it `calendar.root`, or undefined. Metadata
 * patches are built against that cached row, so without it a `calendar.*` write would replace the
 * root's whole `calendar` object.
 */
export function findTaggedCalendarRoot(deps: Pick<CalendarDayDeps, "db">): string | undefined {
	return calendarRows(deps, '%"root":true%').find(({calendar}) => calendar.root === true)?.id;
}

/** Live nodes whose metadata JSON matches `pattern` and parses as calendar metadata. */
function calendarRows(deps: Pick<CalendarDayDeps, "db">, pattern: string) {
	return (
		deps.db
			.select({id: nodeInternalMetadata.nodeId, metadataJson: nodeInternalMetadata.metadataJson})
			.from(nodeInternalMetadata)
			// EXISTS keeps SQLite on the small metadata table; a join scans every node_content version first.
			.where(
				and(
					like(nodeInternalMetadata.metadataJson, pattern),
					exists(
						deps.db
							.select({live: sql`1`})
							.from(nodeContent)
							.where(
								and(
									eq(nodeContent.id, nodeInternalMetadata.nodeId),
									eq(nodeContent.systemTo, FAR_FUTURE_DATE),
								),
							),
					),
				),
			)
			.all()
			.flatMap(({id, metadataJson}) => {
				const parsed = CalendarSchema.safeParse(JSON.parse(metadataJson));
				return parsed.success ? [{id, calendar: parsed.data.calendar}] : [];
			})
	);
}

/** Whether `id` is a cached node strictly below `ancestor`. */
function isUnder(cache: CacheService, id: string, ancestor: string): boolean {
	const seen = new Set<string>();
	let parentId = cache.getNode(id)?.parentId ?? null;
	while (parentId !== null && !seen.has(parentId)) {
		if (parentId === ancestor) {
			return true;
		}
		seen.add(parentId);
		parentId = cache.getNode(parentId)?.parentId ?? null;
	}
	return false;
}

function walkNames(
	cache: CacheService,
	root: string,
	date: CalendarDate,
	level: Exclude<CalendarLevel, "week">,
): string | null {
	const year = cache.getChildByName(root, String(date.year));
	if (level === "year") {
		return year?.id ?? null;
	}
	const month =
		year &&
		(cache.getChildByName(year.id, String(date.month).padStart(2, "0")) ??
			cache.getChildByName(year.id, String(date.month)));
	if (level === "month") {
		return month?.id ?? null;
	}
	const day = month && cache.getChildren(month.id).find((child) => namesDate(child.name, date));
	return day?.id ?? null;
}

/**
 * The date `name` names when it is exactly one date-only `<time>`, as upstream
 * names a day. Journal entries that sit beside the days (a timed `<time>` or
 * extra text) name no day.
 */
function dayNameDate(name: string | null): CalendarDate | undefined {
	const attrText = DAY_NAME.exec(name?.trim() ?? "")?.[1];
	if (attrText === undefined) {
		return undefined;
	}
	try {
		const {startYear, startMonth, startDay, ...rest} = parseTimeAttrs(attrText);
		return Object.keys(rest).length === 0 ? {year: startYear, month: startMonth, day: startDay} : undefined;
	} catch {
		// A <time> without start attributes names no date.
		return undefined;
	}
}

/** Whether `name` is exactly one date-only `<time>` on `date`. */
function namesDate(name: string | null, date: CalendarDate): boolean {
	const named = dayNameDate(name);
	return named?.year === date.year && named.month === date.month && named.day === date.day;
}

/**
 * Each node's 📆 Calendar role for the node DTO; nodes with none are absent.
 * Tried in order: the internal-API metadata (fresh), the backup-imported
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
		})
		.from(nodeInternalMetadata)
		.where(inArray(nodeInternalMetadata.nodeId, ids))
		.all();
	for (const {nodeId, calendar} of internalRows) {
		const parsed = calendar === null ? undefined : CalendarInfoSchema.safeParse(JSON.parse(calendar));
		if (parsed?.success === true) {
			const {root, level, dateId, found_dates: foundDates, day_prefix: dayPrefix} = parsed.data;
			map.set(nodeId, {
				level: level ?? null,
				dateId: dateId ?? null,
				root: root === true,
				foundDates: foundDates ?? null,
				dayPrefix: dayPrefix ?? null,
			});
		}
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
				map.set(node.id, {level: "day", dateId, root: false, foundDates: null, dayPrefix: null});
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
