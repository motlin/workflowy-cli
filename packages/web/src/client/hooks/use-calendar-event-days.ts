import {useQuery, useQueryClient} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import {useCallback, useEffect, useState} from "react";
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

/** The query key for a month's dotted days; the strip's Found Dates variant is cached apart. */
export function calendarDaysKey({year, month}: CalendarMonth, {found = false}: EventDayOptions = {}) {
	return ["calendar-days", year, month, found] as const;
}

/** The months either side of `visible`, which the picker can page to next. */
export function adjacentMonths({year, month}: CalendarMonth): [CalendarMonth, CalendarMonth] {
	return [
		month === 1 ? {year: year - 1, month: 12} : {year, month: month - 1},
		month === 12 ? {year: year + 1, month: 1} : {year, month: month + 1},
	];
}

/**
 * Load a month's dotted days into the cache before a picker shows it, so its
 * dots paint with the grid; a month still fresh in the cache is not refetched.
 */
export async function prefetchCalendarDays(
	queryClient: QueryClient,
	visible: CalendarMonth,
	options: EventDayOptions = {},
): Promise<void> {
	// A failed prefetch is dropped: the picker fetches the month itself when it shows it.
	await queryClient
		.query({
			queryKey: calendarDaysKey(visible, options),
			queryFn: async () => fetchCalendarDays(visible, options),
			retry: false,
		})
		.catch(() => {});
}

/** Whether a date is one of `days` in `visible`; nothing is marked until the days load. */
export function eventDayPredicate(visible: CalendarMonth, days: number[] | undefined): (date: Date) => boolean {
	const marked = new Set(days);
	return (date) =>
		date.getFullYear() === visible.year && date.getMonth() + 1 === visible.month && marked.has(date.getDate());
}

/**
 * The date picker's event dots (upstream DP10): fetches which days of the
 * visible month have journal content under 📆 Calendar, one query per month,
 * prefetching the months either side.
 */
export function useCalendarEventDays({found = false}: EventDayOptions = {}): {
	hasEvent: (date: Date) => boolean;
	onVisibleMonthChange: (visible: CalendarMonth) => void;
} {
	const [visible, setVisible] = useState<CalendarMonth | null>(null);
	const queryClient = useQueryClient();
	const {data} = useQuery({
		queryKey: visible === null ? ["calendar-days", null] : calendarDaysKey(visible, {found}),
		queryFn: async () => (visible === null ? [] : fetchCalendarDays(visible, {found})),
		enabled: visible !== null,
	});
	useEffect(() => {
		// Paging a month lands on dots that are already loaded.
		for (const month of visible === null ? [] : adjacentMonths(visible)) {
			void prefetchCalendarDays(queryClient, month, {found});
		}
	}, [queryClient, visible, found]);
	const onVisibleMonthChange = useCallback((next: CalendarMonth) => {
		setVisible((current) => (current?.year === next.year && current.month === next.month ? current : next));
	}, []);
	return {hasEvent: visible === null ? () => false : eventDayPredicate(visible, data), onVisibleMonthChange};
}
