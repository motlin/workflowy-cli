import {navTooltips, nextOf, prevOf} from "@workflowy/shared";
import type {CalendarLevel} from "@workflowy/shared";
import type {CalendarTarget} from "./today.js";

/** Upstream's strip levels this app can zoom to (the account has no week level). */
export type StripLevel = CalendarLevel;

/** Upstream drag-to-scroll starts after this many pixels of horizontal movement. */
const DRAG_THRESHOLD = 4;

/** Upstream remembers a clicked month cell's scroll offset (`u21`) so the next page's strip keeps its position. */
let pendingScrollLeft: number | null = null;

/** Remember a clicked month cell's offset in `scroller` for the next page's strip. */
export function rememberScrollLeft(scroller: HTMLElement | null, ts: number): void {
	const delta = scroller === null ? null : scrollDelta(scroller, ts);
	if (scroller !== null && delta !== null) {
		pendingScrollLeft = delta + scroller.scrollLeft;
	}
}

/** The local date a `YYYYMMDD` / `YYYYMM00` / `YYYY0000` calendar dateId starts on. */
export function calendarPageDate(pageDateId: number): Date {
	const month = Math.floor(pageDateId / 100) % 100;
	return new Date(Math.floor(pageDateId / 10_000), Math.max(month, 1) - 1, Math.max(pageDateId % 100, 1));
}

export interface StripArrow {
	tooltip: string;
	target: CalendarTarget;
}

/** The arrows' tooltips (upstream's Today / Yesterday / Tomorrow rules) and the adjacent page at the zoomed level. */
export function stripNav(
	level: StripLevel,
	date: Date,
	now: Date,
	weekStartDay: number,
): {prev: StripArrow; next: StripArrow} {
	const [prevTooltip, nextTooltip] = navTooltips(level, date, now, weekStartDay);
	return {
		prev: {tooltip: prevTooltip, target: {date: prevOf(level, date), level}},
		next: {tooltip: nextTooltip, target: {date: nextOf(level, date), level}},
	};
}

/** A month cell: that month node on month and year pages (`stopAt:"month"`, no child), else its first day's page. */
export function monthCellTarget(level: StripLevel, month: Date): CalendarTarget {
	return level === "day" ? {date: month} : {date: month, level: "month", createChild: false};
}

/**
 * Upstream's strip scroll on mount: a month click's remembered offset wins;
 * otherwise the `targetTs` cell goes to the left edge, and without one a day
 * or month page scrolls home while a year page stays put.
 */
export function scrollStripOnMount(scroller: HTMLElement, targetTs: number, isYear: boolean): void {
	if (pendingScrollLeft !== null) {
		scroller.scrollLeft = pendingScrollLeft;
		pendingScrollLeft = null;
		return;
	}
	const delta = scrollDelta(scroller, targetTs);
	if (delta !== null) {
		scroller.scrollLeft += delta;
	} else if (!isYear) {
		scroller.scrollLeft = 0;
	}
}

interface ScrollGeometry {
	getBoundingClientRect: () => {left: number};
	querySelector: (selector: string) => {getBoundingClientRect: () => {left: number}} | null;
}

/** How far to scroll so the `[data-ts]` cell sits at the scroller's left edge, or null without one. */
export function scrollDelta(scroller: ScrollGeometry, ts: number): number | null {
	const cell = scroller.querySelector(`[data-ts="${ts}"]`);
	return cell === null ? null : cell.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
}

/** Swallow the click that ends a drag, so no cell navigates. */
function swallowClick(event: Event): void {
	event.stopPropagation();
	event.preventDefault();
}

function mouseX(event: Event): number {
	return "clientX" in event && typeof event.clientX === "number" ? event.clientX : 0;
}

function mouseButton(event: Event): number {
	return "button" in event && typeof event.button === "number" ? event.button : -1;
}

interface DragScroller extends EventTarget {
	scrollLeft: number;
	style: {cursor: string};
}

/**
 * Upstream's mouse drag-to-scroll: a left-button drag past 4px scrolls the
 * strip with `cursor: grabbing`, and the click that ends it is swallowed so no
 * cell navigates. Returns the cleanup.
 */
export function attachDragScroll(scroller: DragScroller, doc: EventTarget): () => void {
	let down = false;
	let dragging = false;
	let startX = 0;
	let startScroll = 0;
	const onDown = (event: Event) => {
		if (mouseButton(event) === 0) {
			down = true;
			dragging = false;
			startX = mouseX(event);
			startScroll = scroller.scrollLeft;
		}
	};
	const onMove = (event: Event) => {
		if (!down) {
			return;
		}
		const dx = mouseX(event) - startX;
		if (!dragging && Math.abs(dx) > DRAG_THRESHOLD) {
			dragging = true;
		}
		if (dragging) {
			scroller.scrollLeft = startScroll - dx;
			scroller.style.cursor = "grabbing";
		}
	};
	const onUp = () => {
		if (dragging) {
			scroller.addEventListener("click", swallowClick, {capture: true, once: true});
		}
		down = false;
		dragging = false;
		scroller.style.cursor = "";
	};
	scroller.addEventListener("mousedown", onDown);
	doc.addEventListener("mousemove", onMove);
	doc.addEventListener("mouseup", onUp);
	return () => {
		scroller.removeEventListener("mousedown", onDown);
		doc.removeEventListener("mousemove", onMove);
		doc.removeEventListener("mouseup", onUp);
	};
}
