import {useCallback, useEffect, useRef, useState} from "react";
import {useOutlineStore} from "../stores/outline.js";
import {useUpdateNode} from "../hooks/use-nodes.js";
import {DEFAULT_DATE_SETTINGS, renderDatePills} from "../date-pills.js";
import {renderTags} from "../tag-render.js";
import {editorHtmlToNote, noteToEditorHtml} from "../note-text.js";

interface EditableNoteProps {
	nodeId: string;
	initialValue: string;
	isEditing: boolean;
}

/**
 * Inline editable note component using contenteditable.
 * - Rendered as upstream's sibling `.notes` after the row's `.name`
 * - Saves on blur, storing line breaks as `\n` (never `<br>`) via the note-text codec
 * - Escape cancels editing and hides note if empty
 * - Enter (without shift) exits editing mode
 * - Shift+Enter inserts a line break
 * - Collapsible with expand/collapse toggle for long notes
 */
export function EditableNote({nodeId, initialValue, isEditing}: EditableNoteProps) {
	const contentRef = useRef<HTMLSpanElement>(null);
	const stopEditingNote = useOutlineStore((state) => state.stopEditingNote);
	const updateNodeMutation = useUpdateNode();
	const [isExpanded, setIsExpanded] = useState(false);

	// Store the value at the time editing started for comparison
	const initialValueRef = useRef(initialValue);

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
			// Store the initial value when starting to edit
			initialValueRef.current = initialValue;
		}
	}, [isEditing, initialValue]);

	const saveChanges = useCallback(() => {
		if (!contentRef.current) {
			return;
		}

		const newValue = editorHtmlToNote(contentRef.current.innerHTML);

		// Only save if the value has changed
		if (newValue !== initialValueRef.current) {
			updateNodeMutation.mutate({
				nodeId,
				note: newValue,
			});
		}

		stopEditingNote();
	}, [nodeId, updateNodeMutation, stopEditingNote]);

	const handleBlur = useCallback(() => {
		saveChanges();
	}, [saveChanges]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLSpanElement>) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				saveChanges();
			} else if (event.key === "Escape") {
				event.preventDefault();
				// Restore original value on escape
				if (contentRef.current) {
					contentRef.current.innerHTML = noteToEditorHtml(initialValueRef.current);
				}
				stopEditingNote();
			}
		},
		[saveChanges, stopEditingNote],
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
					onKeyDown={handleKeyDown}
					ref={contentRef}
					suppressContentEditableWarning
				/>
			</div>
		</div>
	);
}
