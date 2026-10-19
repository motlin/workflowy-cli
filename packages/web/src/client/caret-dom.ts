// Caret offsets count plain-text units: a date pill (`<time>`) is one unit and the pills'
// U+FEFF caret guards count zero, matching `rich-text.ts` offsets into stored HTML.

const BOM = "﻿";

/** The contenteditable of the node being edited, when it is rendered. */
export function editorElement(nodeId: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`.innerContentContainer.editing[data-node-id="${CSS.escape(nodeId)}"]`);
}

function isPill(node: Node): node is Element {
	return node instanceof Element && node.localName === "time";
}

function unitsIn(node: Node): number {
	if (node.nodeType === Node.TEXT_NODE) {
		return (node.textContent ?? "").replaceAll(BOM, "").length;
	}
	if (isPill(node)) {
		// A pill cut by the range counts only once its label is inside it.
		return node.textContent.replaceAll(BOM, "") === "" ? 0 : 1;
	}
	let count = 0;
	for (const child of node.childNodes) {
		count += unitsIn(child);
	}
	return count;
}

/** Plain-text units in `element`'s content. */
export function textUnitLength(element: HTMLElement): number {
	return unitsIn(element);
}

function unitsBefore(element: HTMLElement, container: Node, offset: number): number {
	const before = document.createRange();
	before.selectNodeContents(element);
	before.setEnd(container, offset);
	return unitsIn(before.cloneContents());
}

/** Number of plain-text units between the start of `element` and the caret. */
export function caretTextOffset(element: HTMLElement): number {
	const selection = globalThis.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return textUnitLength(element);
	}
	const caret = selection.getRangeAt(0);
	if (!element.contains(caret.endContainer)) {
		return textUnitLength(element);
	}
	return unitsBefore(element, caret.endContainer, caret.endOffset);
}

/**
 * Plain-text offsets of the selection's start and end within `element`; both are
 * the text length when the selection lies outside it.
 */
export function selectionTextOffsets(element: HTMLElement): {start: number; end: number} {
	const selection = globalThis.getSelection();
	const length = textUnitLength(element);
	if (!selection || selection.rangeCount === 0) {
		return {start: length, end: length};
	}
	const range = selection.getRangeAt(0);
	if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
		return {start: length, end: length};
	}
	return {
		start: unitsBefore(element, range.startContainer, range.startOffset),
		end: unitsBefore(element, range.endContainer, range.endOffset),
	};
}

/** Raw index in `text` after `units` non-guard characters, or null when it has fewer. */
function rawIndex(text: string, units: number): number | null {
	let remaining = units;
	for (let index = 0; index <= text.length; index++) {
		if (remaining === 0) {
			return index;
		}
		if (text[index] !== BOM) {
			remaining--;
		}
	}
	return null;
}

/** Collapse the selection to `offset` plain-text units into `element`, clamped to its end. */
export function placeCaretAtTextOffset(element: HTMLElement, offset: number): void {
	const range = document.createRange();
	let remaining = offset;
	// Sets the range start at the target unit; true once placed.
	const visit = (node: Node): boolean => {
		for (const child of node.childNodes) {
			if (isPill(child)) {
				if (remaining === 0) {
					range.setStartBefore(child);
					return true;
				}
				remaining--;
				if (remaining === 0) {
					range.setStartAfter(child);
					return true;
				}
			} else if (child.nodeType === Node.TEXT_NODE) {
				const text = child.textContent ?? "";
				const index = rawIndex(text, remaining);
				if (index !== null) {
					range.setStart(child, index);
					return true;
				}
				remaining -= text.replaceAll(BOM, "").length;
			} else if (visit(child)) {
				return true;
			}
		}
		return false;
	};
	const placed = visit(element);
	if (!placed) {
		range.selectNodeContents(element);
	}
	range.collapse(placed);
	const selection = globalThis.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}
