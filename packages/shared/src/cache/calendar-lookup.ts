/**
 * Find the `📆 Calendar` day node for a `YYYYMMDD` dateId in the cache,
 * without writing anything. Upstream's Today creates days with deterministic
 * ids and calendar metadata; older days only carry a `<time>` name.
 */

import {and, eq, exists, inArray, like, sql} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {z} from "zod";
import {parseTimeAttrs} from "../dates/date-markup.js";
import type * as schema from "../db/schema.js";
import {nodeContent, nodeInternalMetadata} from "../db/schema.js";
import {CALENDAR_LEVELS, DEFAULT_CALENDAR_LEVELS, calendarDateId, parseDateId} from "../internal/calendar-day.js";
import type {CalendarDate, CalendarLevel} from "../internal/calendar-day.js";
import {auditCalendarMonth, auditCalendarRoot} from "../internal/calendar-adopt.js";
import type {AuditNode, CalendarAuditFinding, CalendarParentContext, CalendarTag} from "../internal/calendar-adopt.js";
import {calendarNodeId} from "../internal/calendar-ids.js";
import {FAR_FUTURE_DATE} from "../temporal/constants.js";
import type {CacheService} from "./cache-service.js";

export interface CalendarDayDeps {
	db: BetterSQLite3Database<typeof schema>;
	cache: CacheService;
	/** The account's entropy key; without it the deterministic-id lookup is skipped. */
	entropyKey?: string;
	/** The account's `weekStartDay` (1 is Monday, else Sunday), which places weeks. */
	weekStartDay?: number;
}

export const CALENDAR_ROOT_NAME = "📆 Calendar";
const CalendarSchema = z.object({
	calendar: z
		.object({root: z.boolean().optional(), level: z.string().optional(), dateId: z.number().optional()})
		.loose(),
});
const CalendarTagSchema = z
	.object({root: z.boolean().optional(), level: z.string().optional(), dateId: z.number().optional()})
	.loose();
const LevelsSchema = z.record(z.string(), z.boolean());
const DAY_NAME = /^<time\b([^>]*)>[^<]*<\/time>$/iu;

/**
 * The node id of the `level` node holding the day `dateId` (the day itself by
 * default, or its week, month or year), or null when the cache has none.
 *
 * Once the calendar root's internal metadata is cached this is upstream's
 * `findDateItem` (`db1`): from the root, the first DIRECT child per enabled
 * level whose `metadata.calendar` is that level and period, null at the first
 * miss. Name-only days and tagged nodes anywhere else are invisible, as they
 * are upstream. Without it (public-API-only mode) the lookup stays lenient,
 * in order: the deterministic id `calendarNodeId(entropyKey, level,
 * levelDateId)`, a node whose cached `calendar` metadata is that level and
 * dateId, then (except for weeks) the name walk root > `YYYY` > `MM` (or `M`)
 * > a child whose `<time>` is this date. Only nodes under the root count.
 */
export function findCalendarDay(deps: CalendarDayDeps, dateId: number, level: CalendarLevel = "day"): string | null {
	const date = parseDateId(dateId);
	const taggedRoot = findTaggedCalendarRoot(deps);
	const root = taggedRoot ?? deps.cache.getChildByName(null, CALENDAR_ROOT_NAME)?.id;
	if (date === undefined || root === undefined) {
		return null;
	}
	if (taggedRoot !== undefined) {
		return walkMetadata(deps, root, date, level);
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

/** `level`'s ancestors' levels from the root down, then `level`: the enabled levels above it, plus it. */
function levelPath(levels: Readonly<Record<CalendarLevel, boolean>>, level: CalendarLevel): CalendarLevel[] {
	const target = CALENDAR_LEVELS.indexOf(level);
	return CALENDAR_LEVELS.filter((candidate, index) => candidate === level || (index < target && levels[candidate]));
}

/** The levels the tagged root enables, upstream's defaults when it sets none. */
function rootLevels(deps: Pick<CalendarDayDeps, "db">, root: string): Readonly<Record<CalendarLevel, boolean>> {
	const [row] = deps.db
		.select({levels: sql<string | null>`json_extract(${nodeInternalMetadata.metadataJson}, '$.calendar.levels')`})
		.from(nodeInternalMetadata)
		.where(eq(nodeInternalMetadata.nodeId, root))
		.all();
	const parsed = row?.levels == null ? undefined : LevelsSchema.safeParse(JSON.parse(row.levels));
	return parsed?.success === true
		? {year: false, month: false, week: false, day: false, ...parsed.data}
		: DEFAULT_CALENDAR_LEVELS;
}

/** The `level` and `dateId` of each id's cached `metadata.calendar`; ids without one are absent. */
function calendarTags(deps: Pick<CalendarDayDeps, "db">, ids: readonly string[]): Map<string, CalendarTag> {
	const tags = new Map<string, CalendarTag>();
	if (ids.length === 0) {
		return tags;
	}
	const rows = deps.db
		.select({
			nodeId: nodeInternalMetadata.nodeId,
			calendar: sql<string | null>`json_extract(${nodeInternalMetadata.metadataJson}, '$.calendar')`,
		})
		.from(nodeInternalMetadata)
		.where(inArray(nodeInternalMetadata.nodeId, ids))
		.all();
	for (const {nodeId, calendar} of rows) {
		const parsed = calendar === null ? undefined : CalendarTagSchema.safeParse(JSON.parse(calendar));
		if (parsed?.success === true) {
			tags.set(nodeId, {root: parsed.data.root, level: parsed.data.level, dateId: parsed.data.dateId});
		}
	}
	return tags;
}

/** The first direct child of `parentId` tagged `level` with `dateId`, or null. */
function firstTaggedChild(
	deps: CalendarDayDeps,
	parentId: string,
	level: CalendarLevel,
	dateId: number,
): string | null {
	const children = deps.cache.getChildren(parentId);
	const tags = calendarTags(
		deps,
		children.map(({id}) => id),
	);
	return children.find(({id}) => tags.get(id)?.level === level && tags.get(id)?.dateId === dateId)?.id ?? null;
}

/** Upstream's `findDateItem`: the strict direct-child walk by `metadata.calendar`, down to `level`. */
function walkMetadata(deps: CalendarDayDeps, root: string, date: CalendarDate, level: CalendarLevel): string | null {
	let current: string | null = root;
	for (const step of levelPath(rootLevels(deps, root), level)) {
		current = firstTaggedChild(deps, current, step, calendarDateId(step, date, deps.weekStartDay));
		if (current === null) {
			return null;
		}
	}
	return current;
}

/**
 * Each of `dateIds`' day nodes, as {@link findCalendarDay} finds them, keyed by
 * dateId; days without one are absent. For the date picker's dots, it shares
 * the work between days: one root lookup, then one container walk per month
 * and one scan of a month's children (or, in the lenient mode, one metadata
 * scan and one name walk per month) instead of per day.
 */
export function findCalendarDays(deps: CalendarDayDeps, dateIds: readonly number[]): Map<number, string> {
	const found = new Map<number, string>();
	const taggedRoot = findTaggedCalendarRoot(deps);
	const root = taggedRoot ?? deps.cache.getChildByName(null, CALENDAR_ROOT_NAME)?.id;
	if (root === undefined) {
		return found;
	}
	const days = dateIds.flatMap((dateId) => {
		const date = parseDateId(dateId);
		return date === undefined ? [] : [{dateId, date}];
	});
	if (taggedRoot !== undefined) {
		return findStrictDays(deps, taggedRoot, days);
	}
	const under = underRoot(deps.cache, root);
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

/** {@link findCalendarDays} in strict mode: each day's container is walked once, and its children scanned once. */
function findStrictDays(
	deps: CalendarDayDeps,
	root: string,
	days: readonly {dateId: number; date: CalendarDate}[],
): Map<number, string> {
	const found = new Map<number, string>();
	const path = levelPath(rootLevels(deps, root), "day").slice(0, -1);
	const containers = new Map<string, string | null>();
	const dayNodes = new Map<string, Map<number, string>>();
	for (const {dateId, date} of days) {
		const key = path.map((step) => calendarDateId(step, date, deps.weekStartDay)).join("/");
		let container = containers.get(key);
		if (container === undefined) {
			container = path.reduce<string | null>(
				(current, step) =>
					current === null
						? null
						: firstTaggedChild(deps, current, step, calendarDateId(step, date, deps.weekStartDay)),
				root,
			);
			containers.set(key, container);
		}
		if (container === null) {
			continue;
		}
		let byDate = dayNodes.get(container);
		if (byDate === undefined) {
			const children = deps.cache.getChildren(container);
			const tags = calendarTags(
				deps,
				children.map(({id}) => id),
			);
			byDate = new Map();
			for (const {id} of children) {
				const tag = tags.get(id);
				if (tag?.level === "day" && tag.dateId !== undefined && !byDate.has(tag.dateId)) {
					byDate.set(tag.dateId, id);
				}
			}
			dayNodes.set(container, byDate);
		}
		const id = byDate.get(dateId);
		if (id !== undefined) {
			found.set(dateId, id);
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
export function findCalendarRoot(deps: Pick<CalendarDayDeps, "db" | "cache">): string | undefined {
	return findTaggedCalendarRoot(deps) ?? deps.cache.getChildByName(null, CALENDAR_ROOT_NAME)?.id;
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
export function dayNameDate(name: string | null): CalendarDate | undefined {
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
 * What upstream's adoption hook (`mb1`) reads about a row inserted under `parentId`: the cached
 * `metadata.calendar` of the parent chain up to the calendar root, of the parent's children, and the root's
 * levels. Undefined when the parent is not inside a tagged calendar, so nothing can be adopted there.
 */
export function calendarParentContext(
	deps: Pick<CalendarDayDeps, "db" | "cache">,
	parentId: string,
): CalendarParentContext | undefined {
	const chainIds: string[] = [];
	const seen = new Set<string>();
	for (
		let id: string | null = parentId;
		id !== null && !seen.has(id);
		id = deps.cache.getNode(id)?.parentId ?? null
	) {
		seen.add(id);
		chainIds.push(id);
	}
	const children = deps.cache.getChildren(parentId).map(({id}) => id);
	const tags = calendarTags(deps, [...chainIds, ...children]);
	const rootIndex = chainIds.findIndex((id) => tags.get(id)?.root === true);
	const rootId = chainIds[rootIndex];
	if (rootId === undefined || tags.get(parentId) === undefined) {
		return undefined;
	}
	return {
		parentChain: chainIds.slice(0, rootIndex + 1).map((id) => ({calendar: tags.get(id)})),
		siblings: children.map((id) => ({calendar: tags.get(id)})),
		levels: rootLevels(deps, rootId),
	};
}

/**
 * Everything under the tagged calendar root that upstream's strict day lookup cannot use, read from the cache:
 * name-only years and months at the root, then for each tagged month under a tagged year the name-only and
 * bracket-text days, tagged days nested under one of those, and duplicate dates. Empty without a tagged root.
 * `calendarRootId` audits another tagged root instead (a probe calendar in the sandbox).
 */
export function auditCalendar(
	deps: Pick<CalendarDayDeps, "db" | "cache">,
	calendarRootId?: string,
): CalendarAuditFinding[] {
	const rootId = calendarRootId ?? findTaggedCalendarRoot(deps);
	if (rootId === undefined) {
		return [];
	}
	const levels = rootLevels(deps, rootId);
	const auditNodes = (parentId: string, withChildren: boolean): AuditNode[] => {
		const children = deps.cache.getChildren(parentId);
		const tags = calendarTags(
			deps,
			children.map(({id}) => id),
		);
		return children.map(({id, name}) => {
			const calendar = tags.get(id);
			const node: AuditNode = {id, name, calendar};
			return withChildren ? {...node, children: auditNodes(id, false)} : node;
		});
	};
	const rootChildren = auditNodes(rootId, false);
	const findings = auditCalendarRoot({children: rootChildren});
	for (const year of rootChildren.filter(({calendar}) => calendar?.level === "year")) {
		for (const month of auditNodes(year.id, false).filter(({calendar}) => calendar?.level === "month")) {
			findings.push(...auditCalendarMonth({month, levels, children: auditNodes(month.id, true)}));
		}
	}
	return findings;
}
