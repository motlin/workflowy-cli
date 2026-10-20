import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import type {CalendarSettings} from "../components/calendar-picker-settings.js";
import {nodeKeys} from "../node-cache.js";
import {readJson} from "../read-json.js";

const SETTINGS_URL = "/api/v1/calendar/settings";
const SETTINGS_KEY = ["calendar-settings"] as const;
const DEFAULT_SETTINGS: CalendarSettings = {foundDates: true, dayPrefix: true};

async function fetchSettings(init?: RequestInit): Promise<CalendarSettings> {
	const response = await fetch(SETTINGS_URL, init);
	if (!response.ok) {
		throw new Error(`Failed to ${init?.method ?? "GET"} calendar settings: ${response.statusText}`);
	}
	return readJson<CalendarSettings>(response);
}

/**
 * The 📆 Calendar root's Found Dates and Friendly day names settings, and a toggle that writes the flipped value to
 * the root's metadata (upstream `A10`/`_10`). The toggle shows at once; on success the title prefix (read from the
 * day's ancestors), Found Dates and the picker dots refetch, the local stand-in for `calendar.settings_change`.
 */
export function useCalendarSettings(): {settings: CalendarSettings; toggle: (key: keyof CalendarSettings) => void} {
	const queryClient = useQueryClient();
	const {data = DEFAULT_SETTINGS} = useQuery({queryKey: SETTINGS_KEY, queryFn: async () => fetchSettings()});
	const {mutate} = useMutation({
		mutationFn: async (change: Partial<CalendarSettings>) =>
			fetchSettings({
				method: "PUT",
				headers: {"content-type": "application/json"},
				body: JSON.stringify(change),
			}),
		onMutate: (change) => {
			const previous = queryClient.getQueryData<CalendarSettings>(SETTINGS_KEY);
			queryClient.setQueryData<CalendarSettings>(SETTINGS_KEY, {...(previous ?? DEFAULT_SETTINGS), ...change});
			return {previous};
		},
		onError: (_error, _change, context) => {
			queryClient.setQueryData(SETTINGS_KEY, context?.previous);
		},
		onSuccess: async (settings) => {
			queryClient.setQueryData(SETTINGS_KEY, settings);
			await Promise.all([
				queryClient.invalidateQueries({queryKey: [...nodeKeys.all, "ancestors"]}),
				queryClient.invalidateQueries({queryKey: [...nodeKeys.all, "found-dates"]}),
				queryClient.invalidateQueries({queryKey: ["calendar-days"]}),
			]);
		},
	});
	return {
		settings: data,
		toggle: (key) => {
			mutate({[key]: !data[key]});
		},
	};
}
