import {useOutlineStore} from "../stores/outline.js";
import type {ClickPosition} from "../stores/outline.js";

/**
 * Whether `nodeId` is the row being edited, and where its editing click landed. Each row selects only its own answer,
 * so moving the editor re-renders the two rows it leaves and enters, not every row.
 */
export function useNodeEditing(nodeId: string): {editing: boolean; clickPosition: ClickPosition | null} {
	const editing = useOutlineStore((state) => state.editingId === nodeId);
	const clickPosition = useOutlineStore((state) => (state.editingId === nodeId ? state.editingClickPosition : null));
	return {editing, clickPosition};
}
