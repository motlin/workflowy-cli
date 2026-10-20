import {useQuery} from "@tanstack/react-query";
import type {CalendarLayout, LayoutLevels} from "../calendar-layout-model.js";
import {readJson} from "../read-json.js";

const LAYOUT_URL = "/api/v1/calendar/layout";

/** A planned restructure step; only `op` is read on the client. */
export interface CalendarLayoutStep {
	op: string;
}

/** The Calendar Layout view's starting state, fetched while the view is open. */
export function useCalendarLayout(enabled: boolean): CalendarLayout | undefined {
	const {data} = useQuery({
		queryKey: ["calendar-layout"],
		enabled,
		queryFn: async () => {
			const response = await fetch(LAYOUT_URL);
			if (!response.ok) {
				throw new Error(`Failed to load the calendar layout: ${response.statusText}`);
			}
			return readJson<CalendarLayout>(response);
		},
	});
	return data;
}

/** Plan upstream's restructure for `levels` without writing anything; rejects with the server's error. */
export async function previewCalendarLayout(levels: LayoutLevels): Promise<CalendarLayoutStep[]> {
	const response = await fetch(`${LAYOUT_URL}/preview`, {
		method: "POST",
		headers: {"content-type": "application/json"},
		body: JSON.stringify({levels}),
	});
	const body = await readJson<{steps?: CalendarLayoutStep[]; error?: string}>(response);
	if (!response.ok || body.steps === undefined) {
		throw new Error(body.error ?? `Failed to preview the calendar layout: ${response.statusText}`);
	}
	return body.steps;
}
