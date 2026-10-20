import {useQuery} from "@tanstack/react-query";
import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {dateId, dayTimestamp, guessDates, presetDate, stripModel} from "@workflowy/shared";
import type {CalendarLevel, DatePreset} from "@workflowy/shared";
import type {NodeResponse} from "../../node-types.js";
import {useCalendarEventDays} from "../hooks/use-calendar-event-days.js";
import {useNavigateToCalendarDate} from "../hooks/use-navigate-to-today.js";
import {useDateSettings} from "../hooks/use-preferences.js";
import {readJson} from "../read-json.js";
import type {CalendarTarget} from "../today.js";
import {attachDragScroll, calendarPageDate, scrollStripOnMount} from "../calendar-strip-model.js";
import {CalendarStripView} from "./calendar-strip-view.js";
import {DatePickerPopup} from "./date-picker-popup.js";
import {FaIcon} from "./fa-icons.js";
import {IconButton} from "./icon-button.js";

async function fetchDots(from: number, to: number): Promise<number[]> {
	const response = await fetch(`/api/v1/calendar/dots?from=${from}&to=${to}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch calendar dots: ${response.statusText}`);
	}
	return (await readJson<{dateIds: number[]}>(response)).dateIds;
}

/** The day dateIds in `[from, to]` with journal content; empty until loaded or when `from` is null. */
function useCalendarDots(from: number | null, to: number | null): ReadonlySet<number> {
	const {data} = useQuery({
		queryKey: ["calendar-dots", from, to],
		queryFn: async () => (from === null || to === null ? [] : fetchDots(from, to)),
		enabled: from !== null && to !== null,
	});
	return new Set(data);
}

/**
 * Upstream's `GuiCalendar.CalendarButton`: the calendar-days button opens the
 * date picker without its input row or controls; picking a day zooms to it.
 */
function CalendarButton({date, onSelect}: {date: Date; onSelect: (day: Date) => void}) {
	const anchor = useRef<HTMLDivElement | null>(null);
	const [open, setOpen] = useState<{left: number; top: number} | null>(null);
	const [term, setTerm] = useState("");
	const {dateFormat, weekStartDay} = useDateSettings();
	const eventDays = useCalendarEventDays();
	const close = () => {
		setOpen(null);
		setTerm("");
	};
	const select = (day: Date | undefined) => {
		close();
		if (day !== undefined) {
			onSelect(day);
		}
	};
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream wraps the IconButton, which handles the keyboard
		<div
			ref={anchor}
			className="inline-flex relative"
			onClick={(event) => {
				event.stopPropagation();
				const rect = anchor.current?.getBoundingClientRect();
				if (rect) {
					setOpen({left: rect.left + globalThis.scrollX, top: rect.bottom + globalThis.scrollY});
				}
			}}
		>
			<IconButton shape="square" size="md">
				<FaIcon icon="fal:calendar-days" />
			</IconButton>
			{open === null
				? null
				: createPortal(
						<DatePickerPopup
							selected={[date]}
							weekStartDay={weekStartDay}
							showControls={false}
							hasEvent={eventDays.hasEvent}
							onVisibleMonthChange={eventDays.onVisibleMonthChange}
							term={term}
							position={open}
							onTermChange={setTerm}
							onEnter={() => {
								select(guessDates(term, {dateFormat})[0]);
							}}
							onApply={(dates) => {
								select(dates[0]);
							}}
							onPreset={(preset: DatePreset) => {
								select(presetDate(preset, {weekStartDay}));
							}}
							onEscape={close}
							onClose={close}
						/>,
						document.body,
					)}
		</div>
	);
}

/** A strip page's level and first day. */
interface StripPage {
	level: CalendarLevel;
	date: Date;
}

function StripForPage({level, date}: StripPage) {
	const [now] = useState(() => new Date());
	const {weekStartDay} = useDateSettings();
	const navigateTo = useNavigateToCalendarDate();
	const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
	const model = stripModel(level, date, now, weekStartDay);
	const firstDay = model.days[0];
	const lastDay = model.days.at(-1);
	const dots = useCalendarDots(
		firstDay ? dateId("day", new Date(firstDay.ts)) : null,
		lastDay ? dateId("day", new Date(lastDay.ts)) : null,
	);
	const todayId = model.todayCard ? dateId("day", now) : null;
	const todayDots = useCalendarDots(todayId, todayId);
	// Day and month pages scroll their own cell to the left edge; year pages scroll to today.
	const scrollTarget = level === "year" ? dayTimestamp(now) : dayTimestamp(date);

	// A month click's remembered offset wins; like upstream, this re-runs only when the zoomed page changes.
	useLayoutEffect(() => {
		if (scroller !== null) {
			scrollStripOnMount(scroller, scrollTarget, level === "year");
		}
	}, [scroller, scrollTarget, level]);

	useEffect(() => (scroller === null ? undefined : attachDragScroll(scroller, document)), [scroller]);

	const onNavigate = (target: CalendarTarget) => {
		void navigateTo(target);
	};
	return (
		<CalendarStripView
			level={level}
			date={date}
			now={now}
			weekStartDay={weekStartDay}
			dots={dots}
			todayDot={todayId !== null && todayDots.has(todayId)}
			onNavigate={onNavigate}
			scrollerRef={setScroller}
			calendarButton={
				<CalendarButton
					date={date}
					onSelect={(day) => {
						onNavigate({date: day});
					}}
				/>
			}
		/>
	);
}

/**
 * The day strip under a zoomed 📆 Calendar day, month or year page's title
 * (upstream `ui.item.note.afterend.calendar_navigation`): arrows, the calendar
 * button, and the scrollable day and month cells, each zooming to its page.
 * Other nodes render nothing.
 */
export function CalendarStrip({node}: {node: Pick<NodeResponse, "id" | "calendar">}) {
	const level = node.calendar?.level;
	const pageDateId = node.calendar?.dateId ?? null;
	if ((level !== "day" && level !== "month" && level !== "year") || pageDateId === null) {
		return null;
	}
	return <StripForPage key={node.id} level={level} date={calendarPageDate(pageDateId)} />;
}
