import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {useQueryClient} from "@tanstack/react-query";
import {shouldCommitOnBlur, useOutlineStore} from "../stores/outline.js";
import {planInsertSiblingAfter} from "../tree-ops.js";
import {adjacentVisibleNode, backspaceDeleteTarget, isCaretOnBoundaryLine} from "../caret-navigation.js";
import type {VerticalDirection} from "../caret-navigation.js";
import {caretTextOffset, placeCaretAtTextOffset} from "../caret-dom.js";
import {readChildren} from "../node-cache.js";
import {collectVisibleNodeIds} from "../hooks/use-visible-nodes.js";
import {useCreateNode, useDeleteNode, useUpdateNode} from "../hooks/use-nodes.js";
import {useRemoveTagColor, useSetTagColor, useTagColors} from "../hooks/use-tag-colors.js";
import type {TagColors} from "../hooks/use-tag-colors.js";
import {TagColorPicker} from "./tag-color-picker.js";
import {DEFAULT_DATE_SETTINGS, renderDatePills} from "../date-pills.js";
import {renderTags, tagAtOffset} from "../tag-render.js";
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

/**
 * Inline editable text component using contenteditable.
 * - Supports HTML formatting (bold, italic preserved from node content)
 * - Saves on blur
 * - Enter creates a new sibling node below and focuses it
 * - Backspace in an empty, childless node deletes it and edits the previous node
 * - Escape commits the text and opens search; dismissing search resumes editing here
 */
export function EditableText({nodeId, initialValue, parentId, priority, isEditing, clickPosition}: EditableTextProps) {
	const contentRef = useRef<HTMLSpanElement>(null);
	const queryClient = useQueryClient();
	const stopEditing = useOutlineStore((state) => state.stopEditing);
	const startEditing = useOutlineStore((state) => state.startEditing);
	const resumeEditing = useOutlineStore((state) => state.resumeEditing);
	const releaseEditing = useOutlineStore((state) => state.releaseEditing);
	const openSearchWithQuery = useOutlineStore((state) => state.openSearchWithQuery);
	const openSearchFromEditing = useOutlineStore((state) => state.openSearchFromEditing);
	const updateNodeMutation = useUpdateNode();
	const createNodeMutation = useCreateNode();
	const deleteNodeMutation = useDeleteNode();
	const tagColors = useTagColors();
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

	// Store the value at the time editing started for comparison
	const initialValueRef = useRef(initialValue);

	// Focus and position cursor when entering edit mode
	useEffect(() => {
		if (isEditing && contentRef.current) {
			contentRef.current.focus();
			// Store the initial value when starting to edit
			initialValueRef.current = initialValue;

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
	}, [isEditing, initialValue, clickPosition, nodeId]);

	const saveChanges = useCallback(() => {
		if (!contentRef.current) {
			return;
		}

		const newValue = contentRef.current.innerHTML;

		// Only save if the value has changed
		if (newValue !== initialValueRef.current) {
			updateNodeMutation.mutate({
				nodeId,
				name: newValue,
			});
			initialValueRef.current = newValue;
		}

		// A vertical move may already have handed editing to another node.
		if (useOutlineStore.getState().editingId === nodeId) {
			stopEditing();
		}
	}, [nodeId, updateNodeMutation, stopEditing]);

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
			const {zoomedNodeId, expandedIds, showCompleted} = useOutlineStore.getState();
			const visibleIds = collectVisibleNodeIds(queryClient, zoomedNodeId, expandedIds, showCompleted);
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

	const createSiblingBelow = useCallback(() => {
		// Save current changes first
		if (contentRef.current) {
			const newValue = contentRef.current.innerHTML;
			if (newValue !== initialValueRef.current) {
				updateNodeMutation.mutate({
					nodeId,
					name: newValue,
				});
			}
		}

		const payload = planInsertSiblingAfter(queryClient, {id: nodeId, parent_id: parentId, priority});

		stopEditing();

		// Create the new node
		createNodeMutation.mutate(payload, {
			onSuccess(createdNode) {
				startEditing(createdNode.id);
			},
		});
	}, [nodeId, parentId, priority, queryClient, updateNodeMutation, createNodeMutation, stopEditing, startEditing]);

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
		const {zoomedNodeId, expandedIds, showCompleted} = useOutlineStore.getState();
		const visibleIds = collectVisibleNodeIds(queryClient, zoomedNodeId, expandedIds, showCompleted);
		const targetId = backspaceDeleteTarget(visibleIds, nodeId, {text: content.textContent, hasChildren});
		if (targetId === null) {
			return false;
		}
		resumeEditing(targetId, Number.MAX_SAFE_INTEGER);
		deleteNodeMutation.mutate(nodeId);
		return true;
	}, [nodeId, parentId, queryClient, resumeEditing, deleteNodeMutation]);

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
		if (shouldCommitOnBlur(useOutlineStore.getState(), nodeId)) {
			saveChanges();
		}
	}, [nodeId, saveChanges]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLSpanElement>) => {
			const plainKey = !event.shiftKey && !event.metaKey && !event.altKey && !event.ctrlKey;
			if ((event.key === "ArrowUp" || event.key === "ArrowDown") && plainKey && !event.nativeEvent.isComposing) {
				if (moveToAdjacentNode(event.key === "ArrowUp" ? "up" : "down")) {
					event.preventDefault();
				}
			} else if (event.key === "Enter" && plainKey) {
				event.preventDefault();
				createSiblingBelow();
			} else if (event.key === "Backspace" && plainKey) {
				if (deleteIfEmpty()) {
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
			createSiblingBelow,
			deleteIfEmpty,
			moveToAdjacentNode,
			nodeId,
			openSearchFromEditing,
			saveChanges,
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
		[nodeId, startEditing, openSearchWithQuery],
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
						__html: renderTags(renderDatePills(initialValue, DEFAULT_DATE_SETTINGS), tagColors),
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
						currentColor={tagColors[colorPicker.tag]}
						left={colorPicker.left}
						onRemove={clearTagColor}
						onSelect={applyTagColor}
						top={colorPicker.top}
					/>
				)}
			</>
		);
	}

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- contentEditable makes this an implicit textbox, which the rule does not model
		<span
			className="innerContentContainer editing"
			data-node-id={nodeId}
			contentEditable
			dangerouslySetInnerHTML={{__html: initialValue}}
			onBlur={handleBlur}
			onKeyDown={handleKeyDown}
			ref={contentRef}
			suppressContentEditableWarning
		/>
	);
}
