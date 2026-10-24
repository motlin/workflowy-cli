import {placeSelectionAtTextOffsets, selectionTextOffsets} from "./caret-dom.js";
import {renderDatePills, serializeDatePills} from "./date-pills.js";
import type {DateSettings} from "./date-settings.js";
import {addMonolithGuards} from "./monolith-guards.js";
import {renderTags, stripTagMarkup} from "./tag-render.js";

/** Stored name HTML as the name editor shows it: atomic date pills and colored `.contentTag` spans. */
export function renderEditorHtml(html: string, dateSettings: DateSettings): string {
	return addMonolithGuards(renderTags(renderDatePills(html, dateSettings)));
}

/** The name editor's innerHTML back to stored HTML: tag spans unwrapped, date pills to canonical `<time>`. */
export function serializeEditorHtml(html: string): string {
	return serializeDatePills(stripTagMarkup(html));
}

/** An IME composition is in progress, so the DOM under it must not be rewritten. */
export function isComposingInput(event: Event | undefined): boolean {
	return event instanceof InputEvent && event.isComposing;
}

function tagSignature(root: ParentNode): string {
	return [...root.querySelectorAll<HTMLElement>(".contentTag")]
		.map((tag) => `${tag.dataset.val ?? ""}\u0000${tag.textContent}`)
		.join("\u0001");
}

/**
 * Swap in `html`, the editor's text freshly rendered, when its tag spans differ from the
 * editor's, keeping the selection. Like upstream, which re-renders tags on every edit, a
 * tag colors on each keystroke while it is typed (`#w`, `#wo`, ...) and uncolors when broken.
 */
export function retagEditor(editor: HTMLElement, html: string): void {
	const rendered = document.createElement("template");
	rendered.innerHTML = html;
	if (tagSignature(rendered.content) === tagSignature(editor)) {
		return;
	}
	const {start, end} = selectionTextOffsets(editor);
	editor.innerHTML = html;
	placeSelectionAtTextOffsets(editor, start, end);
}
