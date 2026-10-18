// Item-menu footer timestamps ("Changed:" / "Created:"), matching upstream's fixed format.
// User-selectable date formats belong to the date-display-format feature; reuse its formatter here once it exists.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

export function formatMenuTimestamp(unixSeconds: number, now: Date): string {
	const date = new Date(unixSeconds * 1000);
	const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
	const sameYear = date.getFullYear() === now.getFullYear();
	if (sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
		return `Today at ${time}`;
	}
	const year = sameYear ? "" : `, ${date.getFullYear()}`;
	return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}${year} at ${time}`;
}
