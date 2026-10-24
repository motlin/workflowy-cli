import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {usePaneSearchQuery} from "../hooks/use-tree-search.js";
import {activePaneView, isModalOpen, outlineActions, registerEditFlush, useOutlineStore} from "../stores/outline.js";
import {useUpdateNode} from "../hooks/use-nodes.js";
import {useLatest} from "../hooks/use-latest.js";
import {collectVisibleNodeIds} from "../hooks/use-visible-nodes.js";
import {adjacentVisibleNode, navigableIds} from "../caret-navigation.js";
import {editorHtmlToNote, noteContentHtml, planNoteKey, planNoteSave} from "../note-text.js";
import {isComposingInput, retagEditor} from "../editor-html.js";
import {placeCaretAtTextOffset} from "../caret-dom.js";
import {savePaneCaretOnBlur} from "./pane-context.js";
import {planDateInsertion, planPillReplacement} from "../date-pills.js";
import {deleteAdjacentPill} from "../pill-delete.js";
import type {TimeAttrs} from "@workflowy/shared";
import {useBangDatePicker} from "./bang-date-picker.js";
import {clickedPill, offsetAfterPill, usePillDatePicker} from "./pill-date-picker.js";
import {useAccount} from "../hooks/use-account.js";
import {useDateSettings} from "../hooks/use-preferences.js";
import {createEditDebouncer, TEXT_SAVE_DEBOUNCE_MS} from "../edit-debouncer.js";
import {useInlineFormat} from "../hooks/use-inline-format.js";
import {toolbarFormatAttr, useSelectionToolbar} from "../hooks/use-selection-toolbar.js";
import {SelectionToolbar} from "./selection-toolbar.js";
import type {SelectionToolbarAction} from "./selection-toolbar.js";
import {useTagAutocomplete} from "../hooks/use-tag-autocomplete.js";
import type {TagAcceptHandler} from "../hooks/use-tag-autocomplete.js";
import {classifyFormatKey, isMacPlatform} from "../editable-text-keys.js";
import {plainText} from "../rich-text.js";
import {spliceAcceptedTag} from "../tag-autocomplete.js";
import {useSlashMenu} from "../hooks/use-slash-menu.js";
import {stripSlashChip} from "../slash-trigger.js";
import {withClasses} from "../search-classes.js";
import {highlightSearchMatches} from "../highlight-html.js";

interface EditableNoteProps {
	nodeId: string;
	initialValue: string;
	/** The store's focused note (`editingNoteId`) is this node's. */
	isFocused: boolean;
	/** The zoom root's note (`notes--main`). */
	isMain?: boolean;
	/** Classes appended to `.notes`, like a search's `matches fullMatch`. */
	extraClasses?: readonly string[];
}

/** Stands in for a date pill, one caret unit, in the plain text the tag autocomplete reads. */
const PILL_UNIT = "\uFFFC";

const NO_EXTRA_CLASSES: readonly string[] = [];

/** The note's text container, where its caret offsets count from. */
function noteTextElement(element: HTMLElement): HTMLElement {
	return element.querySelector<HTMLElement>(".innerContentContainer") ?? element;
}

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
 * - #tags and @mentions render as upstream's `span.contentTag`, both at rest and while focused, re-rendered on every input
 * - Stored `<time>` dates and `<mention>`s render as atomic monolith pills; the codec serializes them back to canonical markup on save
 * - A plain click on a date pill opens the date picker on it to change or remove that date
 * - Saves on input (debounced) and on blur, storing line breaks as `\n` (never `<br>`) via the note-text codec
 * - Edits are never reverted: Escape is left to the global search Escape, which saves, exits the note, and focuses search
 * - Enter inserts a line break (two at the very end, the second a sentinel); Tab inserts a tab; Shift+Tab does nothing
 * - Shift+Enter saves and moves the caret to the end of the same row's name
 * - Backspace right after / Delete right before a date pill removes the whole pill and saves
 * - Backspace in a blank note clears it and moves the caret to the end of the name
 * - Up at the start / Left at the start leave for the name; Down / Right at the end leave for the next row's name
 */
export function EditableNote({
	nodeId,
	initialValue,
	isFocused,
	isMain = false,
	extraClasses = NO_EXTRA_CLASSES,
}: EditableNoteProps) {
	const contentRef = useRef<HTMLDivElement>(null);
	const {focusNote, focusName, blurNote} = outlineActions();
	const updateNodeMutation = useUpdateNode();
	const queryClient = useQueryClient();
	const dateSettings = useDateSettings();
	const account = useAccount();
	// The HTML as of focus, held while focused so optimistic saves never rewrite the DOM under the caret.
	const [focusedHtml, setFocusedHtml] = useState<string | null>(null);
	const searchQuery = usePaneSearchQuery();
	const restingHtml = noteContentHtml(initialValue, dateSettings, undefined, account);
	// Search highlights live only in the DOM: React keeps the plain HTML, so focusing never rewrites the DOM
	// under the caret, and a focused (editing) note never carries .contentMatch spans.
	const highlightedHtml = focusedHtml === null ? highlightSearchMatches(restingHtml, searchQuery) : null;
	useLayoutEffect(() => {
		const element = contentRef.current;
		if (element !== null && highlightedHtml !== null && element.innerHTML !== highlightedHtml) {
			element.innerHTML = highlightedHtml;
		}
	}, [highlightedHtml]);
	const clearSearchHighlights = useCallback(() => {
		const element = contentRef.current;
		if (element?.querySelector(".contentMatch")) {
			element.innerHTML = restingHtml;
		}
	}, [restingHtml]);

	// Saves the note after each pause in typing; it holds the last note value saved (or loaded).
	// The latest mutate, so the saver never depends on its identity.
	const updateNode = useLatest(updateNodeMutation.mutate);
	// One saver per node, so a pending save flushed after a node change still targets its own node.
	const noteSaver = useMemo(
		() =>
			createEditDebouncer({
				delay: TEXT_SAVE_DEBOUNCE_MS,
				save: ({after}) => {
					updateNode.current({nodeId, note: after});
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
		const caret = useOutlineStore.getState().editingNoteCaret;
		if (caret !== "end" && caret > 0) {
			placeCaretAtTextOffset(noteTextElement(element), caret);
			return;
		}
		const range = document.createRange();
		range.selectNodeContents(noteTextElement(element));
		range.collapse(caret === 0);
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
		noteSaver.saveNow(planNoteSave(noteSaver.saved, stripSlashChip(element.innerHTML)).note);
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
				element.innerHTML = noteContentHtml(plan.html, dateSettings, undefined, account);
				placeCaretAtTextOffset(element, plan.caretOffset);
				noteSaver.saveNow(plan.html);
			}
			datePickerOpen.current = false;
		},
		[dateSettings, account, noteSaver],
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

	// A plain click on a pill (the note at rest or focused) edits or removes just that pill in the live note, which
	// keeps focus: like the `!!` picker, the picker's focus neither saves nor re-renders the note.
	const pillCaret = useRef(0);
	const pillPicker = usePillDatePicker({
		dateSettings,
		onChange: (pillIndex, attrs) => {
			const element = contentRef.current;
			if (element !== null) {
				const plan = planPillReplacement(
					planNoteSave(noteSaver.saved, element.innerHTML).note,
					pillIndex,
					attrs,
				);
				element.focus();
				element.innerHTML = noteContentHtml(plan.html, dateSettings, undefined, account);
				placeCaretAtTextOffset(element, plan.caretOffset);
				noteSaver.saveNow(plan.html);
			}
			datePickerOpen.current = false;
		},
		onDismiss: () => {
			cancelDate(pillCaret.current);
		},
	});
	const {open: openPillPicker} = pillPicker;
	const handleClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			const clicked = clickedPill(event, event.currentTarget);
			if (clicked === null) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			pillCaret.current = offsetAfterPill(event.currentTarget, clicked.pill);
			datePickerOpen.current = true;
			openPillPicker(clicked.pill, clicked.index);
		},
		[openPillPicker],
	);

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
				element.innerHTML = noteContentHtml(note, dateSettings, undefined, account);
				placeCaretAtTextOffset(element, edit.caret);
				noteSaver.saveNow(note);
			}
		},
		[dateSettings, account, noteSaver],
	);
	const tagAutocomplete = useTagAutocomplete({
		editorRef: contentRef,
		nodeId,
		field: "note",
		readPlain: readNotePlain,
		onAccept: acceptTag,
	});
	const {
		handleInput: handleTagAutocomplete,
		handleKeyDown: handleTagAutocompleteKey,
		detach: detachTagAutocomplete,
	} = tagAutocomplete;

	// Typing a first or standalone "/" opens the slash command menu under a chip; it never schedules a save while open.
	const changeNote = useCallback(() => {
		const element = contentRef.current;
		if (element !== null) {
			noteSaver.change(planNoteSave(noteSaver.saved, stripSlashChip(element.innerHTML)).note);
		}
	}, [noteSaver]);
	const slashMenu = useSlashMenu({editorRef: contentRef, nodeId, onChange: changeNote, onSave: saveNow});
	const {
		handleInput: handleSlashInput,
		handleKeyDown: handleSlashKey,
		isOpen: isSlashOpen,
		detach: detachSlashMenu,
	} = slashMenu;

	const handleInput = useCallback(
		(event?: React.SyntheticEvent<HTMLDivElement>) => {
			// The note codec drops the slash chip, so tags wait while the slash menu is open.
			const element = contentRef.current;
			if (element !== null && !isSlashOpen() && !isComposingInput(event?.nativeEvent)) {
				retagEditor(
					element,
					noteContentHtml(editorHtmlToNote(element.innerHTML), dateSettings, undefined, account),
				);
			}
			handleSlashInput(event?.nativeEvent);
			if (event !== undefined) {
				handleDateTrigger(event.nativeEvent);
			}
			// One inline suggest popup at a time: an open slash menu owns the keys, so the tag popup stays closed.
			if (isSlashOpen()) {
				detachTagAutocomplete();
			} else {
				handleTagAutocomplete();
				changeNote();
			}
		},
		[
			changeNote,
			dateSettings,
			account,
			handleSlashInput,
			isSlashOpen,
			handleDateTrigger,
			handleTagAutocomplete,
			detachTagAutocomplete,
		],
	);

	// ⌘B/⌘I/⌘U/⇧⌘X/⇧⌘C toggle the selection's format, or make it pending for the next typed character.
	const readNote = useCallback(
		() => (contentRef.current === null ? "" : planNoteSave(noteSaver.saved, contentRef.current.innerHTML).note),
		[noteSaver],
	);
	const {applyInlineToggle} = useInlineFormat({
		editorRef: contentRef,
		active: true,
		read: readNote,
		render: (note) => noteContentHtml(note, dateSettings, undefined, account),
		onChange: (note) => {
			noteSaver.change(note);
		},
	});

	// Upstream's floating format toolbar over a stretched selection in the focused note (no type buttons).
	const {view: toolbarView} = useSelectionToolbar({
		editorRef: contentRef,
		active: isFocused,
		read: readNote,
		modalOpen: isModalOpen,
	});
	const {openLinkInsert} = outlineActions();
	const handleToolbarAction = useCallback(
		(action: SelectionToolbarAction) => {
			const attr = toolbarFormatAttr(action);
			const selection = globalThis.getSelection();
			if (attr !== null) {
				applyInlineToggle(attr);
			} else if (action === "link" && selection !== null && selection.rangeCount > 0) {
				openLinkInsert({
					selectedText: selection.toString().trim(),
					nodeId,
					range: selection.getRangeAt(0).cloneRange(),
				});
			}
		},
		[applyInlineToggle, nodeId, openLinkInsert],
	);

	const handleFocus = useCallback(() => {
		if (datePickerOpen.current) {
			return;
		}
		clearSearchHighlights();
		noteSaver.reset(initialValue);
		setFocusedHtml(restingHtml);
		if (!isFocused) {
			focusNote(nodeId);
		}
	}, [clearSearchHighlights, initialValue, restingHtml, isFocused, nodeId, focusNote, noteSaver]);

	const handleBlur = useCallback(() => {
		const element = contentRef.current;
		if (element !== null) {
			savePaneCaretOnBlur(element, nodeId, "note", noteTextElement(element));
		}
		detachSlashMenu();
		detachTagAutocomplete();
		if (datePickerOpen.current) {
			return;
		}
		saveNow();
		setFocusedHtml(null);
		blurNote(nodeId);
	}, [detachSlashMenu, detachTagAutocomplete, saveNow, blurNote, nodeId]);

	const focusNextRowName = useCallback(() => {
		const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = activePaneView();
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
			if (handleSlashKey(event)) {
				return;
			}
			const element = contentRef.current;
			if (element === null || handleTagAutocompleteKey(event)) {
				return;
			}
			const formatAttr = classifyFormatKey(event, isMacPlatform());
			if (formatAttr !== null && !event.nativeEvent.isComposing) {
				event.preventDefault();
				applyInlineToggle(formatAttr);
				return;
			}
			if (event.key === "Backspace" || event.key === "Delete") {
				const next = deleteAdjacentPill(
					element,
					planNoteSave(noteSaver.saved, element.innerHTML).note,
					event.key === "Backspace" ? "backward" : "forward",
					(note) => noteContentHtml(note, dateSettings, undefined, account),
				);
				if (next !== null) {
					event.preventDefault();
					noteSaver.saveNow(next);
					return;
				}
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
		[
			applyInlineToggle,
			dateSettings,
			account,
			focusName,
			focusNextRowName,
			handleInput,
			handleSlashKey,
			handleTagAutocompleteKey,
			nodeId,
			noteSaver,
			saveNow,
		],
	);

	return (
		<div className={withClasses(isMain ? "notes notes--main" : "notes", extraClasses)}>
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- contentEditable makes this an implicit textbox, which the rule does not model */}
			<div
				className={isFocused ? `${CONTENT_CLASS} active` : CONTENT_CLASS}
				contentEditable
				dangerouslySetInnerHTML={{
					__html: focusedHtml ?? restingHtml,
				}}
				onBlur={handleBlur}
				onClick={handleClick}
				onFocus={handleFocus}
				onInput={handleInput}
				onKeyDown={handleKeyDown}
				onMouseDown={() => {
					// Before the browser places the caret, so the click lands in the plain DOM it will edit.
					clearSearchHighlights();
					detachTagAutocomplete();
				}}
				ref={contentRef}
				suppressContentEditableWarning
			/>
			{datePicker.popup}
			{pillPicker.popup}
			{tagAutocomplete.popup}
			{slashMenu.menu}
			{toolbarView && (
				<SelectionToolbar
					activeAttrs={toolbarView.activeAttrs}
					inNote
					layoutMode={null}
					onAction={handleToolbarAction}
					rect={toolbarView.rect}
				/>
			)}
		</div>
	);
}
