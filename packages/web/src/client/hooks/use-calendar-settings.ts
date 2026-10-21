import {useQuery, useQueryClient} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import type {CalendarSettings} from "../components/calendar-picker-settings.js";
import {nodeKeys} from "../node-cache.js";
import {readJson} from "../read-json.js";

const SETTINGS_URL = "/api/v1/calendar/settings";
export const CALENDAR_SETTINGS_KEY = ["calendar-settings"] as const;
const DEFAULT_SETTINGS: CalendarSettings = {foundDates: true, dayPrefix: true};
const LABELS: Record<keyof CalendarSettings, string> = {foundDates: "Found Dates", dayPrefix: "Friendly day names"};

async function fetchSettings(): Promise<CalendarSettings> {
	const response = await fetch(SETTINGS_URL);
	if (!response.ok) {
		throw new Error(`Failed to GET calendar settings: ${response.statusText}`);
	}
	return readJson<CalendarSettings>(response);
}

/** The route's `{error}` message, else the status line. */
async function errorMessage(response: Response): Promise<string> {
	const body = await readJson<{error?: unknown}>(response).catch(() => ({error: undefined}));
	return typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`.trim();
}

/**
 * Flip one of the 📆 Calendar root's picker settings (upstream `A10`/`_10`). The flip shows at once, and a settings
 * read already in flight is cancelled so it cannot paint the old value back. On success the title prefix (read from
 * the day's ancestors), Found Dates and the picker dots refetch, the local stand-in for `calendar.settings_change`;
 * on failure the flip rolls back and the promise rejects with the server's reason, for the caller to show.
 */
export async function toggleCalendarSetting(queryClient: QueryClient, key: keyof CalendarSettings): Promise<void> {
	await queryClient.cancelQueries({queryKey: CALENDAR_SETTINGS_KEY});
	const previous = queryClient.getQueryData<CalendarSettings>(CALENDAR_SETTINGS_KEY) ?? DEFAULT_SETTINGS;
	const change = {[key]: !previous[key]};
	queryClient.setQueryData<CalendarSettings>(CALENDAR_SETTINGS_KEY, {...previous, ...change});
	let settings: CalendarSettings;
	try {
		const response = await fetch(SETTINGS_URL, {
			method: "PUT",
			headers: {"content-type": "application/json"},
			body: JSON.stringify(change),
		});
		if (!response.ok) {
			throw new Error(await errorMessage(response));
		}
		settings = await readJson<CalendarSettings>(response);
	} catch (error) {
		queryClient.setQueryData(CALENDAR_SETTINGS_KEY, previous);
		throw new Error(`Could not change ${LABELS[key]}: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
	queryClient.setQueryData(CALENDAR_SETTINGS_KEY, settings);
	await Promise.all([
		queryClient.invalidateQueries({queryKey: [...nodeKeys.all, "ancestors"]}),
		queryClient.invalidateQueries({queryKey: [...nodeKeys.all, "found-dates"]}),
		queryClient.invalidateQueries({queryKey: ["calendar-days"]}),
	]);
}

/**
 * The 📆 Calendar root's Found Dates and Friendly day names settings, and a toggle that writes the flipped value to
 * the root's metadata through {@link toggleCalendarSetting}; `onError` receives a failed write's reason.
 */
export function useCalendarSettings(onError: (error: unknown) => void): {
	settings: CalendarSettings;
	toggle: (key: keyof CalendarSettings) => void;
} {
	const queryClient = useQueryClient();
	const {data = DEFAULT_SETTINGS} = useQuery({queryKey: CALENDAR_SETTINGS_KEY, queryFn: fetchSettings});
	return {
		settings: data,
		toggle: (key) => {
			toggleCalendarSetting(queryClient, key).catch(onError);
		},
	};
}
