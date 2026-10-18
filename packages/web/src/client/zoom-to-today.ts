import {locationUrl} from "./location.js";
import {readJson} from "./read-json.js";

/**
 * Zoom to Today: searches for a node containing today's date and navigates to it.
 * Shared by the header Today button and the ctrl+t shortcut.
 */
export async function zoomToToday({navigate}: {navigate: (path: string) => unknown}): Promise<void> {
	// Format today's date in common formats to search
	const today = new Date();
	const monthNames = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];
	const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	const day = today.getDate();
	const month = monthNames[today.getMonth()];
	const year = today.getFullYear();
	const dayOfWeek = dayNames[today.getDay()];

	// Try common date formats
	const dateFormats = [
		`${month} ${day}, ${year}`,
		`${dayOfWeek}, ${month} ${day}`,
		`${month} ${day}`,
		`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
	];

	// Search for nodes containing today's date
	for (const dateFormat of dateFormats) {
		const response = await fetch("/api/search", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({query: dateFormat, limit: 1}),
		});

		if (response.ok) {
			const data = await readJson<{results: {id: string; name: string | null}[]}>(response);
			const [first] = data.results;
			if (first !== undefined) {
				void navigate(locationUrl({id: first.id}));
				return;
			}
		}
	}

	// If no node found, could show a notification (for now just do nothing)
}
