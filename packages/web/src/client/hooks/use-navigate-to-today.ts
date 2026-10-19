import {useNavigate} from "react-router-dom";
import {editorElement} from "../caret-dom.js";
import {useOutlineStore} from "../stores/outline.js";
import {navigateToToday} from "../today.js";

/** `navigateToToday` bound to the router and the outline store; shared by ⌃T, the Today button and the Today row. */
export function useNavigateToToday(): () => Promise<void> {
	const navigate = useNavigate();
	return async () => {
		const store = useOutlineStore.getState();
		await navigateToToday({
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
			now: new Date(),
		});
	};
}
