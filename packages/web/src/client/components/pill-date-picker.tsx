import {useCallback, useState} from "react";
import type {ReactNode} from "react";
import {createPortal} from "react-dom";
import {formatPillLabel, guessDates, presetDate} from "@workflowy/shared";
import type {DatePreset, TimeAttrs} from "@workflowy/shared";
import {timeAttrsFromDates} from "../date-pills.js";
import type {DateSettings} from "../date-settings.js";
import {useOutlineStore} from "../stores/outline.js";
import {useCalendarEventDays} from "../hooks/use-calendar-event-days.js";
import {DatePickerPopup} from "./date-picker-popup.js";

interface OpenPill {
	pillIndex: number;
	position: {left: number; top: number};
	term: string;
	isRange: boolean;
}

interface PillDatePickerOptions {
	dateSettings: DateSettings;
	/** Replace the `pillIndex`-th pill with `attrs`, or remove it when `attrs` is null, and save. */
	onChange: (pillIndex: number, attrs: TimeAttrs | null) => void;
}

/**
 * Upstream's click-a-pill editor: opens the date picker under a display-mode pill with its
 * label prefilled (so the grid opens on its month with the day selected) and "Remove date".
 * Enter with a parsed date, a preset or a day click replaces the pill; Remove date deletes it.
 */
export function usePillDatePicker({dateSettings, onChange}: PillDatePickerOptions): {
	open: (pill: Element, pillIndex: number) => void;
	popup: ReactNode;
} {
	const [picker, setPicker] = useState<OpenPill | null>(null);
	const openSettings = useOutlineStore((state) => state.openSettings);
	const eventDays = useCalendarEventDays();

	const open = useCallback((pill: Element, pillIndex: number) => {
		const rect = pill.getBoundingClientRect();
		const label = pill.textContent.replaceAll("﻿", "");
		setPicker({
			pillIndex,
			position: {left: rect.left + globalThis.scrollX, top: rect.bottom + globalThis.scrollY},
			term: label,
			isRange: pill.hasAttribute("endyear"),
		});
	}, []);

	const close = useCallback(() => {
		setPicker(null);
	}, []);

	const popup = (() => {
		if (picker === null) {
			return null;
		}
		const guess = guessDates(picker.term, {dateFormat: dateSettings.dateFormat});
		const apply = (dates: Date[]) => {
			close();
			onChange(picker.pillIndex, timeAttrsFromDates(dates));
		};
		return createPortal(
			<DatePickerPopup
				selected={guess}
				weekStartDay={dateSettings.weekStartDay}
				hasEvent={eventDays.hasEvent}
				onVisibleMonthChange={eventDays.onVisibleMonthChange}
				isRange={picker.isRange}
				showNoDate
				term={picker.term}
				position={picker.position}
				onTermChange={(term) => {
					setPicker({...picker, term});
				}}
				onEnter={() => {
					if (guess.length > 0) {
						apply(guess);
					} else {
						close();
					}
				}}
				onApply={(dates) => {
					const [first] = dates;
					if (picker.isRange && dates.length === 1 && first !== undefined) {
						// A range's first click only fills the input; the second replaces the pill with the sorted range.
						setPicker({
							...picker,
							term: formatPillLabel(timeAttrsFromDates([first]), {dateFormat: dateSettings.dateFormat}),
						});
					} else {
						apply(dates);
					}
				}}
				onPreset={(preset: DatePreset) => {
					apply([presetDate(preset, {weekStartDay: dateSettings.weekStartDay})]);
				}}
				onToggleRange={() => {
					setPicker({...picker, isRange: !picker.isRange});
				}}
				onFormat={() => {
					close();
					openSettings("Dates");
				}}
				onRemove={() => {
					close();
					onChange(picker.pillIndex, null);
				}}
				onEscape={close}
				onClose={close}
			/>,
			document.body,
		);
	})();
	return {open, popup};
}
