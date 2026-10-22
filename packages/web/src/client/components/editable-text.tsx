import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {useQueryClient} from "@tanstack/react-query";
import {
	activePaneView,
	isModalOpen,
	outlineActions,
	registerEditFlush,
	shouldCommitOnBlur,
	useOutlineStore,
} from "../stores/outline.js";
import {applySplitPlan, planBackspaceAtStart, planDeleteAtEnd, planOutdent, planSplit} from "../tree-ops.js";
import type {MergeRow} from "../tree-ops.js";
import {sortByPriority} from "../tree-position.js";
import type {NodeResponse} from "../../node-types.js";
import {
	adjacentVisibleNode,
	backspaceDeleteTarget,
	horizontalTarget,
	isCaretOnBoundaryLine,
	navigableIds,
	planNoteBoundary,
} from "../caret-navigation.js";
import type {HorizontalDirection, VerticalDirection} from "../caret-navigation.js";
import {
	caretTextOffset,
	placeCaretAtTextOffset,
	rowContent,
	placeSelectionAtTextOffsets,
	selectionTextOffsets,
	textUnitLength,
} from "../caret-dom.js";
import {classifyEditorKey, classifyFormatKey, isMacPlatform} from "../editable-text-keys.js";
import type {EditorKeyAction} from "../editable-text-keys.js";
import {nodeKeys, patchCachedNode, readChildren, readDetail, readNode} from "../node-cache.js";
import {collectVisibleNodeIds} from "../hooks/use-visible-nodes.js";
import {currentSelectionView, freshSelection, scrollRowIntoView} from "../hooks/use-selection-keymap.js";
import {editorSelectAllTakesOver, editorShiftArrowTakesOver} from "../item-selection.js";
import {useCreateNode, useDeleteNode, useMoveNode, useUpdateNode} from "../hooks/use-nodes.js";
import {captureOutlineView, runInUndoBatch} from "../undo-batch.js";
import {createEditDebouncer, TEXT_SAVE_DEBOUNCE_MS} from "../edit-debouncer.js";
import {useRemoveTagColor, useSetTagColor, useTagColors} from "../hooks/use-tag-colors.js";
import type {TagColors} from "../hooks/use-tag-colors.js";
import {closeOnEscape} from "../menu-escape.js";
import {TagColorPicker} from "./tag-color-picker.js";
import {FaIcon} from "./fa-icons.js";
import {
	deletePillAfterCaret,
	deletePillBeforeCaret,
	applyDatePhrase,
	planDateInsertion,
	planPillReplacement,
	replacePill,
} from "../date-pills.js";
import {isComposingInput, renderEditorHtml, retagEditor, serializeEditorHtml} from "../editor-html.js";
import {formatPillLabel} from "@workflowy/shared";
import type {TimeAttrs} from "@workflowy/shared";
import {useBangDatePicker} from "./bang-date-picker.js";
import {useDateAutocomplete} from "./date-autocomplete.js";
import {plainText, splitHtml} from "../rich-text.js";
import {useInlineFormat} from "../hooks/use-inline-format.js";
import {toolbarFormatAttr, toolbarLayoutCommand, useSelectionToolbar} from "../hooks/use-selection-toolbar.js";
import {planLayoutHotkey} from "../layout-hotkeys.js";
import type {LayoutHotkeyCommand} from "../layout-hotkeys.js";
import {SelectionToolbar} from "./selection-toolbar.js";
import type {SelectionToolbarAction} from "./selection-toolbar.js";
import {useCommitSearch} from "../hooks/use-commit-search.js";
import {usePaneSearchQuery} from "../hooks/use-tree-search.js";
import {useTagAutocomplete} from "../hooks/use-tag-autocomplete.js";
import type {TagAcceptHandler} from "../hooks/use-tag-autocomplete.js";
import {spliceAcceptedTag} from "../tag-autocomplete.js";
import {clickedPill, offsetAfterPill, usePillDatePicker} from "./pill-date-picker.js";
import {highlightSearchMatches} from "../highlight-html.js";
import {useDateSettings, useSlashDiscovered} from "../hooks/use-preferences.js";
import {
	isTagDeleteClick,
	removeTagFromHtml,
	renderedTagStarts,
	tagCaretUnits,
	teaserPosition,
	toggleTagInQuery,
} from "../tag-render.js";
import {renderLinks} from "../link-render.js";
import type {TagColorName} from "./tag-color-picker.js";
import {useSlashMenu} from "../hooks/use-slash-menu.js";
import {placeholderFor, stripSlashChip} from "../slash-trigger.js";

/**
 * The caret's client rect at the edge of the current selection that the arrow key
 * moves from, or null when it cannot be measured (e.g. a caret in an empty node).
 */
function caretRect(direction: VerticalDirection): DOMRect | null {
	const selection = globalThis.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return null;
	}
	const range = selection.getRangeAt(0).cloneRange();
	range.collapse(direction === "up");
	const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
	return rect.height > 0 ? rect : null;
}

/**
 * Where to place the caret when entering `targetId` from a vertical move: the
 * target's last line going up or first line going down, at the horizontal
 * position closest to `caretX`. Null when the target is not rendered or empty.
 */
function verticalEntryPoint(
	targetId: string,
	direction: VerticalDirection,
	caretX: number | null,
): {x: number; y: number} | null {
	const target = rowContent(targetId);
	const lines = target ? [...target.getClientRects()] : [];
	const line = direction === "up" ? lines.at(-1) : lines[0];
	if (!line || line.width === 0) {
		return null;
	}
	const x = Math.min(Math.max(caretX ?? line.left, line.left), line.right - 1);
	return {x, y: line.top + line.height / 2};
}

/** Stands in for a date pill, one caret unit, in the plain text the tag autocomplete reads. */
const PILL_UNIT = "\uFFFC";

interface EditableTextProps {
	nodeId: string;
	initialValue: string;
	parentId: string | null;
	priority: number;
	isEditing: boolean;
	clickPosition?: {x: number; y: number};
}

/** Caret actions named the way `planNoteBoundary` takes them. */
const CARET_ARROWS: Readonly<Partial<Record<EditorKeyAction, "Up" | "Down" | "Left" | "Right">>> = {
	CARET_UP: "Up",
	CARET_DOWN: "Down",
	CARET_LEFT: "Left",
	CARET_RIGHT: "Right",
};

/**
 * Inline editable text component using contenteditable.
 * - Supports HTML formatting (bold, italic preserved from node content)
 * - Saves after each 500ms pause in typing (one undo step per pause), and on blur
 * - Enter splits the row at the selection (or outdents an empty last row); see `planSplit`
 * - Shift+Enter commits the text and focuses the row's note (creating it) with the caret at its end
 * - Backspace in an empty, childless, note-less node deletes it and edits the previous node
 * - Backspace at the start merges the previous sibling's text in; Delete at the end
 *   merges this row's text into the next sibling (plain leaf siblings only)
 * - Down/Right leaving the end of the noted zoom title enter the root note at its start;
 *   Up/Left leaving the start of the first child's name enter it at its end
 * - Escape commits the text and opens search; dismissing search resumes editing here
 */

function teaserStyle(tag: {top: number; right: number; bottom: number}): React.CSSProperties {
	const {left, top} = teaserPosition({top: tag.top, right: tag.right, height: tag.bottom - tag.top});
	return {top: `${top}px`, left: `${left}px`};
}

/** Upstream marks a hovered tag `contentTagDeleteHover` while the delete modifier is held. */
function markTagDeleteHover(tagEl: Element, event: {metaKey: boolean; altKey: boolean}): void {
	tagEl.classList.toggle("contentTagDeleteHover", isTagDeleteClick(event, isMacPlatform()));
}

/** Pressing or releasing the modifier over a hovered tag updates its class. */
function onTagDeleteKey(event: KeyboardEvent): void {
	for (const tagEl of document.querySelectorAll(".contentTag:hover")) {
		markTagDeleteHover(tagEl, event);
	}
}

let tagDeleteKeysInstalled = false;

/** Installs the one document listener for `onTagDeleteKey` on the first tag hover. */
function installTagDeleteKeys(): void {
	if (tagDeleteKeysInstalled) {
		return;
	}
	tagDeleteKeysInstalled = true;
	document.addEventListener("keydown", onTagDeleteKey);
	document.addEventListener("keyup", onTagDeleteKey);
}

/** Upstream: mousedown on a tag never places a caret or moves focus. */
function preventTagMouseDown(event: React.MouseEvent<HTMLSpanElement>): void {
	if (event.target instanceof Element && event.target.closest(".explosive")) {
		event.preventDefault();
	}
}

function EditingText({nodeId, initialValue, parentId, priority, isEditing, clickPosition}: EditableTextProps) {
	const contentRef = useRef<HTMLSpanElement>(null);
	const queryClient = useQueryClient();
	const {
		stopEditing,
		startEditing,
		resumeEditing,
		focusNote,
		releaseEditing,
		setItemSelection,
		holdEditing,
		openSettings,
		openLinkInsert,
	} = outlineActions();
	const updateNodeMutation = useUpdateNode();
	const createNodeMutation = useCreateNode();
	const deleteNodeMutation = useDeleteNode();
	const moveNodeMutation = useMoveNode();
	const dateSettings = useDateSettings();

	// The HTML as of editing start, held while editing so saves and refetches never rewrite the DOM under the caret.
	const [editingHtml, setEditingHtml] = useState<string | null>(null);
	if (isEditing && editingHtml === null) {
		setEditingHtml(initialValue);
	} else if (!isEditing && editingHtml !== null) {
		setEditingHtml(null);
	}
	const storedEditorHtml = editingHtml ?? initialValue;
	// Pills are atomic in edit mode too; every save path serializes them back to stored `<time>` markup.
	const editorHtml = useMemo(
		() => renderEditorHtml(storedEditorHtml, dateSettings),
		[storedEditorHtml, dateSettings],
	);

	// Saves the name after each 500ms pause in typing (upstream `saveLater`): one undo step per pause.
	// One saver per node, so a pending save flushed after a node change still targets its own node.
	const {mutate: updateNode} = updateNodeMutation;
	const nameSaver = useMemo(
		() =>
			createEditDebouncer({
				delay: TEXT_SAVE_DEBOUNCE_MS,
				save: ({after}) => {
					updateNode({nodeId, name: after});
				},
			}),
		[nodeId, updateNode],
	);

	// Focus and position cursor when entering edit mode
	useEffect(() => {
		if (isEditing && contentRef.current) {
			contentRef.current.focus();
			nameSaver.reset(storedEditorHtml);

			const {editingId, editingCaretOffset} = useOutlineStore.getState();
			if (editingId === nodeId && editingCaretOffset !== null) {
				placeCaretAtTextOffset(contentRef.current, editingCaretOffset);
				return;
			}

			// If we have a click position, use caretPositionFromPoint to place the cursor there
			if (clickPosition && "caretPositionFromPoint" in document) {
				const position = document.caretPositionFromPoint(clickPosition.x, clickPosition.y);
				if (position && contentRef.current.contains(position.offsetNode)) {
					const range = document.createRange();
					range.setStart(position.offsetNode, position.offset);
					range.collapse(true);
					const selection = globalThis.getSelection();
					selection?.removeAllRanges();
					selection?.addRange(range);
					return;
				}
			}

			// Fallback: select all content (for keyboard navigation or when click position unavailable)
			const range = document.createRange();
			range.selectNodeContents(contentRef.current);
			const selection = globalThis.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
		}
	}, [isEditing, storedEditorHtml, clickPosition, nodeId, nameSaver]);

	/** Save the edited text if it changed, keeping the caret (⌘S); returns false with no editor. */
	const saveInPlace = useCallback((): boolean => {
		if (!contentRef.current) {
			return false;
		}

		nameSaver.saveNow(stripSlashChip(serializeEditorHtml(contentRef.current.innerHTML)));
		return true;
	}, [nameSaver]);

	useEffect(() => {
		const unregister = isEditing
			? registerEditFlush(() => {
					saveInPlace();
				})
			: undefined;
		return () => {
			unregister?.();
			// Leaving the row without a blur commit (a remount or a structural move) still saves the last pause.
			nameSaver.flush();
		};
	}, [isEditing, saveInPlace, nameSaver]);

	const insertDate = useCallback(
		(attrs: TimeAttrs, offset: number, replaceEnd?: number, addSpaceBefore?: boolean) => {
			const content = contentRef.current;
			if (content) {
				const html = serializeEditorHtml(content.innerHTML);
				const {before, after} =
					replaceEnd === undefined ? {before: html, after: ""} : splitHtml(html, offset, replaceEnd);
				const plan = planDateInsertion(before + after, offset, attrs, {addSpaceBefore});
				content.focus();
				content.innerHTML = renderEditorHtml(plan.html, dateSettings);
				placeCaretAtTextOffset(content, plan.caretOffset);
				nameSaver.saveNow(plan.html);
			}
			releaseEditing();
		},
		[dateSettings, nameSaver, releaseEditing],
	);

	const cancelDate = useCallback(
		(offset: number) => {
			const content = contentRef.current;
			if (content) {
				content.focus();
				placeCaretAtTextOffset(content, offset);
			}
			releaseEditing();
		},
		[releaseEditing],
	);

	// `!!` opens the date picker; holding editing keeps the input's focus from committing this edit.
	const datePicker = useBangDatePicker({
		editorRef: contentRef,
		dateSettings,
		onOpen: holdEditing,
		onInsert: insertDate,
		onCancel: cancelDate,
	});
	const {handleInput: handleDateTrigger, openForPhrase, openAtCaret, isOpen: isDatePickerOpen} = datePicker;

	// "Add date" from the item menu focuses this name at its end, then opens the picker there.
	const datePickerRequestId = useOutlineStore((state) => state.datePickerRequestId);
	useEffect(() => {
		if (
			isEditing &&
			datePickerRequestId === nodeId &&
			document.activeElement === contentRef.current &&
			useOutlineStore.getState().takeDatePickerRequest(nodeId)
		) {
			openAtCaret();
		}
	}, [isEditing, datePickerRequestId, nodeId, openAtCaret]);

	// Typing a natural-language date ("tomorrow") offers a flyout; Tab or a click converts it to a pill.
	const dateAutocomplete = useDateAutocomplete({
		editorRef: contentRef,
		dateSettings,
		isBlocked: isDatePickerOpen,
		onApply: (phrase) => {
			const content = contentRef.current;
			if (content) {
				const plan = applyDatePhrase(serializeEditorHtml(content.innerHTML), phrase);
				content.innerHTML = renderEditorHtml(plan.html, dateSettings);
				placeCaretAtTextOffset(content, plan.caretOffset);
				nameSaver.saveNow(plan.html);
			}
		},
		onOpenPicker: (phrase, position) => {
			openForPhrase({
				offset: phrase.start,
				replaceEnd: phrase.end,
				position,
				term: formatPillLabel(phrase.attrs, {dateFormat: dateSettings.dateFormat}),
				isRange: phrase.attrs.endYear !== undefined,
			});
		},
		onOpenSettings: () => {
			openSettings("Dates");
		},
	});
	const {handleInput: handleDateAutocomplete, hide: hideDateAutocomplete} = dateAutocomplete;

	// A plain click on a pill edits or removes just that pill. At rest it saves the stored name; while editing,
	// holding editing keeps the picker's focus from committing, and the change lands in the live editor.
	const pillCaret = useRef(0);
	const pillPicker = usePillDatePicker({
		dateSettings,
		onChange: (pillIndex, attrs) => {
			const content = contentRef.current;
			if (content === null) {
				updateNode({nodeId, name: replacePill(initialValue, pillIndex, attrs)});
				return;
			}
			const plan = planPillReplacement(serializeEditorHtml(content.innerHTML), pillIndex, attrs);
			content.focus();
			content.innerHTML = renderEditorHtml(plan.html, dateSettings);
			placeCaretAtTextOffset(content, plan.caretOffset);
			nameSaver.saveNow(plan.html);
			releaseEditing();
		},
		onDismiss: () => {
			const content = contentRef.current;
			if (content !== null) {
				content.focus();
				placeCaretAtTextOffset(content, pillCaret.current);
				releaseEditing();
			}
		},
	});
	const {open: openPillPicker} = pillPicker;
	const handleEditingClick = useCallback(
		(event: React.MouseEvent<HTMLSpanElement>) => {
			const clicked = clickedPill(event, event.currentTarget);
			if (clicked === null) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			pillCaret.current = offsetAfterPill(event.currentTarget, clicked.pill);
			holdEditing(pillCaret.current);
			openPillPicker(clicked.pill, clicked.index);
		},
		[holdEditing, openPillPicker],
	);

	// Typing a #tag or @mention offers the zoom subtree's matching tags; Tab, Enter or a click accepts one.
	const readNamePlain = useCallback(
		() => (contentRef.current ? plainText(serializeEditorHtml(contentRef.current.innerHTML), PILL_UNIT) : ""),
		[],
	);
	const acceptTag = useCallback<TagAcceptHandler>(
		(edit) => {
			const content = contentRef.current;
			if (content) {
				const html = spliceAcceptedTag(serializeEditorHtml(content.innerHTML), edit);
				content.innerHTML = renderEditorHtml(html, dateSettings);
				placeCaretAtTextOffset(content, edit.caret);
				nameSaver.saveNow(html);
			}
		},
		[dateSettings, nameSaver],
	);
	const tagAutocomplete = useTagAutocomplete({
		editorRef: contentRef,
		nodeId,
		field: "name",
		readPlain: readNamePlain,
		onAccept: acceptTag,
	});
	const {
		handleInput: handleTagAutocomplete,
		handleKeyDown: handleTagAutocompleteKey,
		detach: detachTagAutocomplete,
	} = tagAutocomplete;

	// ⌘B/⌘I/⌘U/⇧⌘X/⇧⌘C toggle the selection's format, or make it pending for the next typed character.
	const readNameHtml = useCallback(() => serializeEditorHtml(contentRef.current?.innerHTML ?? ""), []);
	const {applyInlineToggle} = useInlineFormat({
		editorRef: contentRef,
		active: isEditing,
		read: readNameHtml,
		render: (html) => renderEditorHtml(html, dateSettings),
		onChange: (html) => {
			nameSaver.change(html);
		},
	});

	// Upstream's floating format toolbar over a stretched selection in the edited name.
	const {view: toolbarView, refresh: refreshToolbar} = useSelectionToolbar({
		editorRef: contentRef,
		active: isEditing,
		read: readNameHtml,
		modalOpen: isModalOpen,
	});

	/** A toolbar type button: commit the text, then toggle this row's layout in one undo step, keeping the selection. */
	const toggleLayoutFromToolbar = useCallback(
		(command: LayoutHotkeyCommand) => {
			const content = contentRef.current;
			const node = readNode(queryClient, nodeId);
			if (!content || node === undefined) {
				return;
			}
			const name = serializeEditorHtml(content.innerHTML);
			const sel = selectionTextOffsets(content);
			nameSaver.saveNow(name);
			const plan = planLayoutHotkey(command, [node], {nodeId, name});
			const renamed = plan.updates.find((update) => update.nodeId === nodeId)?.name;
			if (renamed !== undefined && renamed !== name) {
				nameSaver.reset(renamed);
				content.innerHTML = renderEditorHtml(renamed, dateSettings);
				const length = textUnitLength(content);
				placeSelectionAtTextOffsets(content, Math.min(sel.start, length), Math.min(sel.end, length));
			}
			void runInUndoBatch(captureOutlineView, () => {
				for (const update of plan.updates) {
					updateNodeMutation.mutate(update);
				}
				for (const deleteId of plan.deletes) {
					deleteNodeMutation.mutate(deleteId);
				}
			});
			refreshToolbar();
		},
		[dateSettings, deleteNodeMutation, nameSaver, nodeId, queryClient, refreshToolbar, updateNodeMutation],
	);

	const handleToolbarAction = useCallback(
		(action: SelectionToolbarAction) => {
			const attr = toolbarFormatAttr(action);
			const layout = toolbarLayoutCommand(action);
			const selection = globalThis.getSelection();
			if (attr !== null) {
				applyInlineToggle(attr);
			} else if (layout !== null) {
				toggleLayoutFromToolbar(layout);
			} else if (action === "link" && selection !== null && selection.rangeCount > 0) {
				openLinkInsert({
					selectedText: selection.toString().trim(),
					nodeId,
					range: selection.getRangeAt(0).cloneRange(),
				});
			}
		},
		[applyInlineToggle, nodeId, openLinkInsert, toggleLayoutFromToolbar],
	);

	// Typing a first or standalone "/" opens the slash command menu under a chip; it never schedules a save while open.
	const changeName = useCallback(() => {
		if (contentRef.current) {
			nameSaver.change(stripSlashChip(serializeEditorHtml(contentRef.current.innerHTML)));
		}
	}, [nameSaver]);
	const saveName = useCallback(() => {
		saveInPlace();
	}, [saveInPlace]);
	const slashMenu = useSlashMenu({editorRef: contentRef, nodeId, onChange: changeName, onSave: saveName});
	const slashDiscovered = useSlashDiscovered();
	const {
		handleInput: handleSlashInput,
		handleKeyDown: handleSlashKey,
		isOpen: isSlashOpen,
		detach: detachSlashMenu,
	} = slashMenu;

	const handleInput = useCallback(
		(event: React.SyntheticEvent<HTMLSpanElement>) => {
			const content = contentRef.current;
			if (content !== null && !isComposingInput(event.nativeEvent)) {
				retagEditor(content, renderEditorHtml(serializeEditorHtml(content.innerHTML), dateSettings));
			}
			handleSlashInput(event.nativeEvent);
			handleDateTrigger(event.nativeEvent);
			handleDateAutocomplete();
			handleTagAutocomplete();
			if (!isSlashOpen()) {
				changeName();
			}
		},
		[
			changeName,
			dateSettings,
			handleSlashInput,
			isSlashOpen,
			handleDateTrigger,
			handleDateAutocomplete,
			handleTagAutocomplete,
		],
	);

	const saveChanges = useCallback(() => {
		if (!saveInPlace()) {
			return;
		}

		// A vertical move may already have handed editing to another node.
		if (useOutlineStore.getState().editingId === nodeId) {
			stopEditing();
		}
	}, [nodeId, saveInPlace, stopEditing]);

	/**
	 * Up on the first line / Down on the last line: commit this edit and start
	 * editing the neighboring visible node, keeping the caret's horizontal position.
	 * Returns false when the caret should move within this node's text instead.
	 */
	const moveToAdjacentNode = useCallback(
		(direction: VerticalDirection): boolean => {
			const content = contentRef.current;
			if (!content) {
				return false;
			}
			const caret = caretRect(direction);
			if (!isCaretOnBoundaryLine(direction, caret, content.getBoundingClientRect())) {
				return false;
			}
			const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = activePaneView();
			const visibleIds = navigableIds(
				zoomedNodeId,
				collectVisibleNodeIds(queryClient, zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds),
			);
			const targetId = adjacentVisibleNode(visibleIds, nodeId, direction);
			if (targetId === null) {
				return true;
			}
			const entryPoint = verticalEntryPoint(targetId, direction, caret?.left ?? null);
			saveChanges();
			startEditing(targetId, entryPoint ?? undefined);
			return true;
		},
		[nodeId, queryClient, saveChanges, startEditing],
	);

	/**
	 * Left at the text start / Right at the text end of a collapsed caret: commit this
	 * edit and continue at the end of the previous / start of the next visible node.
	 * Returns false when the caret should move natively (mid-text, a selection, or no
	 * neighbor in that direction).
	 */
	const crossRowHorizontally = useCallback(
		(direction: HorizontalDirection): boolean => {
			const content = contentRef.current;
			if (!content || globalThis.getSelection()?.isCollapsed !== true) {
				return false;
			}
			const edgeOffset = direction === "left" ? 0 : textUnitLength(content);
			if (caretTextOffset(content) !== edgeOffset) {
				return false;
			}
			const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = activePaneView();
			const visibleIds = navigableIds(
				zoomedNodeId,
				collectVisibleNodeIds(queryClient, zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds),
			);
			const target = horizontalTarget(visibleIds, nodeId, direction);
			if (target === null) {
				return false;
			}
			saveChanges();
			resumeEditing(target.nodeId, target.caretOffset);
			return true;
		},
		[nodeId, queryClient, resumeEditing, saveChanges],
	);

	/**
	 * Arrow keys between the zoom title or first child's name and the zoom root's note.
	 * The leading edge is the first/last line for Up/Down and the text start/end for
	 * Left/Right. Returns false when the key should move the caret elsewhere.
	 */
	const enterRootNote = useCallback(
		(key: "Up" | "Down" | "Left" | "Right"): boolean => {
			const content = contentRef.current;
			const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = activePaneView();
			if (!content || zoomedNodeId === null || globalThis.getSelection()?.isCollapsed !== true) {
				return false;
			}
			const rootNoted = Boolean(readDetail(queryClient, zoomedNodeId)?.note);
			const forward = key === "Down" || key === "Right";
			const vertical = key === "Up" || key === "Down";
			const direction: VerticalDirection = forward ? "down" : "up";
			const offset = caretTextOffset(content);
			const atEdge = vertical
				? isCaretOnBoundaryLine(direction, caretRect(direction), content.getBoundingClientRect())
				: offset === (forward ? textUnitLength(content) : 0);
			let plan: ReturnType<typeof planNoteBoundary> = null;
			if (nodeId === zoomedNodeId) {
				plan = atEdge ? planNoteBoundary({from: "rootTitleEnd", key, rootNoted}) : null;
			} else {
				const [firstChild] = collectVisibleNodeIds(
					queryClient,
					zoomedNodeId,
					expandedIds,
					showCompleted,
					animatingCompletionIds,
				);
				if (firstChild === nodeId) {
					plan = planNoteBoundary({from: "firstChildName", key, caret: atEdge ? 0 : offset || 1, rootNoted});
				}
			}
			if (plan === null) {
				return false;
			}
			saveChanges();
			focusNote(zoomedNodeId, plan.caret);
			return true;
		},
		[focusNote, nodeId, queryClient, saveChanges],
	);

	/**
	 * Enter (upstream `hK`): outdent an empty last row, else split the text around the
	 * selection into a new row created at its exact slot (one create per Enter), rename
	 * the current row when its text changed, and edit the focused row at its start.
	 */
	const splitAtSelection = useCallback(() => {
		const content = contentRef.current;
		if (!content) {
			return;
		}
		const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = activePaneView();
		const visible = new Set(
			collectVisibleNodeIds(queryClient, zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds),
		);
		const allSiblings = sortByPriority(readChildren(queryClient, parentId) ?? []);
		const listed = allSiblings.find((sibling) => sibling.id === nodeId);
		const visibleSiblings = allSiblings.filter((sibling) => sibling.id === nodeId || visible.has(sibling.id));
		// Unknown children count as children: never treat an unloaded subtree as empty.
		const children = readChildren(queryClient, nodeId);
		const hasChildren = children ? children.length > 0 : listed?.hasChildren !== false;
		const note = readDetail(queryClient, nodeId)?.note ?? listed?.note ?? "";
		const html = serializeEditorHtml(content.innerHTML);
		const outdent = planOutdent(queryClient, {id: nodeId, parent_id: parentId, priority}, zoomedNodeId);
		const plan = planSplit({
			node: {
				id: nodeId,
				parent_id: parentId,
				index: Math.max(
					allSiblings.findIndex((sibling) => sibling.id === nodeId),
					0,
				),
				layoutMode: listed?.data.layoutMode,
				hasVisibleChildren: (children ?? []).some((child) => visible.has(child.id)),
				isExpanded: expandedIds.has(nodeId),
				isZoomRoot: nodeId === zoomedNodeId,
				isEmpty: content.textContent === "" && !note && !hasChildren,
				hasNextSibling: visibleSiblings.at(-1)?.id !== nodeId,
				canOutdent: outdent !== null,
			},
			html,
			selection: selectionTextOffsets(content),
		});

		if (plan.kind === "outdent") {
			if (outdent !== null) {
				holdEditing(0);
				moveNodeMutation.mutate(outdent, {onSettled: releaseEditing});
			}
			return;
		}

		// Show the kept text now, so the blur commit and the re-render agree with the plan.
		if (html !== plan.currentName) {
			content.innerHTML = renderEditorHtml(plan.currentName, dateSettings);
		}
		// The new row carries a client-generated id, so the caret moves into it now,
		// before the create round-trip; writes to it wait for the create (pendingCreates).
		const newId = crypto.randomUUID();
		// The rename and the create are one user command: one undo step.
		void runInUndoBatch(captureOutlineView, () => {
			for (const step of applySplitPlan(plan, nodeId, nameSaver.saved)) {
				if (step.type === "update") {
					nameSaver.reset(step.name);
					updateNodeMutation.mutate({nodeId: step.nodeId, name: step.name});
				} else if (step.type === "create") {
					createNodeMutation.mutate({
						id: newId,
						parent_id: step.parent_id ?? undefined,
						index: step.index,
						name: step.name,
						...(step.layoutMode === null ? {} : {layoutMode: step.layoutMode}),
					});
				} else if (step.target === "current") {
					placeCaretAtTextOffset(content, step.caret);
					resumeEditing(nodeId, step.caret);
				} else {
					resumeEditing(newId, step.caret);
				}
			}
		});
	}, [
		nodeId,
		parentId,
		priority,
		queryClient,
		updateNodeMutation,
		createNodeMutation,
		moveNodeMutation,
		holdEditing,
		releaseEditing,
		resumeEditing,
		nameSaver,
		dateSettings,
	]);

	/**
	 * Backspace in an empty, childless node deletes it and continues editing at the
	 * end of the previous visible node. Returns false when Backspace should edit text.
	 */
	const deleteIfEmpty = useCallback((): boolean => {
		const content = contentRef.current;
		if (!content) {
			return false;
		}
		// Unknown children count as children: never delete a subtree that has not loaded.
		const children = readChildren(queryClient, nodeId);
		const listed = readChildren(queryClient, parentId)?.find((sibling) => sibling.id === nodeId);
		const hasChildren = children ? children.length > 0 : listed?.hasChildren !== false;
		const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = activePaneView();
		const visibleIds = navigableIds(
			zoomedNodeId,
			collectVisibleNodeIds(queryClient, zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds),
		);
		const note = readDetail(queryClient, nodeId)?.note ?? listed?.note ?? "";
		const targetId = backspaceDeleteTarget(visibleIds, nodeId, {text: content.textContent, note, hasChildren});
		if (targetId === null) {
			return false;
		}
		// The row is going away: never save its pending text.
		nameSaver.reset(serializeEditorHtml(content.innerHTML));
		resumeEditing(targetId, Number.MAX_SAFE_INTEGER);
		deleteNodeMutation.mutate(nodeId);
		return true;
	}, [nodeId, parentId, queryClient, resumeEditing, deleteNodeMutation, nameSaver]);

	/**
	 * Backspace at offset 0 / Delete at the text end with a collapsed caret: merge this
	 * row with its previous / next visible sibling (upstream). The kept row keeps its id,
	 * children, and note; the other is deleted. Returns false when the merge is refused.
	 */
	const mergeWithSibling = useCallback(
		(direction: "backward" | "forward"): boolean => {
			const content = contentRef.current;
			const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = activePaneView();
			if (!content || nodeId === zoomedNodeId || globalThis.getSelection()?.isCollapsed !== true) {
				return false;
			}
			const offset = caretTextOffset(content);
			if (offset !== (direction === "backward" ? 0 : textUnitLength(content))) {
				return false;
			}
			const visible = new Set(
				collectVisibleNodeIds(queryClient, zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds),
			);
			const siblings = sortByPriority(readChildren(queryClient, parentId) ?? []).filter(
				(sibling) => sibling.id === nodeId || visible.has(sibling.id),
			);
			const index = siblings.findIndex((sibling) => sibling.id === nodeId);
			const current = siblings[index];
			if (current === undefined) {
				return false;
			}
			const toRow = (node: NodeResponse, html: string): MergeRow => {
				// Unknown children count as children: never delete a subtree that has not loaded.
				const children = readChildren(queryClient, node.id);
				return {
					id: node.id,
					html,
					hasChildren: children ? children.length > 0 : node.hasChildren !== false,
					hasNote: Boolean(readDetail(queryClient, node.id)?.note ?? node.note),
					completed: node.completedAt !== null,
					isMirror: node.isMirror === true,
					layoutMode: node.data.layoutMode,
				};
			};
			const currentRow = toRow(current, serializeEditorHtml(content.innerHTML));
			const neighbor = siblings[direction === "backward" ? index - 1 : index + 1];
			const neighborRow = neighbor === undefined ? null : toRow(neighbor, neighbor.name ?? "");
			const plan =
				direction === "backward"
					? planBackspaceAtStart({current: currentRow, previousSibling: neighborRow})
					: planDeleteAtEnd({current: currentRow, nextSibling: neighborRow});
			if (plan.kind === "none") {
				return false;
			}
			// The rename and the delete are one undo step; both read their before-values
			// from the cache, so they are issued before the optimistic merge below.
			void runInUndoBatch(captureOutlineView, () => {
				resumeEditing(plan.keepId, plan.caret);
				nameSaver.reset(plan.name);
				updateNodeMutation.mutate({nodeId: plan.keepId, name: plan.name});
				// The held editor never re-renders its text: show the merged row and its caret here.
				if (plan.keepId === nodeId) {
					content.innerHTML = renderEditorHtml(plan.name, dateSettings);
					placeCaretAtTextOffset(content, plan.caret);
				}
				deleteNodeMutation.mutate(plan.deleteId);
				// Show the merged row at once; the mutations' refetch confirms it.
				queryClient.setQueryData<NodeResponse[]>(nodeKeys.children(parentId), (old) =>
					old
						?.filter((sibling) => sibling.id !== plan.deleteId)
						.map((sibling) => (sibling.id === plan.keepId ? {...sibling, name: plan.name} : sibling)),
				);
			});
			return true;
		},
		[nodeId, parentId, queryClient, resumeEditing, updateNodeMutation, deleteNodeMutation, nameSaver, dateSettings],
	);

	/**
	 * Backspace right after / Delete right before a date pill with a collapsed caret
	 * removes the whole pill (upstream monolith). Returns false when no pill is adjacent.
	 */
	const deleteAdjacentPill = useCallback(
		(direction: "backward" | "forward"): boolean => {
			const content = contentRef.current;
			if (!content || globalThis.getSelection()?.isCollapsed !== true) {
				return false;
			}
			const offset = caretTextOffset(content);
			const html = serializeEditorHtml(content.innerHTML);
			const next =
				direction === "backward" ? deletePillBeforeCaret(html, offset) : deletePillAfterCaret(html, offset);
			if (next === null) {
				return false;
			}
			content.innerHTML = renderEditorHtml(next, dateSettings);
			placeCaretAtTextOffset(content, direction === "backward" ? offset - 1 : offset);
			nameSaver.change(next);
			return true;
		},
		[dateSettings, nameSaver],
	);

	/**
	 * A structural shortcut (indent, outdent, move) holds editing while it re-renders
	 * the edited row. If React moved the row and focus fell to the page, take it back
	 * at the caret captured before the move, keeping the unsaved text in the DOM.
	 */
	useLayoutEffect(() => {
		const content = contentRef.current;
		if (!isEditing || !content || document.activeElement === content) {
			return;
		}
		const {editingHeld, editingCaretOffset} = useOutlineStore.getState();
		const focusIsLost = document.activeElement === null || document.activeElement === document.body;
		if (!editingHeld || !focusIsLost) {
			return;
		}
		content.focus();
		placeCaretAtTextOffset(content, editingCaretOffset ?? Number.MAX_SAFE_INTEGER);
		releaseEditing();
	});

	const handleBlur = useCallback(() => {
		detachSlashMenu();
		hideDateAutocomplete();
		detachTagAutocomplete();
		if (shouldCommitOnBlur(useOutlineStore.getState(), nodeId)) {
			saveChanges();
		}
	}, [nodeId, saveChanges, detachSlashMenu, hideDateAutocomplete, detachTagAutocomplete]);

	/**
	 * ⇧↑ at the text start, ⇧↓ at its end, or ⌘A over the already fully selected text: commit the text, stop editing
	 * and select items instead (this row, or the zoom root / Home's top-level rows for ⌘A). Returns false when the key
	 * stays native.
	 */
	const selectItemsFromEditor = useCallback(
		(action: "SELECT_UP" | "SELECT_DOWN" | "SELECT_ALL"): boolean => {
			const content = contentRef.current;
			if (!content) {
				return false;
			}
			const {start, end} = selectionTextOffsets(content);
			const length = textUnitLength(content);
			const takesOver =
				action === "SELECT_ALL"
					? editorSelectAllTakesOver({start, end, length})
					: editorShiftArrowTakesOver({
							dir: action === "SELECT_UP" ? "up" : "down",
							start,
							end,
							length,
							inNote: false,
						});
			if (!takesOver) {
				return false;
			}
			const view = currentSelectionView(queryClient);
			saveChanges();
			stopEditing();
			globalThis.getSelection()?.removeAllRanges();
			content.blur();
			setItemSelection(freshSelection(view, action === "SELECT_ALL" ? view.allIds : [nodeId]));
			if (action !== "SELECT_ALL") {
				scrollRowIntoView(nodeId);
			}
			return true;
		},
		[nodeId, queryClient, saveChanges, setItemSelection, stopEditing],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLSpanElement>) => {
			if (handleSlashKey(event)) {
				return;
			}
			if (handleTagAutocompleteKey(event)) {
				return;
			}
			const action = classifyEditorKey(event, isMacPlatform());
			const composing = event.nativeEvent.isComposing;
			const formatAttr = classifyFormatKey(event, isMacPlatform());
			const arrow = action === null ? undefined : CARET_ARROWS[action];
			if (
				(action === "SELECT_UP" || action === "SELECT_DOWN" || action === "SELECT_ALL") &&
				!composing &&
				selectItemsFromEditor(action)
			) {
				event.preventDefault();
			} else if (arrow !== undefined && !composing && enterRootNote(arrow)) {
				event.preventDefault();
			} else if ((action === "CARET_UP" || action === "CARET_DOWN") && !composing) {
				if (moveToAdjacentNode(action === "CARET_UP" ? "up" : "down")) {
					event.preventDefault();
				}
			} else if ((action === "CARET_LEFT" || action === "CARET_RIGHT") && !composing) {
				if (crossRowHorizontally(action === "CARET_LEFT" ? "left" : "right")) {
					event.preventDefault();
				}
			} else if (action === "CARRIAGE_RETURN") {
				event.preventDefault();
			} else if (action === "RETURN") {
				event.preventDefault();
				splitAtSelection();
			} else if (action === "SHIFT_RETURN") {
				event.preventDefault();
				saveChanges();
				focusNote(nodeId);
			} else if (action === "DELETE_BACKWARD") {
				if (deleteAdjacentPill("backward") || deleteIfEmpty() || mergeWithSibling("backward")) {
					event.preventDefault();
				}
			} else if (action === "DELETE_FORWARD") {
				if (deleteAdjacentPill("forward") || mergeWithSibling("forward")) {
					event.preventDefault();
				}
			} else if (formatAttr !== null && !composing) {
				event.preventDefault();
				applyInlineToggle(formatAttr);
			}
		},
		[
			deleteAdjacentPill,
			deleteIfEmpty,
			enterRootNote,
			focusNote,
			handleSlashKey,
			handleTagAutocompleteKey,
			mergeWithSibling,
			moveToAdjacentNode,
			crossRowHorizontally,
			nodeId,
			saveChanges,
			selectItemsFromEditor,
			splitAtSelection,
			applyInlineToggle,
		],
	);

	return (
		<>
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- contentEditable makes this an implicit textbox, which the rule does not model */}
			<span
				className="innerContentContainer editing"
				data-node-id={nodeId}
				// The CSS `:empty` rule shows it only while the editor is empty.
				data-placeholder={placeholderFor({
					focused: true,
					empty: true,
					layoutMode: readNode(queryClient, nodeId)?.data.layoutMode,
					slashDiscovered,
				})}
				contentEditable
				dangerouslySetInnerHTML={{__html: editorHtml}}
				onBlur={handleBlur}
				onClick={handleEditingClick}
				onInput={handleInput}
				onKeyDown={handleKeyDown}
				onMouseDown={detachTagAutocomplete}
				ref={contentRef}
				suppressContentEditableWarning
			/>
			{datePicker.popup}
			{pillPicker.popup}
			{dateAutocomplete.flyout}
			{tagAutocomplete.popup}
			{slashMenu.menu}
			{toolbarView && (
				<SelectionToolbar
					activeAttrs={toolbarView.activeAttrs}
					inNote={false}
					layoutMode={readNode(queryClient, nodeId)?.data.layoutMode}
					onAction={handleToolbarAction}
					rect={toolbarView.rect}
				/>
			)}
		</>
	);
}

interface RestingTagColorPickerProps {
	tag: string;
	top: number;
	left: number;
	onClose: () => void;
}

/** The tag color picker with its color mutations, mounted only while open so a resting row holds none of them. */
function RestingTagColorPicker({tag, top, left, onClose}: RestingTagColorPickerProps) {
	const tagColors = useTagColors();
	const setTagColorMutation = useSetTagColor();
	const removeTagColorMutation = useRemoveTagColor();
	return (
		<TagColorPicker
			currentColor={tagColors[tag.toLowerCase()]}
			left={left}
			onClose={onClose}
			onRemove={() => {
				removeTagColorMutation.mutate(tag);
				onClose();
			}}
			onSelect={(color: TagColorName) => {
				setTagColorMutation.mutate({name: tag, color});
				onClose();
			}}
			top={top}
		/>
	);
}

/**
 * A row's name while it is not being edited: its rendered HTML, a click that starts editing where it lands, tag
 * clicks and hovers, and date pill clicks. It holds none of the editor's hooks, effects or store subscriptions, so
 * swapping in a view's rows stays cheap; the row becomes an `EditingText` when editing starts.
 */
function RestingText({nodeId, initialValue}: Pick<EditableTextProps, "nodeId" | "initialValue">) {
	const queryClient = useQueryClient();
	const {startEditing, resumeEditing} = outlineActions();
	const commitSearch = useCommitSearch();
	const searchQuery = usePaneSearchQuery();
	const updateNodeMutation = useUpdateNode();
	const dateSettings = useDateSettings();
	// Tag color affordances: a caret appears on tag hover; clicking it opens the picker.
	const [tagHover, setTagHover] = useState<{
		tag: string;
		top: number;
		right: number;
		bottom: number;
		left: number;
	} | null>(null);
	const [colorPicker, setColorPicker] = useState<{tag: string; top: number; left: number} | null>(null);
	const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// A plain click on a pill edits or removes just that pill, saving the stored name.
	const pillPicker = usePillDatePicker({
		dateSettings,
		onChange: (pillIndex, attrs) => {
			updateNodeMutation.mutate({nodeId, name: replacePill(initialValue, pillIndex, attrs)});
		},
		onDismiss: () => {},
	});
	const {open: openPillPicker} = pillPicker;

	/**
	 * Upstream tag explode: drop the clicked tag and its following spaces from the stored
	 * name in one undo step, then edit this node with the caret at the tag's start.
	 */
	const explodeTag = useCallback(
		(container: HTMLElement, tagEl: Element) => {
			const ordinal = [...container.querySelectorAll(".contentTag")].indexOf(tagEl);
			const start = renderedTagStarts(renderLinks(initialValue))[ordinal];
			if (start === undefined) {
				return;
			}
			const name = removeTagFromHtml(initialValue, start, tagEl.textContent);
			if (name === initialValue) {
				return;
			}
			void runInUndoBatch(captureOutlineView, () => {
				updateNodeMutation.mutate({nodeId, name});
				// The editor captures its HTML when editing starts: show the new name before that.
				patchCachedNode(queryClient, nodeId, (node) => ({...node, name}));
				resumeEditing(nodeId, tagCaretUnits(name, start));
			});
		},
		[initialValue, nodeId, queryClient, resumeEditing, updateNodeMutation],
	);

	/**
	 * Handle text clicks:
	 * - Meta-click (mac) or Meta/Alt-click on a .contentTag span: explodes the tag, removing it
	 *   and its following spaces in one undo step, then edits with the caret where it was
	 * - Plain click on a .contentTag span: blurs the editor, marks the tag tapped, and toggles
	 *   the tag in the search query (appends it, or removes it when already there)
	 * - Otherwise: start editing at click position
	 */
	const handleTextClick = useCallback(
		(event: React.MouseEvent<HTMLSpanElement>) => {
			const target = event.target;

			// Plain click on a .contentTag span (or its inner text) toggles it in the search query
			const tagEl = target instanceof Element ? target.closest(".contentTag") : null;
			if (tagEl && isTagDeleteClick(event, isMacPlatform())) {
				event.preventDefault();
				event.stopPropagation();
				explodeTag(event.currentTarget, tagEl);
				return;
			}
			if (tagEl) {
				const tagText = tagEl.textContent;
				if (tagText) {
					event.preventDefault();
					event.stopPropagation();
					if (document.activeElement instanceof HTMLElement) {
						document.activeElement.blur();
					}
					tagEl.classList.add("tapped");
					commitSearch(toggleTagInQuery(useOutlineStore.getState().searchQuery, tagText));
				}
				return;
			}

			// Plain click on a date pill opens the picker on it; ⌥click is reserved for date search.
			const clicked = clickedPill(event, event.currentTarget);
			if (clicked !== null) {
				event.preventDefault();
				event.stopPropagation();
				openPillPicker(clicked.pill, clicked.index);
				return;
			}

			// Regular click: start editing at click position
			event.stopPropagation();
			startEditing(nodeId, {x: event.clientX, y: event.clientY});
		},
		[nodeId, startEditing, commitSearch, openPillPicker, explodeTag],
	);

	// Show the color teaser when hovering a tag; upstream's 150ms hide delay lets the
	// pointer travel from the tag to the teaser without it disappearing.
	const cancelHide = useCallback(() => {
		if (hideTimer.current !== null) {
			clearTimeout(hideTimer.current);
			hideTimer.current = null;
		}
	}, []);

	const scheduleHide = useCallback(() => {
		cancelHide();
		hideTimer.current = globalThis.setTimeout(() => {
			setTagHover(null);
		}, 150);
	}, [cancelHide]);

	const handleTagHover = useCallback(
		(event: React.MouseEvent<HTMLSpanElement>) => {
			if (colorPicker) {
				return;
			}
			const tagEl = event.target instanceof Element ? event.target.closest(".contentTag") : null;
			if (!tagEl) {
				return;
			}
			cancelHide();
			installTagDeleteKeys();
			markTagDeleteHover(tagEl, event);
			const rect = tagEl.getBoundingClientRect();
			setTagHover({
				tag: tagEl.textContent,
				top: rect.top,
				right: rect.right,
				bottom: rect.bottom,
				left: rect.left,
			});
		},
		[colorPicker, cancelHide],
	);

	const openPicker = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			// Upstream opens on mousedown; preventDefault keeps focus where it was.
			event.preventDefault();
			if (!tagHover) {
				return;
			}
			cancelHide();
			setColorPicker({tag: tagHover.tag, top: tagHover.bottom, left: tagHover.left});
			setTagHover(null);
		},
		[tagHover, cancelHide],
	);

	const closeColorPicker = useCallback(() => {
		setColorPicker(null);
	}, []);

	// Close the open picker on a click/escape outside of it.
	useEffect(() => {
		if (!colorPicker) {
			// oxlint-disable-next-line unicorn/no-useless-undefined -- consistent-return needs a value beside the cleanup return
			return undefined;
		}
		const onPointerDown = (event: PointerEvent) => {
			if (!(event.target instanceof Element && event.target.closest(".tag-color-picker"))) {
				setColorPicker(null);
			}
		};
		const onKey = closeOnEscape(() => {
			setColorPicker(null);
		});
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [colorPicker]);

	return (
		<>
			{/* Pointer entry point: a click places the caret for editing, and clicks on rendered .contentTag spans are delegated here. */}
			<span
				className="innerContentContainer"
				data-node-id={nodeId}
				dangerouslySetInnerHTML={{
					__html: highlightSearchMatches(
						renderEditorHtml(renderLinks(initialValue), dateSettings),
						searchQuery,
					),
				}}
				onClick={handleTextClick}
				onMouseDown={preventTagMouseDown}
				onMouseLeave={scheduleHide}
				// oxlint-disable-next-line jsx-a11y/mouse-events-have-key-events -- the tag-color trigger is a pointer-only affordance; the span is not focusable
				onMouseOver={handleTagHover}
				role="presentation"
			/>
			{tagHover &&
				!colorPicker &&
				createPortal(
					// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- upstream's teaser is a pointer-only div
					<div
						aria-label="Set tag color"
						className="tag-color-teaser"
						onMouseDown={openPicker}
						onMouseEnter={cancelHide}
						onMouseLeave={scheduleHide}
						style={teaserStyle(tagHover)}
					>
						<div className="tag-color-teaser-glyph">
							<FaIcon icon="fal:chevron-down" />
						</div>
					</div>,
					document.body,
				)}
			{colorPicker && (
				<RestingTagColorPicker
					left={colorPicker.left}
					onClose={closeColorPicker}
					tag={colorPicker.tag}
					top={colorPicker.top}
				/>
			)}
			{pillPicker.popup}
		</>
	);
}

/** A row's name: the full contenteditable `EditingText` while editing, else the light `RestingText`. */
export function EditableText(props: EditableTextProps) {
	return props.isEditing ? (
		<EditingText {...props} />
	) : (
		<RestingText initialValue={props.initialValue} nodeId={props.nodeId} />
	);
}
