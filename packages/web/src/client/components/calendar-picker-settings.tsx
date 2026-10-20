import type {ReactElement} from "react";
import {FaIcon} from "./fa-icons.js";
import {MenuItem, MenuSeparator} from "./flyout/menu-item.js";
import {Toggle} from "./date-picker-popup.js";
import type {DayContent} from "./date-picker-popup.js";

/** The 📆 Calendar root's picker settings; each is true unless the root sets it false. */
export interface CalendarSettings {
	foundDates: boolean;
	dayPrefix: boolean;
}

const ROW_CLASS = "[&_.menuItemIcon]:w-[26px] mobile:[&_.menuItemIcon]:w-[54px]";

/**
 * Upstream `F10` (without the Calendar Layout row): the strip picker's rows after the calendar, a separator then a
 * Toggle row for Found Dates (`A10`) and for Friendly day names (`_10`). Selecting one flips that setting and keeps
 * the picker open. Like upstream this is an array, not a component, so the menu body sees each row and keyboard
 * navigation reaches them.
 */
export function calendarPickerSettingsRows(
	settings: CalendarSettings,
	onToggle: (key: keyof CalendarSettings) => void,
): ReactElement[] {
	return [
		<MenuSeparator key="calendar-found-dates-separator" style={{margin: 0}} />,
		<MenuItem
			key="calendar-found-dates"
			label="Found Dates"
			subtext="Shows all matching dates"
			icon={<Toggle on={settings.foundDates} />}
			className={ROW_CLASS}
			onSelect={() => {
				onToggle("foundDates");
				return true;
			}}
		/>,
		<MenuSeparator key="calendar-friendly-names-separator" style={{margin: 0}} />,
		<MenuItem
			key="calendar-friendly-names"
			label="Friendly day names"
			subtext="Yesterday, Today, Tomorrow"
			icon={<Toggle on={settings.dayPrefix} />}
			className={ROW_CLASS}
			onSelect={() => {
				onToggle("dayPrefix");
				return true;
			}}
		/>,
	];
}

/**
 * Upstream `S10`, the strip picker's day content: the day number, then a `circle-small` dot pinned to the cell's
 * bottom only when `hasDot` (journal content, or a Found Date while Found Dates is on).
 */
export function calendarDayContent(hasDot: (date: Date) => boolean): DayContent {
	return (day) => {
		const color = day.selected ? "!text-on-color" : day.inCurrentMonth && day.now ? "text-tint" : "text-tertiary";
		return (
			<>
				{day.day.replace(/^0+/u, "")}
				{hasDot(day.$date) && (
					<FaIcon icon="fas:circle-small" className={`absolute bottom-[0px] w-s h-s ${color}`} />
				)}
			</>
		);
	};
}
