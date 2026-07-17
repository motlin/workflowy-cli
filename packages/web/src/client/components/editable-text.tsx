import {useCallback, useEffect, useRef, useState} from 'react';
import {nodeKeys} from '../node-cache.js';
import type {NodeResponse} from '../../node-types.js';
import {createPortal} from 'react-dom';
import {useQueryClient} from '@tanstack/react-query';
import {useOutlineStore} from '../stores/outline.js';
import {insertAfterPriority, sortByPriority} from '../tree-position.js';
import {useCreateNode, useUpdateNode} from '../hooks/use-nodes.js';
import {useRemoveTagColor, useSetTagColor, useTagColors, type TagColors} from '../hooks/use-tag-colors.js';
import {TagColorPicker, type TagColorName} from './tag-color-picker.js';

// Regex to match #tags and @mentions
// Matches: #tag, #tag-name, #tag_name, @mention, @user-name, @user_name
const TAG_PATTERN = /[#@][\w-]+/g;

/**
 * Wrap hashtags and mentions in styled spans for visual highlighting.
 * Uncolored tags are gray underlined links (Cmd+click opens search); tags with
 * an assigned color render as a colored pill (matching production workflowy.com).
 */
function wrapTagsInSpans(html: string, tagColors: TagColors): string {
	// Reset lastIndex since we're reusing the pattern
	TAG_PATTERN.lastIndex = 0;
	return html.replaceAll(TAG_PATTERN, (match) => {
		const color = tagColors[match];
		const className = color ? `tag-link tag-colored bc-${color}` : 'tag-link';
		return `<span class="${className}">${match}</span>`;
	});
}

/**
 * Extract the tag at a given character offset in the text.
 * Returns the tag (including # or @) if found, null otherwise.
 */
function getTagAtPosition(text: string, position: number): string | null {
	TAG_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = TAG_PATTERN.exec(text)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		if (position >= start && position <= end) {
			return match[0];
		}
	}
	return null;
}

/**
 * Get the character offset in the text content from a mouse event.
 * Uses caretPositionFromPoint (or caretRangeFromPoint for older browsers).
 */
function getCharacterOffsetFromClick(element: HTMLElement, event: MouseEvent): number | null {
	// Use caretPositionFromPoint if available (modern browsers)
	if (document.caretPositionFromPoint) {
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

	// Fallback to caretRangeFromPoint (WebKit)
	if (document.caretRangeFromPoint) {
		const range = document.caretRangeFromPoint(event.clientX, event.clientY);
		if (range?.startContainer.nodeType === Node.TEXT_NODE) {
			let offset = 0;
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			let node: Node | null;
			while ((node = walker.nextNode()) !== null) {
				if (node === range.startContainer) {
					return offset + range.startOffset;
				}
				offset += node.textContent?.length ?? 0;
			}
		}
	}

	return null;
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
 * - Escape cancels editing
 */
export function EditableText({nodeId, initialValue, parentId, priority, isEditing, clickPosition}: EditableTextProps) {
	const contentRef = useRef<HTMLSpanElement>(null);
	const queryClient = useQueryClient();
	const stopEditing = useOutlineStore((state) => state.stopEditing);
	const select = useOutlineStore((state) => state.select);
	const startEditing = useOutlineStore((state) => state.startEditing);
	const openSearchWithQuery = useOutlineStore((state) => state.openSearchWithQuery);
	const updateNodeMutation = useUpdateNode();
	const createNodeMutation = useCreateNode();
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

			// If we have a click position, place the cursor there
			if (clickPosition) {
				// Use caretPositionFromPoint to find the correct cursor position
				if (document.caretPositionFromPoint) {
					const position = document.caretPositionFromPoint(clickPosition.x, clickPosition.y);
					if (position) {
						const range = document.createRange();
						range.setStart(position.offsetNode, position.offset);
						range.collapse(true);
						const selection = globalThis.getSelection();
						selection?.removeAllRanges();
						selection?.addRange(range);
						return;
					}
				}
				// Fallback to caretRangeFromPoint (WebKit)
				if (document.caretRangeFromPoint) {
					const range = document.caretRangeFromPoint(clickPosition.x, clickPosition.y);
					if (range) {
						const selection = globalThis.getSelection();
						selection?.removeAllRanges();
						selection?.addRange(range);
						return;
					}
				}
			}

			// Fallback: select all content (for keyboard navigation or when click position unavailable)
			const range = document.createRange();
			range.selectNodeContents(contentRef.current);
			const selection = globalThis.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
		}
	}, [isEditing, initialValue, clickPosition]);

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
		}

		stopEditing();
	}, [nodeId, updateNodeMutation, stopEditing]);

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

		// Get siblings to calculate position after the current node
		const queryKey = nodeKeys.children(parentId);
		const siblings = queryClient.getQueryData<NodeResponse[]>(queryKey);

		// Position the new sibling right after this node.
		const position = insertAfterPriority(siblings ? sortByPriority(siblings) : [], nodeId, priority);

		stopEditing();

		// Create the new node
		createNodeMutation.mutate(
			{
				parent_id: parentId ?? undefined,
				name: '',
				position,
			},
			{
				onSuccess(createdNode) {
					select(createdNode.id);
					startEditing(createdNode.id);
				},
			},
		);
	}, [
		nodeId,
		parentId,
		priority,
		queryClient,
		updateNodeMutation,
		createNodeMutation,
		stopEditing,
		select,
		startEditing,
	]);

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
			if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'S') {
				parentS = node as HTMLElement;
				break;
			}
			node = node.parentNode;
		}

		if (parentS) {
			// Remove strikethrough: unwrap the <s> tag
			const parent = parentS.parentNode;
			if (parent) {
				while (parentS.firstChild) {
					parent.insertBefore(parentS.firstChild, parentS);
				}
				parentS.remove();
			}
		} else {
			// Add strikethrough: wrap selection in <s> tag
			const sElement = document.createElement('s');
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
			if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'CODE') {
				parentCode = node as HTMLElement;
				break;
			}
			node = node.parentNode;
		}

		if (parentCode) {
			// Remove code: unwrap the <code> tag
			const parent = parentCode.parentNode;
			if (parent) {
				while (parentCode.firstChild) {
					parent.insertBefore(parentCode.firstChild, parentCode);
				}
				parentCode.remove();
			}
		} else {
			// Add code: wrap selection in <code> tag
			const codeElement = document.createElement('code');
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
		const isCodeBlock = firstChild?.tagName === 'PRE' && firstChild.firstElementChild?.tagName === 'CODE';

		if (isCodeBlock) {
			// Remove code block: extract content from <pre><code>
			const codeElement = firstChild.firstElementChild as HTMLElement;
			contentRef.current.innerHTML = codeElement.innerHTML;
		} else {
			// Add code block: wrap entire content in <pre><code>
			const preElement = document.createElement('pre');
			const codeElement = document.createElement('code');
			codeElement.innerHTML = contentRef.current.innerHTML;
			preElement.append(codeElement);
			contentRef.current.innerHTML = '';
			contentRef.current.append(preElement);
		}
	}, []);

	const toggleQuote = useCallback(() => {
		if (!contentRef.current) {
			return;
		}

		// Check if content is already wrapped in <blockquote>
		const firstChild = contentRef.current.firstElementChild;
		const isQuote = firstChild?.tagName === 'BLOCKQUOTE';

		if (isQuote) {
			// Remove quote: extract content from <blockquote>
			contentRef.current.innerHTML = firstChild.innerHTML;
		} else {
			// Add quote: wrap entire content in <blockquote>
			const blockquoteElement = document.createElement('blockquote');
			blockquoteElement.innerHTML = contentRef.current.innerHTML;
			contentRef.current.innerHTML = '';
			contentRef.current.append(blockquoteElement);
		}
	}, []);

	const handleBlur = useCallback(() => {
		saveChanges();
	}, [saveChanges]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLSpanElement>) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				createSiblingBelow();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				// Restore original value on escape
				if (contentRef.current) {
					contentRef.current.innerHTML = initialValueRef.current;
				}
				stopEditing();
			} else if (event.key === 'b' && event.metaKey && !event.shiftKey) {
				event.preventDefault();
				document.execCommand('bold');
			} else if (event.key === 'i' && event.metaKey && !event.shiftKey) {
				event.preventDefault();
				document.execCommand('italic');
			} else if (event.key === 'u' && event.metaKey && !event.shiftKey) {
				event.preventDefault();
				document.execCommand('underline');
			} else if (event.key === 'x' && event.metaKey && event.shiftKey) {
				event.preventDefault();
				toggleStrikethrough();
			} else if (event.key === 'c' && event.metaKey && event.shiftKey) {
				event.preventDefault();
				toggleCode();
			} else if (event.key === '6' && event.metaKey && event.altKey) {
				event.preventDefault();
				toggleCodeBlock();
			} else if (event.key === '7' && event.metaKey && event.altKey) {
				event.preventDefault();
				toggleQuote();
			}
		},
		[createSiblingBelow, stopEditing, toggleStrikethrough, toggleCode, toggleCodeBlock, toggleQuote],
	);

	/**
	 * Handle text clicks:
	 * - Plain click on .tag-link span: opens search (Workflowy behavior)
	 * - Cmd+click: detect tag at cursor position and search
	 * - Otherwise: start editing at click position
	 */
	const handleTextClick = useCallback(
		(event: React.MouseEvent<HTMLSpanElement>) => {
			const target = event.target as HTMLElement;

			// Plain click on a .tag-link span opens search directly
			if (target.classList.contains('tag-link')) {
				const tagText = target.textContent;
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
				const textContent = element.textContent ?? '';
				const offset = getCharacterOffsetFromClick(element, event.nativeEvent);

				if (offset !== null) {
					const tag = getTagAtPosition(textContent, offset);
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
			const tagEl = (event.target as HTMLElement).closest?.('.tag-link') as HTMLElement | null;
			if (!tagEl) {
				return;
			}
			cancelHide();
			const rect = tagEl.getBoundingClientRect();
			setTagHover({
				tag: tagEl.textContent ?? '',
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
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			if (!(event.target as HTMLElement).closest('.tag-color-picker')) {
				setColorPicker(null);
			}
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setColorPicker(null);
			}
		};
		document.addEventListener('pointerdown', onPointerDown);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			document.removeEventListener('keydown', onKey);
		};
	}, [colorPicker]);

	if (!isEditing) {
		return (
			<>
				<span
					className="innerContentContainer"
					dangerouslySetInnerHTML={{__html: wrapTagsInSpans(initialValue, tagColors)}}
					onClick={handleTextClick}
					onMouseLeave={scheduleHide}
					onMouseOver={handleTagHover}
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
							<svg
								aria-hidden="true"
								viewBox="0 0 10 6"
							>
								<path
									d="M0 0 L5 6 L10 0 Z"
									fill="currentColor"
								/>
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
		<span
			className="innerContentContainer editing"
			contentEditable
			dangerouslySetInnerHTML={{__html: initialValue}}
			onBlur={handleBlur}
			onKeyDown={handleKeyDown}
			ref={contentRef}
			suppressContentEditableWarning
		/>
	);
}
