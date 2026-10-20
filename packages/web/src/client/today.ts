import {dateId} from "@workflowy/shared";
import type {CalendarLevel} from "@workflowy/shared";
import {locationUrl} from "./location.js";
import {readJson} from "./read-json.js";

export interface NavigateToTodayDeps {
	fetch: (url: string, init?: {method?: string}) => Promise<Response>;
	navigate: (path: string) => unknown;
	notify: (message: string, type: "info") => unknown;
	/** Edit `id` with the caret at `offset`. */
	startEditing: (id: string, offset: number) => unknown;
	/** Commit the edited text first, as upstream's Today works from anywhere, including while editing. */
	commitEdit: () => unknown;
	now: Date;
}

export type NavigateToCalendarDeps = Omit<NavigateToTodayDeps, "now">;

/** A 📆 Calendar page to zoom to: the `level` node (default the day) holding `date`. */
export interface CalendarTarget {
	date: Date;
	level?: CalendarLevel;
	/** Upstream `C9`'s `createChild`: give a new or empty node one empty child (default true). */
	createChild?: boolean;
}

/** The page's name in the notification: `YYYY-MM-DD`, `YYYY-MM` or `YYYY`. */
function pageLabel(date: Date, level: CalendarLevel): string {
	const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, "0"));
	const count = {year: 1, month: 2, day: 3}[level];
	return parts.slice(0, count).join("-");
}

/**
 * Upstream `C9` + zoom (the day strip, its arrows and month cells, and Today):
 * zoom to the 📆 Calendar node for `target`, creating it through the ensure
 * route when it is missing, and edit its first child. When ensure is disabled
 * or the internal API is not configured, it notifies instead of navigating.
 */
export async function navigateToCalendarDate(
	{date, level = "day", createChild = true}: CalendarTarget,
	{fetch, navigate, notify, startEditing, commitEdit}: NavigateToCalendarDeps,
): Promise<void> {
	commitEdit();
	const url = `/api/v1/calendar/day/${dateId("day", date)}`;
	const levelQuery = level === "day" ? [] : [`level=${level}`];
	const lookupQuery = levelQuery.length === 0 ? "" : `?${levelQuery.join("&")}`;
	const ensureParams = [...levelQuery, ...(createChild ? [] : ["createChild=false"])];
	const ensureQuery = ensureParams.length === 0 ? "" : `?${ensureParams.join("&")}`;
	const found = await fetch(`${url}${lookupQuery}`);
	let target: {dayId: string; firstChildId: string | null};
	if (found.ok) {
		const {id, firstChildId} = await readJson<{id: string; firstChildId: string | null}>(found);
		target = {dayId: id, firstChildId};
	} else {
		const ensured = await fetch(`${url}/ensure${ensureQuery}`, {method: "POST"});
		if (!ensured.ok) {
			notify(`No calendar page for ${pageLabel(date, level)} yet`, "info");
			return;
		}
		target = await readJson<{dayId: string; firstChildId: string | null}>(ensured);
	}
	void navigate(locationUrl({id: target.dayId}));
	if (target.firstChildId !== null) {
		startEditing(target.firstChildId, 0);
	}
}

/**
 * Upstream `navigate_to_today` (⌃T, the Today button and the left-bar Today row): zoom to today's 📆 Calendar day
 * node, creating it when it is missing, and edit its first child.
 */
export async function navigateToToday({now, ...deps}: NavigateToTodayDeps): Promise<void> {
	await navigateToCalendarDate({date: now}, deps);
}
