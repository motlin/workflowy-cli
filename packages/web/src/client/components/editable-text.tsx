import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {useQueryClient} from "@tanstack/react-query";
import {registerEditFlush, shouldCommitOnBlur, useOutlineStore} from "../stores/outline.js";
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
import {caretTextOffset, placeCaretAtTextOffset, selectionTextOffsets, textUnitLength} from "../caret-dom.js";
import {classifyEditorKey, isMacPlatform} from "../editable-text-keys.js";
import type {EditorKeyAction} from "../editable-text-keys.js";
import {nodeKeys, readChildren, readDetail} from "../node-cache.js";
import {collectVisibleNodeIds} from "../hooks/use-visible-nodes.js";
import {useCreateNode, useDeleteNode, useMoveNode, useUpdateNode} from "../hooks/use-nodes.js";
import {captureOutlineView, runInUndoBatch} from "../undo-batch.js";
import {createEditDebouncer, TEXT_SAVE_DEBOUNCE_MS} from "../edit-debouncer.js";
import {useRemoveTagColor, useSetTagColor, useTagColors} from "../hooks/use-tag-colors.js";
import type {TagColors} from "../hooks/use-tag-colors.js";
import {TagColorPicker} from "./tag-color-picker.js";
import {
	deletePillAfterCaret,
	deletePillBeforeCaret,
	applyDatePhrase,
	planDateInsertion,
	renderDatePills,
	replacePill,
	serializeDatePills,
} from "../date-pills.js";
import {formatPillLabel} from "@workflowy/shared";
import type {TimeAttrs} from "@workflowy/shared";
import {useBangDatePicker} from "./bang-date-picker.js";
import {useDateAutocomplete} from "./date-autocomplete.js";
import {splitHtml} from "../rich-text.js";
import {usePillDatePicker} from "./pill-date-picker.js";
import {useDateSettings} from "../hooks/use-preferences.js";
import {renderTags, tagAtOffset} from "../tag-render.js";
import {renderLinks} from "../link-render.js";
import type {TagColorName} from "./tag-color-picker.js";

/**
 * Get the character offset in the text content from a mouse event.
 * Uses caretPositionFromPoint.
 */
function getCharacterOffsetFromClick(element: HTMLElement, event: MouseEvent): number | null {
	if ("caretPositionFromPoint" in document) {
		const position = document.caretPositionFromPoint(event.clientX, event.clientY);
		if (position?.offsetNode.nodeType === Node.TEXT_NODE) {
			// Calculate offset within the full text content
			let offset = 0;
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			let node: Node | null;
			while ((node = walker.nextNode()) !== null) {
				if (node === position.offsetNode) {
					return offset + position.offset;
				}
				offset += node.textContent?.length ?? 0;
			}
		}
	}

	return null;
}

/**
 * Toggle inline formatting on the current selection.
 */
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
	const target = document.querySelector(`.innerContentContainer[data-node-id="${CSS.escape(targetId)}"]`);
	const lines = target ? [...target.getClientRects()] : [];
	const line = direction === "up" ? lines.at(-1) : lines[0];
	if (!line || line.width === 0) {
		return null;
	}
	const x = Math.min(Math.max(caretX ?? line.left, line.left), line.right - 1);
	return {x, y: line.top + line.height / 2};
}

function execFormatCommand(command: "bold" | "italic" | "underline"): void {
	// oxlint-disable-next-line typescript/no-deprecated -- no standard replacement applies inline formatting to a contenteditable with native undo
	document.execCommand(command);
}

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
export function EditableText({nodeId, initialValue, parentId, priority, isEditing, clickPosition}: EditableTextProps) {
	const contentRef = useRef<HTMLSpanElement>(null);
	const queryClient = useQueryClient();
	const stopEditing = useOutlineStore((state) => state.stopEditing);
	const startEditing = useOutlineStore((state) => state.startEditing);
	const resumeEditing = useOutlineStore((state) => state.resumeEditing);
	const focusNote = useOutlineStore((state) => state.focusNote);
	const releaseEditing = useOutlineStore((state) => state.releaseEditing);
	const openSearchWithQuery = useOutlineStore((state) => state.openSearchWithQuery);
	const openSearchFromEditing = useOutlineStore((state) => state.openSearchFromEditing);
	const updateNodeMutation = useUpdateNode();
	const createNodeMutation = useCreateNode();
	const deleteNodeMutation = useDeleteNode();
	const moveNodeMutation = useMoveNode();
	const holdEditing = useOutlineStore((state) => state.holdEditing);
	const tagColors = useTagColors();
	const dateSettings = useDateSettings();
	const setTagColorMutation = useSetTagColor();
	const removeTagColorMutation = useRemoveTagColor();

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

	// The HTML as of editing start, held while editing so saves and refetches never rewrite the DOM under the caret.
	const [editingHtml, setEditingHtml] = useState<string | null>(null);
	if (isEditing && editingHtml === null) {
		setEditingHtml(initialValue);
	} else if (!isEditing && editingHtml !== null) {
		setEditingHtml(null);
	}
	const storedEditorHtml = editingHtml ?? initialValue;
	// Pills are atomic in edit mode too; every save path serializes them back to stored `<time>` markup.
	const editorHtml = useMemo(() => renderDatePills(storedEditorHtml, dateSettings), [storedEditorHtml, dateSettings]);

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

		nameSaver.saveNow(serializeDatePills(contentRef.current.innerHTML));
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
				const html = serializeDatePills(content.innerHTML);
				const {before, after} =
					replaceEnd === undefined ? {before: html, after: ""} : splitHtml(html, offset, replaceEnd);
				const plan = planDateInsertion(before + after, offset, attrs, {addSpaceBefore});
				content.focus();
				content.innerHTML = renderDatePills(plan.html, dateSettings);
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
	const openSettings = useOutlineStore((state) => state.openSettings);
	const dateAutocomplete = useDateAutocomplete({
		editorRef: contentRef,
		dateSettings,
		isBlocked: isDatePickerOpen,
		onApply: (phrase) => {
			const content = contentRef.current;
			if (content) {
				const plan = applyDatePhrase(serializeDatePills(content.innerHTML), phrase);
				content.innerHTML = renderDatePills(plan.html, dateSettings);
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

	// A plain click on a display-mode pill edits or removes just that pill.
	const pillPicker = usePillDatePicker({
		dateSettings,
		onChange: (pillIndex, attrs) => {
			updateNode({nodeId, name: replacePill(initialValue, pillIndex, attrs)});
		},
	});
	const {open: openPillPicker} = pillPicker;

	const handleInput = useCallback(
		(event: React.SyntheticEvent<HTMLSpanElement>) => {
			handleDateTrigger(event.nativeEvent);
			handleDateAutocomplete();
			if (contentRef.current) {
				nameSaver.change(serializeDatePills(contentRef.current.innerHTML));
			}
		},
		[handleDateTrigger, handleDateAutocomplete, nameSaver],
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
			const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = useOutlineStore.getState();
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
			const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = useOutlineStore.getState();
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
			const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = useOutlineStore.getState();
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
		const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = useOutlineStore.getState();
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
		const html = serializeDatePills(content.innerHTML);
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
			content.innerHTML = renderDatePills(plan.currentName, dateSettings);
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
		const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = useOutlineStore.getState();
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
		nameSaver.reset(serializeDatePills(content.innerHTML));
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
			const {zoomedNodeId, expandedIds, showCompleted, animatingCompletionIds} = useOutlineStore.getState();
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
			const currentRow = toRow(current, serializeDatePills(content.innerHTML));
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
					content.innerHTML = renderDatePills(plan.name, dateSettings);
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
			const html = serializeDatePills(content.innerHTML);
			const next =
				direction === "backward" ? deletePillBeforeCaret(html, offset) : deletePillAfterCaret(html, offset);
			if (next === null) {
				return false;
			}
			content.innerHTML = renderDatePills(next, dateSettings);
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

	const toggleStrikethrough = useCallback(() => {
		const selection = globalThis.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
			return;
		}

		const range = selection.getRangeAt(0);

		// Check if selection is already wrapped in <s> tag
		let parentS: HTMLElement | null = null;
		let node: Node | null = range.commonAncestorContainer;
		while (node && node !== contentRef.current) {
			if (node instanceof HTMLElement && node.tagName === "S") {
				parentS = node;
				break;
			}
			node = node.parentNode;
		}

		if (parentS) {
			// Remove strikethrough: unwrap the <s> tag
			if (parentS.parentNode) {
				while (parentS.firstChild) {
					parentS.before(parentS.firstChild);
				}
				parentS.remove();
			}
		} else {
			// Add strikethrough: wrap selection in <s> tag
			const sElement = document.createElement("s");
			sElement.append(range.extractContents());
			range.insertNode(sElement);

			// Restore selection to the wrapped content
			selection.removeAllRanges();
			const newRange = document.createRange();
			newRange.selectNodeContents(sElement);
			selection.addRange(newRange);
		}
	}, []);

	const toggleCode = useCallback(() => {
		const selection = globalThis.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
			return;
		}

		const range = selection.getRangeAt(0);

		// Check if selection is already wrapped in <code> tag
		let parentCode: HTMLElement | null = null;
		let node: Node | null = range.commonAncestorContainer;
		while (node && node !== contentRef.current) {
			if (node instanceof HTMLElement && node.tagName === "CODE") {
				parentCode = node;
				break;
			}
			node = node.parentNode;
		}

		if (parentCode) {
			// Remove code: unwrap the <code> tag
			if (parentCode.parentNode) {
				while (parentCode.firstChild) {
					parentCode.before(parentCode.firstChild);
				}
				parentCode.remove();
			}
		} else {
			// Add code: wrap selection in <code> tag
			const codeElement = document.createElement("code");
			codeElement.append(range.extractContents());
			range.insertNode(codeElement);

			// Restore selection to the wrapped content
			selection.removeAllRanges();
			const newRange = document.createRange();
			newRange.selectNodeContents(codeElement);
			selection.addRange(newRange);
		}
	}, []);

	const toggleCodeBlock = useCallback(() => {
		if (!contentRef.current) {
			return;
		}

		// Check if content is already wrapped in <pre><code>
		const firstChild = contentRef.current.firstElementChild;
		const isCodeBlock = firstChild?.tagName === "PRE" && firstChild.firstElementChild?.tagName === "CODE";

		if (isCodeBlock) {
			// Remove code block: extract content from <pre><code>
			contentRef.current.innerHTML = firstChild.firstElementChild.innerHTML;
		} else {
			// Add code block: wrap entire content in <pre><code>
			const preElement = document.createElement("pre");
			const codeElement = document.createElement("code");
			codeElement.innerHTML = contentRef.current.innerHTML;
			preElement.append(codeElement);
			contentRef.current.innerHTML = "";
			contentRef.current.append(preElement);
		}
	}, []);

	const toggleQuote = useCallback(() => {
		if (!contentRef.current) {
			return;
		}

		// Check if content is already wrapped in <blockquote>
		const firstChild = contentRef.current.firstElementChild;
		const isQuote = firstChild?.tagName === "BLOCKQUOTE";

		if (isQuote) {
			// Remove quote: extract content from <blockquote>
			contentRef.current.innerHTML = firstChild.innerHTML;
		} else {
			// Add quote: wrap entire content in <blockquote>
			const blockquoteElement = document.createElement("blockquote");
			blockquoteElement.innerHTML = contentRef.current.innerHTML;
			contentRef.current.innerHTML = "";
			contentRef.current.append(blockquoteElement);
		}
	}, []);

	const handleBlur = useCallback(() => {
		hideDateAutocomplete();
		if (shouldCommitOnBlur(useOutlineStore.getState(), nodeId)) {
			saveChanges();
		}
	}, [nodeId, saveChanges, hideDateAutocomplete]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLSpanElement>) => {
			const action = classifyEditorKey(event, isMacPlatform());
			const composing = event.nativeEvent.isComposing;
			const arrow = action === null ? undefined : CARET_ARROWS[action];
			if (arrow !== undefined && !composing && enterRootNote(arrow)) {
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
			} else if (event.key === "Escape") {
				event.preventDefault();
				const caretOffset = contentRef.current ? caretTextOffset(contentRef.current) : 0;
				saveChanges();
				openSearchFromEditing(nodeId, caretOffset);
			} else if (event.key === "b" && event.metaKey && !event.shiftKey) {
				event.preventDefault();
				execFormatCommand("bold");
			} else if (event.key === "i" && event.metaKey && !event.shiftKey) {
				event.preventDefault();
				execFormatCommand("italic");
			} else if (event.key === "u" && event.metaKey && !event.shiftKey) {
				event.preventDefault();
				execFormatCommand("underline");
			} else if (event.key === "x" && event.metaKey && event.shiftKey) {
				event.preventDefault();
				toggleStrikethrough();
			} else if (event.key === "c" && event.metaKey && event.shiftKey) {
				event.preventDefault();
				toggleCode();
			} else if (event.key === "6" && event.metaKey && event.altKey) {
				event.preventDefault();
				toggleCodeBlock();
			} else if (event.key === "7" && event.metaKey && event.altKey) {
				event.preventDefault();
				toggleQuote();
			}
		},
		[
			deleteAdjacentPill,
			deleteIfEmpty,
			enterRootNote,
			focusNote,
			mergeWithSibling,
			moveToAdjacentNode,
			crossRowHorizontally,
			nodeId,
			openSearchFromEditing,
			saveChanges,
			splitAtSelection,
			toggleStrikethrough,
			toggleCode,
			toggleCodeBlock,
			toggleQuote,
		],
	);

	/**
	 * Handle text clicks:
	 * - Plain click on a .contentTag span: opens search (Workflowy behavior)
	 * - Cmd+click: detect tag at cursor position and search
	 * - Otherwise: start editing at click position
	 */
	const handleTextClick = useCallback(
		(event: React.MouseEvent<HTMLSpanElement>) => {
			const target = event.target;

			// Plain click on a .contentTag span (or its inner text) opens search directly
			const tagEl = target instanceof Element ? target.closest(".contentTag") : null;
			if (tagEl) {
				const tagText = tagEl.textContent;
				if (tagText) {
					event.preventDefault();
					event.stopPropagation();
					openSearchWithQuery(tagText);
				}
				return;
			}

			// Plain click on a date pill opens the picker on it; ⌥click is reserved for date search.
			const pillEl = target instanceof Element ? target.closest("time.monolith-pill") : null;
			if (pillEl && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				openPillPicker(pillEl, [...event.currentTarget.querySelectorAll("time.monolith-pill")].indexOf(pillEl));
				return;
			}

			// Cmd+click: detect tag at cursor position
			if (event.metaKey) {
				const element = event.currentTarget;
				const {textContent} = element;
				const offset = getCharacterOffsetFromClick(element, event.nativeEvent);

				if (offset !== null) {
					const tag = tagAtOffset(textContent, offset);
					if (tag) {
						event.preventDefault();
						event.stopPropagation();
						openSearchWithQuery(tag);
					}
				}
				return;
			}

			// Regular click: start editing at click position
			event.stopPropagation();
			startEditing(nodeId, {x: event.clientX, y: event.clientY});
		},
		[nodeId, startEditing, openSearchWithQuery, openPillPicker],
	);

	// Show the color-trigger caret when hovering a tag; a short hide delay lets the
	// pointer travel from the tag to the caret without it disappearing.
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
		}, 200);
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

	const openPicker = useCallback(() => {
		if (!tagHover) {
			return;
		}
		cancelHide();
		setColorPicker({tag: tagHover.tag, top: tagHover.bottom + 4, left: tagHover.left});
		setTagHover(null);
	}, [tagHover, cancelHide]);

	const applyTagColor = useCallback(
		(color: TagColorName) => {
			if (colorPicker) {
				setTagColorMutation.mutate({name: colorPicker.tag, color});
			}
			setColorPicker(null);
		},
		[colorPicker, setTagColorMutation],
	);

	const clearTagColor = useCallback(() => {
		if (colorPicker) {
			removeTagColorMutation.mutate(colorPicker.tag);
		}
		setColorPicker(null);
	}, [colorPicker, removeTagColorMutation]);

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
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setColorPicker(null);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [colorPicker]);

	if (!isEditing) {
		return (
			<>
				{/* Pointer entry point: a click places the caret for editing, and clicks on rendered .contentTag spans are delegated here. */}
				<span
					className="innerContentContainer"
					data-node-id={nodeId}
					dangerouslySetInnerHTML={{
						__html: renderTags(renderDatePills(renderLinks(initialValue), dateSettings)),
					}}
					onClick={handleTextClick}
					onMouseLeave={scheduleHide}
					// oxlint-disable-next-line jsx-a11y/mouse-events-have-key-events -- the tag-color trigger is a pointer-only affordance; the span is not focusable
					onMouseOver={handleTagHover}
					role="presentation"
				/>
				{tagHover &&
					!colorPicker &&
					createPortal(
						<button
							aria-label="Set tag color"
							className="tag-color-trigger"
							onClick={openPicker}
							onMouseEnter={cancelHide}
							onMouseLeave={scheduleHide}
							style={{top: `${tagHover.top}px`, left: `${tagHover.right + 1}px`}}
							type="button"
						>
							<svg aria-hidden="true" viewBox="0 0 10 6">
								<path d="M0 0 L5 6 L10 0 Z" fill="currentColor" />
							</svg>
						</button>,
						document.body,
					)}
				{colorPicker && (
					<TagColorPicker
						currentColor={tagColors[colorPicker.tag.toLowerCase()]}
						left={colorPicker.left}
						onRemove={clearTagColor}
						onSelect={applyTagColor}
						top={colorPicker.top}
					/>
				)}
				{pillPicker.popup}
			</>
		);
	}

	return (
		<>
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- contentEditable makes this an implicit textbox, which the rule does not model */}
			<span
				className="innerContentContainer editing"
				data-node-id={nodeId}
				contentEditable
				dangerouslySetInnerHTML={{__html: editorHtml}}
				onBlur={handleBlur}
				onInput={handleInput}
				onKeyDown={handleKeyDown}
				ref={contentRef}
				suppressContentEditableWarning
			/>
			{datePicker.popup}
			{dateAutocomplete.flyout}
		</>
	);
}
