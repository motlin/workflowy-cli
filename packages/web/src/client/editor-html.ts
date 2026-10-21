import {placeSelectionAtTextOffsets, selectionTextOffsets} from "./caret-dom.js";
import {renderDatePills, serializeDatePills} from "./date-pills.js";
import type {DateSettings} from "./date-settings.js";
import {renderTags, stripTagMarkup} from "./tag-render.js";

/** Stored name HTML as the name editor shows it: atomic date pills and colored `.contentTag` spans. */
export function renderEditorHtml(html: string, dateSettings: DateSettings): string {
	return renderTags(renderDatePills(html, dateSettings));
}

/** The name editor's innerHTML back to stored HTML: tag spans unwrapped, date pills to canonical `<time>`. */
export function serializeEditorHtml(html: string): string {
	return serializeDatePills(stripTagMarkup(html));
}

/** Characters that end a #tag or @mention (`TAG_WITH_BOUNDARY_REGEXP`'s lookahead). */
const TAG_BOUNDARY = /[\s(),.!?;:/[\]]/u;

/**
 * Whether an `input` event may have completed, broken, or changed a tag. Typing a tag
 * character outside a rendered tag cannot, so a tag being typed stays plain until the
 * space (or other boundary) that completes it.
 */
export function inputMayRetag(
	event: {inputType: string; data: string | null; isComposing: boolean},
	insideTag: boolean,
): boolean {
	if (event.isComposing) {
		return false;
	}
	return insideTag || event.inputType !== "insertText" || event.data === null || TAG_BOUNDARY.test(event.data);
}

function tagSignature(root: ParentNode): string {
	return [...root.querySelectorAll<HTMLElement>(".contentTag")]
		.map((tag) => `${tag.dataset.val ?? ""}\u0000${tag.textContent}`)
		.join("\u0001");
}

/**
 * Re-render the name editor's tag spans when its text no longer matches them, keeping the
 * selection, so a completed tag colors on the very keystroke that completes it.
 */
export function retagEditor(editor: HTMLElement, dateSettings: DateSettings): void {
	const html = renderEditorHtml(serializeEditorHtml(editor.innerHTML), dateSettings);
	const rendered = document.createElement("template");
	rendered.innerHTML = html;
	if (tagSignature(rendered.content) === tagSignature(editor)) {
		return;
	}
	const {start, end} = selectionTextOffsets(editor);
	editor.innerHTML = html;
	placeSelectionAtTextOffsets(editor, start, end);
}
