import {dateId} from "@workflowy/shared";
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

function isoDate(date: Date): string {
	return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
}

/**
 * Upstream `navigate_to_today` (⌃T, the Today button and the left-bar Today row): zoom to today's 📆 Calendar day
 * node, creating it through the ensure route when it is missing, and edit its first child. When ensure is disabled
 * or the internal API is not configured, it notifies instead of navigating.
 */
export async function navigateToToday({
	fetch,
	navigate,
	notify,
	startEditing,
	commitEdit,
	now,
}: NavigateToTodayDeps): Promise<void> {
	commitEdit();
	const url = `/api/v1/calendar/day/${dateId("day", now)}`;
	const found = await fetch(url);
	let target: {dayId: string; firstChildId?: string};
	if (found.ok) {
		const {id, firstChildId} = await readJson<{id: string; firstChildId?: string}>(found);
		target = {dayId: id, ...(firstChildId === undefined ? {} : {firstChildId})};
	} else {
		const ensured = await fetch(`${url}/ensure`, {method: "POST"});
		if (!ensured.ok) {
			notify(`No calendar page for ${isoDate(now)} yet`, "info");
			return;
		}
		target = await readJson<{dayId: string; firstChildId: string}>(ensured);
	}
	void navigate(locationUrl({id: target.dayId}));
	if (target.firstChildId !== undefined) {
		startEditing(target.firstChildId, 0);
	}
}
