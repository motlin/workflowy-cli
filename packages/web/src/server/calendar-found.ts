/**
 * Upstream's Found Dates (`calendar.non-calendar-mirrors.wire`): for a 📆
 * Calendar day, every live node whose name or note has a `<time>` covering that
 * day (a range counts for each day it spans), except calendar level nodes,
 * mirror copies and the day's own descendants, in tree order.
 */

import {and, eq, like, or} from "drizzle-orm";
import {parseTimeAttrs} from "@workflowy/shared";
import type {CacheService} from "@workflowy/shared/cache";
import {nodeContent} from "@workflowy/shared/db";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import type {Node} from "@workflowy/shared/types";
import type {BacklinkCrumb} from "../node-types.js";
import {findCalendarRoot, loadCalendarInfo} from "./calendar-day.js";
import type {CalendarDayDeps} from "./calendar-day.js";

export interface FoundDate {
	id: string;
	/** The node's ancestors, root first, excluding the node. */
	crumbs: BacklinkCrumb[];
}

const TIME_OPEN_TAG = /<time\b([^>]*)>/giu;

/** Whether any `<time>` in `html` starts on or before `dateId` and ends on or after it. */
function coversDay(html: string | null, dateId: number): boolean {
	if (html === null) {
		return false;
	}
	for (const [, attrText = ""] of html.matchAll(TIME_OPEN_TAG)) {
		try {
			const attrs = parseTimeAttrs(attrText);
			const start = attrs.startYear * 10_000 + attrs.startMonth * 100 + attrs.startDay;
			const end =
				attrs.endDay === undefined
					? start
					: (attrs.endYear ?? attrs.startYear) * 10_000 +
						(attrs.endMonth ?? attrs.startMonth) * 100 +
						attrs.endDay;
			if (start <= dateId && dateId <= end) {
				return true;
			}
		} catch {
			// A <time> without start attributes names no date.
		}
	}
	return false;
}

/** The node's ancestors root first, or undefined when the chain leaves the cache (an orphan). */
function ancestorsOf(cache: CacheService, node: Node): Node[] | undefined {
	const ancestors: Node[] = [];
	const seen = new Set<string>([node.id]);
	let parentId = node.parentId;
	while (parentId !== null) {
		const parent = seen.has(parentId) ? undefined : cache.getNode(parentId);
		if (parent === undefined) {
			return undefined;
		}
		seen.add(parent.id);
		ancestors.unshift(parent);
		parentId = parent.parentId;
	}
	return ancestors;
}

/** Tree order: compare the priority paths from the top level down; an ancestor comes before its descendants. */
function compareTreeOrder(a: number[], b: number[]): number {
	for (let index = 0; index < Math.min(a.length, b.length); index++) {
		const delta = (a[index] ?? 0) - (b[index] ?? 0);
		if (delta !== 0) {
			return delta;
		}
	}
	return a.length - b.length;
}

/**
 * The Found Dates of the day node `dayId` (dateId `dateId`), or none when the
 * calendar root turns Found Dates off. A `LIKE` on the day's year prefilters
 * the rows, so a range that neither starts nor ends in that year is missed.
 */
export function findFoundDates(
	deps: Pick<CalendarDayDeps, "db" | "cache">,
	dayId: string,
	dateId: number,
): FoundDate[] {
	const rootId = findCalendarRoot(deps);
	const rootNode = rootId === undefined ? undefined : deps.cache.getNode(rootId);
	if (rootNode !== undefined && loadCalendarInfo(deps, [rootNode]).get(rootNode.id)?.foundDates === false) {
		return [];
	}
	const yearPattern = `%Year="${Math.floor(dateId / 10_000)}"%`;
	const candidates = deps.db
		.select({id: nodeContent.id, name: nodeContent.name, note: nodeContent.note})
		.from(nodeContent)
		.where(
			and(
				eq(nodeContent.systemTo, FAR_FUTURE_DATE),
				or(like(nodeContent.name, yearPattern), like(nodeContent.note, yearPattern)),
			),
		)
		.all()
		.filter(({name, note}) => coversDay(name, dateId) || coversDay(note, dateId));
	const nodes = candidates.flatMap(({id}) => {
		const node = deps.cache.getNode(id);
		return node === undefined || node.mirror.isMirror ? [] : [node];
	});
	const calendarInfo = loadCalendarInfo(deps, nodes);
	return nodes
		.flatMap((node) => {
			const info = calendarInfo.get(node.id);
			if (node.id === dayId || info?.root === true || info?.level != null) {
				return [];
			}
			const ancestors = ancestorsOf(deps.cache, node);
			if (ancestors === undefined || ancestors.some(({id}) => id === dayId)) {
				return [];
			}
			return [{node, ancestors, path: [...ancestors, node].map(({priority}) => priority)}];
		})
		.toSorted((a, b) => compareTreeOrder(a.path, b.path))
		.map(({node, ancestors}) => ({
			id: node.id,
			crumbs: ancestors.map(({id, name}) => ({id, name: name ?? ""})),
		}));
}
