import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

/**
 * Chevron left icon for calendar navigation.
 */
function ChevronLeftIcon() {
	return (
		<svg
			fill="currentColor"
			height="16"
			viewBox="0 0 320 512"
			width="16"
		>
			<path d="M20.7 267.3c-6.2-6.2-6.2-16.4 0-22.6l192-192c6.2-6.2 16.4-6.2 22.6 0s6.2 16.4 0 22.6L54.6 256 235.3 436.7c6.2 6.2 6.2 16.4 0 22.6s-16.4 6.2-22.6 0l-192-192z" />
		</svg>
	);
}

/**
 * Chevron right icon for calendar navigation.
 */
function ChevronRightIcon() {
	return (
		<svg
			fill="currentColor"
			height="16"
			viewBox="0 0 320 512"
			width="16"
		>
			<path d="M299.3 244.7c6.2 6.2 6.2 16.4 0 22.6l-192 192c-6.2 6.2-16.4 6.2-22.6 0s-6.2-16.4 0-22.6L265.4 256 84.7 75.3c-6.2-6.2-6.2-16.4 0-22.6s16.4-6.2 22.6 0l192 192z" />
		</svg>
	);
}

const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface CalendarDay {
	date: Date;
	day: number;
	isCurrentMonth: boolean;
	isToday: boolean;
}

function getCalendarDays(year: number, month: number): CalendarDay[] {
	const today = new Date();
	const todayString = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

	const firstDayOfMonth = new Date(year, month, 1);
	const lastDayOfMonth = new Date(year, month + 1, 0);

	const startDayOfWeek = firstDayOfMonth.getDay();
	const daysInMonth = lastDayOfMonth.getDate();

	const days: CalendarDay[] = [];

	// Add days from previous month
	const prevMonth = month === 0 ? 11 : month - 1;
	const prevMonthYear = month === 0 ? year - 1 : year;
	const daysInPrevMonth = new Date(prevMonthYear, prevMonth + 1, 0).getDate();

	for (let i = startDayOfWeek - 1; i >= 0; i--) {
		const day = daysInPrevMonth - i;
		const date = new Date(prevMonthYear, prevMonth, day);
		const dateString = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
		days.push({
			date,
			day,
			isCurrentMonth: false,
			isToday: dateString === todayString,
		});
	}

	// Add days of current month
	for (let day = 1; day <= daysInMonth; day++) {
		const date = new Date(year, month, day);
		const dateString = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
		days.push({
			date,
			day,
			isCurrentMonth: true,
			isToday: dateString === todayString,
		});
	}

	// Add days from next month to fill the grid (6 rows = 42 cells)
	const remainingCells = 42 - days.length;
	const nextMonth = month === 11 ? 0 : month + 1;
	const nextMonthYear = month === 11 ? year + 1 : year;

	for (let day = 1; day <= remainingCells; day++) {
		const date = new Date(nextMonthYear, nextMonth, day);
		const dateString = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
		days.push({
			date,
			day,
			isCurrentMonth: false,
			isToday: dateString === todayString,
		});
	}

	return days;
}

interface CalendarPanelProps {
	isOpen: boolean;
	onClose: () => void;
	onDateSelect?: (date: Date) => void;
	anchorRef: React.RefObject<HTMLElement | null>;
}

/**
 * Calendar panel component matching Workflowy's calendar design.
 * Shows a monthly calendar grid with navigation and date selection.
 */
export function CalendarPanel({isOpen, onClose, onDateSelect, anchorRef}: CalendarPanelProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const today = new Date();
	const [viewMonth, setViewMonth] = useState(today.getMonth());
	const [viewYear, setViewYear] = useState(today.getFullYear());

	const calendarDays = useMemo(() => getCalendarDays(viewYear, viewMonth), [viewYear, viewMonth]);

	const handlePreviousMonth = useCallback(() => {
		if (viewMonth === 0) {
			setViewMonth(11);
			setViewYear((y) => y - 1);
		} else {
			setViewMonth((m) => m - 1);
		}
	}, [viewMonth]);

	const handleNextMonth = useCallback(() => {
		if (viewMonth === 11) {
			setViewMonth(0);
			setViewYear((y) => y + 1);
		} else {
			setViewMonth((m) => m + 1);
		}
	}, [viewMonth]);

	const handleDateClick = useCallback(
		(day: CalendarDay) => {
			onDateSelect?.(day.date);
			onClose();
		},
		[onDateSelect, onClose],
	);

	// Handle click outside to close
	useEffect(() => {
		if (!isOpen) return;

		function handleClickOutside(event: MouseEvent) {
			const target = event.target as Node;
			if (
				panelRef.current &&
				!panelRef.current.contains(target) &&
				anchorRef.current &&
				!anchorRef.current.contains(target)
			) {
				onClose();
			}
		}

		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				onClose();
			}
		}

		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('keydown', handleEscape);

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [isOpen, onClose, anchorRef]);

	if (!isOpen) return null;

	// Split days into weeks (7 days per row)
	const weeks: CalendarDay[][] = [];
	for (let i = 0; i < calendarDays.length; i += 7) {
		weeks.push(calendarDays.slice(i, i + 7));
	}

	return (
		<div
			className="calendar-panel"
			ref={panelRef}
		>
			<div className="calendar-content">
				{/* Header with month/year navigation */}
				<header className="calendar-header">
					<div className="calendar-month-year">
						<button
							className="calendar-month-button"
							type="button"
						>
							{MONTHS[viewMonth]}
						</button>
						<button
							className="calendar-year-button"
							type="button"
						>
							{viewYear}
						</button>
					</div>
					<div className="calendar-nav">
						<button
							aria-label="Previous month"
							className="calendar-nav-button"
							onClick={handlePreviousMonth}
							type="button"
						>
							<ChevronLeftIcon />
						</button>
						<button
							aria-label="Next month"
							className="calendar-nav-button"
							onClick={handleNextMonth}
							type="button"
						>
							<ChevronRightIcon />
						</button>
					</div>
				</header>

				{/* Day of week labels */}
				<div className="calendar-weekdays">
					{DAYS_OF_WEEK.map((day) => (
						<div
							className="calendar-weekday"
							key={day}
						>
							{day}
						</div>
					))}
				</div>

				{/* Calendar grid */}
				<div className="calendar-grid">
					{weeks.map((week, weekIndex) => (
						<div
							className="calendar-week"
							key={weekIndex}
						>
							{week.map((day, dayIndex) => (
								<button
									className={`calendar-day ${day.isCurrentMonth ? '' : 'other-month'} ${day.isToday ? 'today' : ''}`}
									key={`${weekIndex}-${dayIndex}`}
									onClick={() => handleDateClick(day)}
									type="button"
								>
									<div className="calendar-day-inner">{day.day}</div>
								</button>
							))}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
