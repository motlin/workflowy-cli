/**
 * Codec between contenteditable note HTML and stored note text. Upstream stores line
 * breaks as literal `\n` and shows a note containing `<br>` as empty, so the editor's
 * `<br>`/`<div>`/`<p>` structure must never reach the API.
 */

const TAG_PATTERN = /<(\/?)([a-z][\w-]*)([^>]*)>/giu;
const KEPT_ELEMENTS = new Set(["b", "i", "u", "s", "code", "a", "time"]);
const BLOCK_ELEMENTS = new Set(["div", "p"]);
const CLASS_PATTERN = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/iu;
const COLOR_CLASS_PATTERN = /^b?c-[\w-]+$/u;
const LEGACY_BREAK_PATTERN = /<br\s*\/?>/giu;

function isColorSpan(attributes: string): boolean {
	const match = CLASS_PATTERN.exec(attributes);
	const classes = (match?.[1] ?? match?.[2] ?? "").split(/\s+/u);
	return classes.includes("colored") && classes.some((name) => COLOR_CLASS_PATTERN.test(name));
}

function decodeText(text: string): string {
	return text.replaceAll("&nbsp;", " ").replaceAll(" ", " ");
}

function isKept(name: string, attributes: string): boolean {
	return KEPT_ELEMENTS.has(name) || (name === "span" && isColorSpan(attributes));
}

/** Converts the note editor's innerHTML into stored note text. */
export function editorHtmlToNote(html: string): string {
	let note = "";
	let cursor = 0;
	// For each open element, whether its open tag was emitted and so needs a close tag.
	const openElements: {name: string; kept: boolean}[] = [];
	for (const match of html.matchAll(TAG_PATTERN)) {
		note += decodeText(html.slice(cursor, match.index));
		cursor = match.index + match[0].length;
		const [tag, slash, rawName, attributes] = match;
		const name = (rawName ?? "").toLowerCase();
		const closing = slash === "/";
		if (name === "br") {
			// A block's trailing <br> is the browser's empty-line placeholder, not a line break.
			const placeholder = /^<\/(?:div|p)>/iu.test(html.slice(cursor)) || cursor === html.length;
			if (!placeholder) {
				note += "\n";
			}
		} else if (BLOCK_ELEMENTS.has(name)) {
			if (!closing && note !== "") {
				note += "\n";
			}
		} else if (closing) {
			const index = openElements.findLastIndex((element) => element.name === name);
			if (index !== -1) {
				const [element] = openElements.splice(index, 1);
				if (element?.kept === true) {
					note += `</${name}>`;
				}
			}
		} else {
			const kept = isKept(name, attributes ?? "");
			if (kept) {
				note += tag;
			}
			if (!tag.endsWith("/>")) {
				openElements.push({name, kept});
			}
		}
	}
	return note + decodeText(html.slice(cursor));
}

/** Converts stored note text into the editor's initial HTML, repairing legacy `<br>` breaks. */
export function noteToEditorHtml(note: string): string {
	return note.replaceAll(LEGACY_BREAK_PATTERN, "\n");
}

/**
 * Decides whether the note editor's HTML needs saving against the last saved note. A blank
 * (whitespace-only) note saves as `""`; an unchanged note is skipped.
 */
export function planNoteSave(initial: string, html: string): {save: boolean; note: string} {
	const converted = editorHtmlToNote(html);
	const note = converted.trim() === "" ? "" : converted;
	return {save: note !== initial, note};
}

export interface NoteKeyInput {
	key: string;
	shift: boolean;
	/** The note's plain text. */
	text: string;
	/** Selection offsets into `text`. */
	start: number;
	end: number;
	/** The caret is on the note's first / last line. */
	onFirstLine: boolean;
	onLastLine: boolean;
}

export type NoteKeyPlan =
	| {kind: "native"}
	| {kind: "noop"}
	| {kind: "insert"; text: string; caret: number}
	| {kind: "focusName"; caret: 0 | "end"}
	| {kind: "focusNextRowName"}
	| {kind: "clearAndFocusName"};

/**
 * Upstream's in-note key handling: Enter and Tab insert text (never split or indent rows),
 * Backspace in a blank note returns to the name, and arrows leave the note at its edges.
 */
export function planNoteKey({key, shift, text, start, end, onFirstLine, onLastLine}: NoteKeyInput): NoteKeyPlan {
	const collapsed = start === end;
	const atStart = collapsed && start === 0;
	const atEnd = collapsed && end === text.length;
	switch (key) {
		case "Enter": {
			if (shift) {
				return {kind: "focusName", caret: "end"};
			}
			// A trailing newline renders no line, so a second one holds the new empty line open.
			return {kind: "insert", text: end === text.length ? "\n\n" : "\n", caret: start + 1};
		}
		case "Tab": {
			return shift ? {kind: "noop"} : {kind: "insert", text: "\t", caret: start + 1};
		}
		case "Backspace": {
			return text.trim() === "" ? {kind: "clearAndFocusName"} : {kind: "native"};
		}
		case "ArrowUp": {
			return !shift && atStart && onFirstLine ? {kind: "focusName", caret: 0} : {kind: "native"};
		}
		case "ArrowDown": {
			return !shift && atEnd && onLastLine ? {kind: "focusNextRowName"} : {kind: "native"};
		}
		case "ArrowLeft": {
			return !shift && atStart ? {kind: "focusName", caret: "end"} : {kind: "native"};
		}
		case "ArrowRight": {
			return !shift && atEnd ? {kind: "focusNextRowName"} : {kind: "native"};
		}
		default: {
			return {kind: "native"};
		}
	}
}
