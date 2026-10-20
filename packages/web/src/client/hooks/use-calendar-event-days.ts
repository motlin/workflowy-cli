import {useQuery} from "@tanstack/react-query";
import {useCallback, useState} from "react";
import {readJson} from "../read-json.js";

/** A calendar month, `month` 1-12. */
export interface CalendarMonth {
	year: number;
	month: number;
}

/** Which days the picker dots: `found` (the strip's picker) adds existing days that Found Dates cover. */
export interface EventDayOptions {
	found?: boolean;
}

export function calendarDaysUrl({year, month}: CalendarMonth, {found = false}: EventDayOptions = {}): string {
	return `/api/v1/calendar/days?year=${year}&month=${month}${found ? "&found=1" : ""}`;
}

async function fetchCalendarDays(visible: CalendarMonth, options: EventDayOptions): Promise<number[]> {
	const response = await fetch(calendarDaysUrl(visible, options));
	if (!response.ok) {
		throw new Error(`Failed to fetch calendar days: ${response.statusText}`);
	}
	return (await readJson<{days: number[]}>(response)).days;
}

/** Whether a date is one of `days` in `visible`; nothing is marked until the days load. */
export function eventDayPredicate(visible: CalendarMonth, days: number[] | undefined): (date: Date) => boolean {
	const marked = new Set(days);
	return (date) =>
		date.getFullYear() === visible.year && date.getMonth() + 1 === visible.month && marked.has(date.getDate());
}

/**
 * The date picker's event dots (upstream DP10): fetches which days of the
 * visible month have journal content under 📆 Calendar, one query per month.
 */
export function useCalendarEventDays({found = false}: EventDayOptions = {}): {
	hasEvent: (date: Date) => boolean;
	onVisibleMonthChange: (visible: CalendarMonth) => void;
} {
	const [visible, setVisible] = useState<CalendarMonth | null>(null);
	const {data} = useQuery({
		queryKey: ["calendar-days", visible?.year, visible?.month, found],
		queryFn: async () => (visible === null ? [] : fetchCalendarDays(visible, {found})),
		enabled: visible !== null,
	});
	const onVisibleMonthChange = useCallback((next: CalendarMonth) => {
		setVisible((current) => (current?.year === next.year && current.month === next.month ? current : next));
	}, []);
	return {hasEvent: visible === null ? () => false : eventDayPredicate(visible, data), onVisibleMonthChange};
}
