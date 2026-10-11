/** The contenteditable of the node being edited, when it is rendered. */
export function editorElement(nodeId: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`.innerContentContainer.editing[data-node-id="${CSS.escape(nodeId)}"]`);
}

/** Number of text characters between the start of `element` and the caret. */
export function caretTextOffset(element: HTMLElement): number {
	const selection = globalThis.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return element.textContent.length;
	}
	const caret = selection.getRangeAt(0);
	if (!element.contains(caret.endContainer)) {
		return element.textContent.length;
	}
	const before = document.createRange();
	before.selectNodeContents(element);
	before.setEnd(caret.endContainer, caret.endOffset);
	return before.toString().length;
}

/** Collapse the selection to `offset` text characters into `element`, clamped to its end. */
export function placeCaretAtTextOffset(element: HTMLElement, offset: number): void {
	const range = document.createRange();
	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	let remaining = offset;
	let placed = false;
	for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
		const length = text.textContent?.length ?? 0;
		if (remaining <= length) {
			range.setStart(text, remaining);
			placed = true;
			break;
		}
		remaining -= length;
	}
	if (!placed) {
		range.selectNodeContents(element);
	}
	range.collapse(placed);
	const selection = globalThis.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}
