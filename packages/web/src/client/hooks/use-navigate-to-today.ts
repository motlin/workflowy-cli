import {useNavigate} from "react-router-dom";
import {editorElement} from "../caret-dom.js";
import {useOutlineStore} from "../stores/outline.js";
import {navigateToCalendarDate, navigateToToday} from "../today.js";
import type {CalendarTarget, NavigateToCalendarDeps} from "../today.js";

/** The calendar navigation deps bound to the router and the outline store. */
function useCalendarDeps(): () => NavigateToCalendarDeps {
	const navigate = useNavigate();
	return () => {
		const store = useOutlineStore.getState();
		return {
			fetch: globalThis.fetch,
			navigate,
			notify: store.addErrorNotification,
			startEditing: store.resumeEditing,
			commitEdit: () => {
				const {editingId} = useOutlineStore.getState();
				if (editingId !== null) {
					editorElement(editingId)?.blur();
				}
			},
		};
	};
}

/** `navigateToToday` bound to the router and the outline store; shared by ⌃T, the Today button and the Today row. */
export function useNavigateToToday(): () => Promise<void> {
	const deps = useCalendarDeps();
	return async () => {
		await navigateToToday({...deps(), now: new Date()});
	};
}

/** `navigateToCalendarDate` bound to the router and the outline store; used by the day strip. */
export function useNavigateToCalendarDate(): (target: CalendarTarget) => Promise<void> {
	const deps = useCalendarDeps();
	return async (target) => {
		await navigateToCalendarDate(target, deps());
	};
}
