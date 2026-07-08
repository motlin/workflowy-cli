import {useCallback, useEffect, useRef, useState} from 'react';
import {useOutlineStore} from '../stores/outline.js';
import {useUpdateNode} from '../hooks/use-nodes.js';

interface EditableNoteProps {
	nodeId: string;
	initialValue: string;
	isEditing: boolean;
}

/**
 * Inline editable note component using contenteditable.
 * - Displayed below the node text in smaller font
 * - Saves on blur
 * - Escape cancels editing and hides note if empty
 * - Enter (without shift) exits editing mode
 * - Shift+Enter inserts a line break
 * - Collapsible with expand/collapse toggle for long notes
 */
export function EditableNote({nodeId, initialValue, isEditing}: EditableNoteProps) {
	const contentRef = useRef<HTMLDivElement>(null);
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

		const newValue = contentRef.current.innerHTML;

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
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				saveChanges();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				// Restore original value on escape
				if (contentRef.current) {
					contentRef.current.innerHTML = initialValueRef.current;
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
	const hasContent = initialValue.trim() !== '';
	if (!isEditing && !hasContent) {
		return null;
	}

	if (!isEditing) {
		return (
			<div
				className={`outline-node-note ${isExpanded ? 'expanded' : 'collapsed'}`}
				dangerouslySetInnerHTML={{__html: initialValue}}
				onClick={toggleExpand}
			/>
		);
	}

	return (
		<div
			className="outline-node-note editing"
			contentEditable
			dangerouslySetInnerHTML={{__html: initialValue}}
			onBlur={handleBlur}
			onKeyDown={handleKeyDown}
			ref={contentRef}
			suppressContentEditableWarning
		/>
	);
}
