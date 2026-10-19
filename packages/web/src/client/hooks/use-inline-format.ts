import {useCallback, useEffect, useLayoutEffect, useRef} from "react";
import type {RefObject} from "react";
import {placeCaretAtTextOffset, placeSelectionAtTextOffsets, selectionTextOffsets} from "../caret-dom.js";
import {pendingFormatApply, planInlineToggle} from "../rich-text.js";
import type {InlineAttr} from "../rich-text.js";

/** `attrs` with `attr` toggled: a second toggle of the same attribute cancels the first. */
export function togglePendingAttr(attrs: ReadonlySet<InlineAttr>, attr: InlineAttr): Set<InlineAttr> {
	const next = new Set(attrs);
	if (!next.delete(attr)) {
		next.add(attr);
	}
	return next;
}

/** Inserts typed `text` at `pos`: its first character takes the pending attributes, the rest inherit from it. */
export function insertWithPendingFormat(
	html: string,
	pos: number,
	attrs: ReadonlySet<InlineAttr>,
	text: string,
): string {
	let result = html;
	// oxlint-disable-next-line typescript/no-misused-spread -- rich-text counts code points, so each one is a character
	for (const [index, char] of [...text].entries()) {
		result = pendingFormatApply(result, pos + index, index === 0 ? attrs : new Set(), char);
	}
	return result;
}

interface InlineFormatOptions {
	editorRef: RefObject<HTMLElement | null>;
	/** The editor is mounted and editable. */
	active: boolean;
	/** The editor's content as stored HTML. */
	read: () => string;
	/** The editor's innerHTML for stored HTML. */
	render: (html: string) => string;
	/** The stored HTML changed. */
	onChange: (html: string) => void;
}

/**
 * Upstream's inline format commands for a contenteditable: a stretched selection toggles `attr` over the
 * whole range and stays selected; a collapsed caret makes the format pending (`WF.AppPendingInlineFormat`)
 * so the next typed character carries it. Pending formats clear on blur and when the caret moves.
 */
export function useInlineFormat({editorRef, active, read, render, onChange}: InlineFormatOptions) {
	const io = useRef({read, render, onChange});
	useLayoutEffect(() => {
		io.current = {read, render, onChange};
	});
	const pending = useRef<{attrs: Set<InlineAttr>; at: number}>({attrs: new Set(), at: -1});

	const applyInlineToggle = useCallback(
		(attr: InlineAttr) => {
			const element = editorRef.current;
			if (element === null) {
				return;
			}
			const sel = selectionTextOffsets(element);
			if (sel.start === sel.end) {
				const attrs = pending.current.at === sel.start ? pending.current.attrs : new Set<InlineAttr>();
				pending.current = {attrs: togglePendingAttr(attrs, attr), at: sel.start};
				return;
			}
			pending.current = {attrs: new Set(), at: -1};
			const plan = planInlineToggle(io.current.read(), sel, attr);
			element.innerHTML = io.current.render(plan.html);
			placeSelectionAtTextOffsets(element, plan.sel.start, plan.sel.end);
			io.current.onChange(plan.html);
		},
		[editorRef],
	);

	useEffect(() => {
		const element = editorRef.current;
		if (!active || element === null) {
			// oxlint-disable-next-line unicorn/no-useless-undefined -- consistent-return needs a value beside the cleanup return
			return undefined;
		}
		const clear = () => {
			pending.current = {attrs: new Set(), at: -1};
		};
		const onBeforeInput = (event: InputEvent) => {
			const {attrs, at} = pending.current;
			if (attrs.size === 0) {
				return;
			}
			const sel = selectionTextOffsets(element);
			clear();
			if (event.inputType !== "insertText" || !event.data || sel.start !== at || sel.end !== at) {
				return;
			}
			event.preventDefault();
			const html = insertWithPendingFormat(io.current.read(), at, attrs, event.data);
			element.innerHTML = io.current.render(html);
			placeCaretAtTextOffset(element, at + event.data.length);
			io.current.onChange(html);
		};
		element.addEventListener("beforeinput", onBeforeInput);
		element.addEventListener("blur", clear);
		return () => {
			element.removeEventListener("beforeinput", onBeforeInput);
			element.removeEventListener("blur", clear);
		};
	}, [active, editorRef]);

	return {applyInlineToggle};
}
