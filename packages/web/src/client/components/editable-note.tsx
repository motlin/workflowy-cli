import {useCallback, useEffect, useRef, useState} from "react";
import {useOutlineStore} from "../stores/outline.js";
import {useUpdateNode} from "../hooks/use-nodes.js";
import {DEFAULT_DATE_SETTINGS, renderDatePills} from "../date-pills.js";
import {renderTags} from "../tag-render.js";
import {noteToEditorHtml, planNoteSave} from "../note-text.js";

interface EditableNoteProps {
	nodeId: string;
	initialValue: string;
	isEditing: boolean;
}

const SAVE_DEBOUNCE_MS = 500;

/**
 * Inline editable note component using contenteditable.
 * - Rendered as upstream's sibling `.notes` after the row's `.name`
 * - Saves on input (debounced) and on blur, storing line breaks as `\n` (never `<br>`) via the note-text codec
 * - Edits are never reverted: Escape saves, exits the note, and opens search like upstream's global Escape
 * - Enter (without shift) saves and exits editing mode
 * - Shift+Enter inserts a line break
 * - Collapsible with expand/collapse toggle for long notes
 */
export function EditableNote({nodeId, initialValue, isEditing}: EditableNoteProps) {
	const contentRef = useRef<HTMLSpanElement>(null);
	const stopEditingNote = useOutlineStore((state) => state.stopEditingNote);
	const openSearchFromEditing = useOutlineStore((state) => state.openSearchFromEditing);
	const updateNodeMutation = useUpdateNode();
	const [isExpanded, setIsExpanded] = useState(false);

	// The last note value saved (or loaded), so unchanged values are never re-saved.
	const savedValueRef = useRef(initialValue);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// The editor HTML as of the last input, read when the editor's ref is already detached on unmount.
	const latestHtmlRef = useRef<string | null>(null);

	// Focus when entering edit mode
	useEffect(() => {
		if (isEditing && contentRef.current) {
			contentRef.current.focus();
			// Move cursor to end of content
			const range = document.createRange();
			range.selectNodeContents(contentRef.current);
			range.collapse(false);
			const selection = globalThis.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			savedValueRef.current = initialValue;
		}
	}, [isEditing, initialValue]);

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

	const handleBlur = useCallback(() => {
		saveNow();
		stopEditingNote();
	}, [saveNow, stopEditingNote]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLSpanElement>) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				saveNow();
				stopEditingNote();
			} else if (event.key === "Escape") {
				event.preventDefault();
				saveNow();
				stopEditingNote();
				// Search-return resumes the node's name, not the note: a documented local deviation.
				openSearchFromEditing(nodeId, Number.MAX_SAFE_INTEGER);
			}
		},
		[nodeId, openSearchFromEditing, saveNow, stopEditingNote],
	);

	const toggleExpand = useCallback((event: React.MouseEvent) => {
		event.stopPropagation();
		setIsExpanded((prev) => !prev);
	}, []);

	// Only show note if editing or has content
	const hasContent = initialValue.trim() !== "";
	if (!isEditing && !hasContent) {
		return null;
	}

	const contentClassName = `notranslate content text-tertiary whitespace-pre-wrap overflow-hidden${isExpanded ? " expanded" : ""}`;

	if (!isEditing) {
		// Expanding only lifts the visual clamp; the full note text is already exposed to assistive tech.
		return (
			<div className="notes">
				{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- mouse-only clamp toggle; upstream's markup carries no role */}
				<div className={contentClassName} onClick={toggleExpand}>
					<span
						className="innerContentContainer"
						dangerouslySetInnerHTML={{
							__html: renderTags(renderDatePills(initialValue, DEFAULT_DATE_SETTINGS)),
						}}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="notes">
			<div className={contentClassName}>
				{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- contentEditable makes this an implicit textbox, which the rule does not model */}
				<span
					className="innerContentContainer"
					contentEditable
					dangerouslySetInnerHTML={{__html: noteToEditorHtml(initialValue)}}
					onBlur={handleBlur}
					onInput={handleInput}
					onKeyDown={handleKeyDown}
					ref={contentRef}
					suppressContentEditableWarning
				/>
			</div>
		</div>
	);
}
