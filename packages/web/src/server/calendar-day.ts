/**
 * Find the `📆 Calendar` day node for a `YYYYMMDD` dateId in the cache,
 * without writing anything. Upstream's Today creates days with deterministic
 * ids and calendar metadata; older days only carry a `<time>` name.
 */

import {and, eq, like} from "drizzle-orm";
import {parseTimeAttrs} from "@workflowy/shared";
import type {CacheService} from "@workflowy/shared/cache";
import {nodeContent, nodeInternalMetadata} from "@workflowy/shared/db";
import {calendarNodeId, parseDateId} from "@workflowy/shared/internal";
import type {CalendarDate} from "@workflowy/shared/internal";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {z} from "zod";
import type {ServerContext} from "./context.js";

export interface CalendarDayDeps {
	db: ServerContext["db"];
	cache: CacheService;
	/** The account's entropy key; without it the deterministic-id lookup is skipped. */
	entropyKey?: string;
}

const CALENDAR_ROOT_NAME = "📆 Calendar";
const CalendarSchema = z.object({
	calendar: z
		.object({root: z.boolean().optional(), level: z.string().optional(), dateId: z.number().optional()})
		.loose(),
});
const DAY_NAME = /^<time\b([^>]*)>[^<]*<\/time>$/iu;

/**
 * The day's node id, or null when the cache has none. Tried in order: the
 * deterministic id `calendarNodeId(entropyKey, "day", dateId)`, a node whose
 * cached `calendar` metadata is this day, then the name walk
 * root > `YYYY` > `MM` (or `M`) > a child whose `<time>` is this date. Only
 * nodes under the calendar root count.
 */
export function findCalendarDay(deps: CalendarDayDeps, dateId: number): string | null {
	const date = parseDateId(dateId);
	const root = findCalendarRoot(deps);
	if (date === undefined || root === undefined) {
		return null;
	}
	if (deps.entropyKey !== undefined) {
		const id = calendarNodeId(deps.entropyKey, "day", dateId);
		if (isUnder(deps.cache, id, root)) {
			return id;
		}
	}
	const tagged = calendarRows(deps, `%"dateId":${dateId}%`).find(
		({id, calendar}) => calendar.level === "day" && calendar.dateId === dateId && isUnder(deps.cache, id, root),
	);
	return tagged?.id ?? walkNames(deps.cache, root, date);
}

/** The node whose cached metadata marks it the calendar root, else the Home child named `📆 Calendar`. */
function findCalendarRoot(deps: CalendarDayDeps): string | undefined {
	const tagged = calendarRows(deps, '%"root":true%').find(({calendar}) => calendar.root === true);
	return tagged?.id ?? deps.cache.getChildByName(null, CALENDAR_ROOT_NAME)?.id;
}

/** Live nodes whose metadata JSON matches `pattern` and parses as calendar metadata. */
function calendarRows(deps: CalendarDayDeps, pattern: string) {
	return deps.db
		.select({id: nodeInternalMetadata.nodeId, metadataJson: nodeInternalMetadata.metadataJson})
		.from(nodeInternalMetadata)
		.innerJoin(nodeContent, eq(nodeContent.id, nodeInternalMetadata.nodeId))
		.where(and(eq(nodeContent.systemTo, FAR_FUTURE_DATE), like(nodeInternalMetadata.metadataJson, pattern)))
		.all()
		.flatMap(({id, metadataJson}) => {
			const parsed = CalendarSchema.safeParse(JSON.parse(metadataJson));
			return parsed.success ? [{id, calendar: parsed.data.calendar}] : [];
		});
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

function walkNames(cache: CacheService, root: string, date: CalendarDate): string | null {
	const year = cache.getChildByName(root, String(date.year));
	const month =
		year &&
		(cache.getChildByName(year.id, String(date.month).padStart(2, "0")) ??
			cache.getChildByName(year.id, String(date.month)));
	const day = month && cache.getChildren(month.id).find((child) => namesDate(child.name, date));
	return day?.id ?? null;
}

/**
 * Whether `name` is exactly one date-only `<time>` on `date`, as upstream names
 * a day. Journal entries that sit beside the days (a timed `<time>` or extra
 * text) are not day nodes.
 */
function namesDate(name: string | null, date: CalendarDate): boolean {
	const attrText = DAY_NAME.exec(name?.trim() ?? "")?.[1];
	if (attrText === undefined) {
		return false;
	}
	try {
		const attrs = parseTimeAttrs(attrText);
		return (
			Object.keys(attrs).length === 3 &&
			attrs.startYear === date.year &&
			attrs.startMonth === date.month &&
			attrs.startDay === date.day
		);
	} catch {
		// A <time> without start attributes names no date.
		return false;
	}
}
