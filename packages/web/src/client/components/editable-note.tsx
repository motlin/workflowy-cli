import {useCallback, useEffect, useRef, useState} from "react";
import {useOutlineStore} from "../stores/outline.js";
import {useUpdateNode} from "../hooks/use-nodes.js";
import {noteToEditorHtml, planNoteSave} from "../note-text.js";

interface EditableNoteProps {
	nodeId: string;
	initialValue: string;
	/** The store's focused note (`editingNoteId`) is this node's. */
	isFocused: boolean;
	/** The zoom root's note (`notes--main`). */
	isMain?: boolean;
}

const SAVE_DEBOUNCE_MS = 500;

const CONTENT_CLASS = "notranslate content text-tertiary whitespace-pre-wrap overflow-hidden";

/** The note's `.content` inner HTML: `.innerContentContainer` around the note, or nothing for an empty note. */
function contentHtml(note: string): string {
	return note === "" ? "" : `<span class="innerContentContainer">${noteToEditorHtml(note)}</span>`;
}

/**
 * Upstream's sibling `.notes` after the row's `.name`: ONE always-contenteditable `.content`.
 * - A click places the caret at the click point and focuses the note; while focused, `.content` is `active` (unclamped)
 * - Saves on input (debounced) and on blur, storing line breaks as `\n` (never `<br>`) via the note-text codec
 * - Edits are never reverted: Escape saves, exits the note, and opens search like upstream's global Escape
 * - Enter (without shift) saves and exits the note
 */
export function EditableNote({nodeId, initialValue, isFocused, isMain = false}: EditableNoteProps) {
	const contentRef = useRef<HTMLDivElement>(null);
	const startEditingNote = useOutlineStore((state) => state.startEditingNote);
	const stopEditingNote = useOutlineStore((state) => state.stopEditingNote);
	const openSearchFromEditing = useOutlineStore((state) => state.openSearchFromEditing);
	const updateNodeMutation = useUpdateNode();
	// The HTML as of focus, held while focused so optimistic saves never rewrite the DOM under the caret.
	const [focusedHtml, setFocusedHtml] = useState<string | null>(null);

	// The last note value saved (or loaded), so unchanged values are never re-saved.
	const savedValueRef = useRef(initialValue);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// The editor HTML as of the last input, read when the editor's ref is already detached on unmount.
	const latestHtmlRef = useRef<string | null>(null);

	// Focus from the store (e.g. Shift+Enter in the name) puts the caret at the end; a click keeps its caret.
	useEffect(() => {
		const element = contentRef.current;
		if (!isFocused || element === null || document.activeElement === element) {
			return;
		}
		element.focus();
		const range = document.createRange();
		range.selectNodeContents(element.querySelector(".innerContentContainer") ?? element);
		range.collapse(false);
		const selection = globalThis.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}, [isFocused]);

	const cancelPendingSave = useCallback(() => {
		if (saveTimerRef.current !== null) {
			globalThis.clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}
	}, []);

	const saveNow = useCallback(() => {
		cancelPendingSave();
		const html = contentRef.current?.innerHTML ?? latestHtmlRef.current;
		if (html === null) {
			return;
		}
		const plan = planNoteSave(savedValueRef.current, html);
		if (plan.save) {
			savedValueRef.current = plan.note;
			updateNodeMutation.mutate({nodeId, note: plan.note});
		}
	}, [cancelPendingSave, nodeId, updateNodeMutation]);

	// Flush a pending debounced save if the editor unmounts (or saveNow changes) first.
	useEffect(
		() => () => {
			if (saveTimerRef.current !== null) {
				saveNow();
			}
		},
		[saveNow],
	);

	const handleInput = useCallback(() => {
		latestHtmlRef.current = contentRef.current?.innerHTML ?? null;
		cancelPendingSave();
		saveTimerRef.current = globalThis.setTimeout(saveNow, SAVE_DEBOUNCE_MS);
	}, [cancelPendingSave, saveNow]);

	const handleFocus = useCallback(() => {
		savedValueRef.current = initialValue;
		setFocusedHtml(contentHtml(initialValue));
		if (!isFocused) {
			startEditingNote(nodeId);
		}
	}, [initialValue, isFocused, nodeId, startEditingNote]);

	const handleBlur = useCallback(() => {
		saveNow();
		setFocusedHtml(null);
		stopEditingNote();
	}, [saveNow, stopEditingNote]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				contentRef.current?.blur();
			} else if (event.key === "Escape") {
				event.preventDefault();
				contentRef.current?.blur();
				// Search-return resumes the node's name, not the note: a documented local deviation.
				openSearchFromEditing(nodeId, Number.MAX_SAFE_INTEGER);
			}
		},
		[nodeId, openSearchFromEditing],
	);

	return (
		<div className={isMain ? "notes notes--main" : "notes"}>
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- contentEditable makes this an implicit textbox, which the rule does not model */}
			<div
				className={isFocused ? `${CONTENT_CLASS} active` : CONTENT_CLASS}
				contentEditable
				dangerouslySetInnerHTML={{__html: focusedHtml ?? contentHtml(initialValue)}}
				onBlur={handleBlur}
				onFocus={handleFocus}
				onInput={handleInput}
				onKeyDown={handleKeyDown}
				ref={contentRef}
				suppressContentEditableWarning
			/>
		</div>
	);
}
