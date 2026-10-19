import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {registerEditFlush, useOutlineStore} from "../stores/outline.js";
import {useUpdateNode} from "../hooks/use-nodes.js";
import {collectVisibleNodeIds} from "../hooks/use-visible-nodes.js";
import {adjacentVisibleNode, navigableIds} from "../caret-navigation.js";
import {noteContentHtml, planNoteKey, planNoteSave} from "../note-text.js";
import {placeCaretAtTextOffset} from "../caret-dom.js";
import {planDateInsertion} from "../date-pills.js";
import type {TimeAttrs} from "@workflowy/shared";
import {useBangDatePicker} from "./bang-date-picker.js";
import {useDateSettings} from "../hooks/use-preferences.js";
import {createEditDebouncer, TEXT_SAVE_DEBOUNCE_MS} from "../edit-debouncer.js";
import {useTagAutocomplete} from "../hooks/use-tag-autocomplete.js";
import type {TagAcceptHandler} from "../hooks/use-tag-autocomplete.js";
import {plainText} from "../rich-text.js";
import {spliceAcceptedTag} from "../tag-autocomplete.js";

interface EditableNoteProps {
	nodeId: string;
	initialValue: string;
	/** The store's focused note (`editingNoteId`) is this node's. */
	isFocused: boolean;
	/** The zoom root's note (`notes--main`). */
	isMain?: boolean;
}

/** Stands in for a date pill, one caret unit, in the plain text the tag autocomplete reads. */
const PILL_UNIT = "\uFFFC";

const CONTENT_CLASS = "notranslate content text-tertiary whitespace-pre-wrap overflow-hidden";

/** The selection's start/end as plain-text offsets into `element`, or null when the selection is outside it. */
function selectionOffsets(element: HTMLElement): {start: number; end: number} | null {
	const selection = globalThis.getSelection();
	if (selection === null || selection.rangeCount === 0) {
		return null;
	}
	const range = selection.getRangeAt(0);
	if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
		return null;
	}
	const before = document.createRange();
	before.selectNodeContents(element);
	before.setEnd(range.startContainer, range.startOffset);
	const start = before.toString().length;
	return {start, end: start + range.toString().length};
}

/** Replaces the selection with `text` as a plain text node and puts the caret `caretInText` characters into it. */
function insertAtSelection(text: string, caretInText: number): void {
	const selection = globalThis.getSelection();
	if (selection === null || selection.rangeCount === 0) {
		return;
	}
	const range = selection.getRangeAt(0);
	range.deleteContents();
	const textNode = document.createTextNode(text);
	range.insertNode(textNode);
	range.setStart(textNode, caretInText);
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}

/**
 * Upstream's sibling `.notes` after the row's `.name`: ONE always-contenteditable `.content`.
 * - A click places the caret at the click point and focuses the note; while focused, `.content` is `active` (unclamped)
 * - #tags and @mentions render as upstream's `span.contentTag`, both at rest and while focused
 * - Stored `<time>` dates render as monolith pills only at rest; the focused editor holds the raw `<time>` so pills are never saved
 * - Saves on input (debounced) and on blur, storing line breaks as `\n` (never `<br>`) via the note-text codec
 * - Edits are never reverted: Escape saves, exits the note, and opens search like upstream's global Escape
 * - Enter inserts a line break (two at the very end, the second a sentinel); Tab inserts a tab; Shift+Tab does nothing
 * - Shift+Enter saves and moves the caret to the end of the same row's name
 * - Backspace in a blank note clears it and moves the caret to the end of the name
 * - Up at the start / Left at the start leave for the name; Down / Right at the end leave for the next row's name
 */
export function EditableNote({nodeId, initialValue, isFocused, isMain = false}: EditableNoteProps) {
	const contentRef = useRef<HTMLDivElement>(null);
	const focusNote = useOutlineStore((state) => state.focusNote);
	const focusName = useOutlineStore((state) => state.focusName);
	const blurNote = useOutlineStore((state) => state.blurNote);
	const openSearchFromEditing = useOutlineStore((state) => state.openSearchFromEditing);
	const updateNodeMutation = useUpdateNode();
	const queryClient = useQueryClient();
	const dateSettings = useDateSettings();
	// The HTML as of focus, held while focused so optimistic saves never rewrite the DOM under the caret.
	const [focusedHtml, setFocusedHtml] = useState<string | null>(null);

	// Saves the note after each pause in typing; it holds the last note value saved (or loaded).
	const {mutate: updateNode} = updateNodeMutation;
	// One saver per node, so a pending save flushed after a node change still targets its own node.
	const noteSaver = useMemo(
		() =>
			createEditDebouncer({
				delay: TEXT_SAVE_DEBOUNCE_MS,
				save: ({after}) => {
					updateNode({nodeId, note: after});
				},
			}),
		[nodeId, updateNode],
	);

	// Focus from the store puts the caret at the requested start or end (Shift+Enter: end); a click keeps its caret.
	useEffect(() => {
		const element = contentRef.current;
		if (!isFocused || element === null || document.activeElement === element) {
			return;
		}
		element.focus();
		const range = document.createRange();
		range.selectNodeContents(element.querySelector(".innerContentContainer") ?? element);
		range.collapse(useOutlineStore.getState().editingNoteCaret === 0);
		const selection = globalThis.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}, [isFocused]);

	const saveNow = useCallback(() => {
		const element = contentRef.current;
		if (element === null) {
			noteSaver.flush();
			return;
		}
		noteSaver.saveNow(planNoteSave(noteSaver.saved, element.innerHTML).note);
	}, [noteSaver]);

	// Flush a pending debounced save if the editor unmounts first.
	useEffect(
		() => () => {
			noteSaver.flush();
		},
		[noteSaver],
	);

	// While focused, ⌘S and undo save the note's pending text in place.
	useEffect(() => (isFocused ? registerEditFlush(saveNow) : undefined), [isFocused, saveNow]);

	// While the `!!` date picker holds focus, the note's blur and refocus neither save nor re-render it.
	const datePickerOpen = useRef(false);

	const insertDate = useCallback(
		(attrs: TimeAttrs, offset: number) => {
			const element = contentRef.current;
			if (element !== null) {
				const plan = planDateInsertion(planNoteSave(noteSaver.saved, element.innerHTML).note, offset, attrs);
				element.focus();
				element.innerHTML = noteContentHtml(plan.html, dateSettings);
				placeCaretAtTextOffset(element, plan.caretOffset);
				noteSaver.saveNow(plan.html);
			}
			datePickerOpen.current = false;
		},
		[dateSettings, noteSaver],
	);

	const cancelDate = useCallback((offset: number) => {
		const element = contentRef.current;
		if (element !== null) {
			element.focus();
			placeCaretAtTextOffset(element, offset);
		}
		datePickerOpen.current = false;
	}, []);

	const openDate = useCallback(() => {
		datePickerOpen.current = true;
	}, []);

	const datePicker = useBangDatePicker({
		editorRef: contentRef,
		dateSettings,
		onOpen: openDate,
		onInsert: insertDate,
		onCancel: cancelDate,
	});
	const {handleInput: handleDateTrigger} = datePicker;

	// Typing a #tag or @mention offers the zoom subtree's matching tags; Tab, Enter or a click accepts one.
	const readNotePlain = useCallback(
		() =>
			contentRef.current === null
				? ""
				: plainText(planNoteSave(noteSaver.saved, contentRef.current.innerHTML).note, PILL_UNIT),
		[noteSaver],
	);
	const acceptTag = useCallback<TagAcceptHandler>(
		(edit) => {
			const element = contentRef.current;
			if (element !== null) {
				const note = spliceAcceptedTag(planNoteSave(noteSaver.saved, element.innerHTML).note, edit);
				element.innerHTML = noteContentHtml(note, dateSettings);
				placeCaretAtTextOffset(element, edit.caret);
				noteSaver.saveNow(note);
			}
		},
		[dateSettings, noteSaver],
	);
	const tagAutocomplete = useTagAutocomplete({editorRef: contentRef, readPlain: readNotePlain, onAccept: acceptTag});
	const {
		handleInput: handleTagAutocomplete,
		handleKeyDown: handleTagAutocompleteKey,
		detach: detachTagAutocomplete,
	} = tagAutocomplete;

	const handleInput = useCallback(
		(event?: React.SyntheticEvent<HTMLDivElement>) => {
			if (event !== undefined) {
				handleDateTrigger(event.nativeEvent);
			}
			handleTagAutocomplete();
			const element = contentRef.current;
			if (element !== null) {
				noteSaver.change(planNoteSave(noteSaver.saved, element.innerHTML).note);
			}
		},
		[handleDateTrigger, handleTagAutocomplete, noteSaver],
	);

	const handleFocus = useCallback(() => {
		if (datePickerOpen.current) {
			return;
		}
		noteSaver.reset(initialValue);
		setFocusedHtml(noteContentHtml(initialValue, dateSettings));
		if (!isFocused) {
			focusNote(nodeId);
		}
	}, [initialValue, dateSettings, isFocused, nodeId, focusNote, noteSaver]);

	const handleBlur = useCallback(() => {
		detachTagAutocomplete();
		if (datePickerOpen.current) {
			return;
		}
		saveNow();
		setFocusedHtml(null);
		blurNote(nodeId);
	}, [detachTagAutocomplete, saveNow, blurNote, nodeId]);

	const focusNextRowName = useCallback(() => {
		const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = useOutlineStore.getState();
		const visibleIds = navigableIds(
			zoomedNodeId,
			collectVisibleNodeIds(queryClient, zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds),
		);
		const targetId = adjacentVisibleNode(visibleIds, nodeId, "down");
		if (targetId !== null) {
			saveNow();
			focusName(targetId, 0);
		}
	}, [focusName, nodeId, queryClient, saveNow]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			const element = contentRef.current;
			if (element === null || handleTagAutocompleteKey(event)) {
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				element.blur();
				// Search-return resumes the node's name, not the note: a documented local deviation.
				openSearchFromEditing(nodeId, Number.MAX_SAFE_INTEGER);
				return;
			}
			const offsets = selectionOffsets(element);
			if (offsets === null) {
				return;
			}
			const text = element.textContent;
			const plan = planNoteKey({
				key: event.key,
				shift: event.shiftKey,
				text,
				start: offsets.start,
				end: offsets.end,
				onFirstLine: !text.slice(0, offsets.start).includes("\n"),
				onLastLine: !text.slice(offsets.end).includes("\n"),
			});
			if (plan.kind === "native") {
				return;
			}
			event.preventDefault();
			switch (plan.kind) {
				case "insert": {
					insertAtSelection(plan.text, plan.caret - offsets.start);
					handleInput();
					break;
				}
				case "focusName": {
					saveNow();
					focusName(nodeId, plan.caret);
					break;
				}
				case "focusNextRowName": {
					focusNextRowName();
					break;
				}
				case "clearAndFocusName": {
					element.innerHTML = "";
					saveNow();
					focusName(nodeId, "end");
					break;
				}
				case "noop": {
					break;
				}
			}
		},
		[focusName, focusNextRowName, handleInput, handleTagAutocompleteKey, nodeId, openSearchFromEditing, saveNow],
	);

	return (
		<div className={isMain ? "notes notes--main" : "notes"}>
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- contentEditable makes this an implicit textbox, which the rule does not model */}
			<div
				className={isFocused ? `${CONTENT_CLASS} active` : CONTENT_CLASS}
				contentEditable
				dangerouslySetInnerHTML={{
					__html: focusedHtml ?? noteContentHtml(initialValue, dateSettings),
				}}
				onBlur={handleBlur}
				onFocus={handleFocus}
				onInput={handleInput}
				onKeyDown={handleKeyDown}
				onMouseDown={detachTagAutocomplete}
				ref={contentRef}
				suppressContentEditableWarning
			/>
			{datePicker.popup}
			{tagAutocomplete.popup}
		</div>
	);
}
