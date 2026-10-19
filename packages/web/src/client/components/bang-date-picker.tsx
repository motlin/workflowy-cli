import {useCallback, useRef, useState} from "react";
import type {ReactNode} from "react";
import {createPortal} from "react-dom";
import {formatPillLabel, guessDates, presetDate} from "@workflowy/shared";
import type {DatePreset, TimeAttrs} from "@workflowy/shared";
import {caretTextOffset} from "../caret-dom.js";
import {shouldTriggerDatePopup, timeAttrsFromDates} from "../date-pills.js";
import type {DateSettings} from "../date-settings.js";
import {useOutlineStore} from "../stores/outline.js";
import {DatePickerPopup} from "./date-picker-popup.js";

const TRIGGER_INPUT_TYPES = new Set(["insertText", "insertCompositionText"]);
const TRIGGER_DATA = new Set(["!", "！"]);

interface BangDatePickerOptions {
	/** The contenteditable whose caret offsets (a pill counting one) the callbacks receive. */
	editorRef: React.RefObject<HTMLElement | null>;
	dateSettings: DateSettings;
	/** The popup took focus at plain-text `offset`; the editor must not commit on its blur. */
	onOpen: (offset: number) => void;
	/** Insert a pill at `offset`, refocus the editor with the caret after it, and save. */
	onInsert: (attrs: TimeAttrs, offset: number) => void;
	/** Closed with nothing inserted: refocus the editor with the caret at `offset`. */
	onCancel: (offset: number) => void;
}

interface OpenPicker {
	offset: number;
	position: {left: number; top: number};
	term: string;
	isRange: boolean;
}

/** Deletes the `!!` just typed before a collapsed caret in a text node; false when it is not there. */
function removeTypedBangs(editor: HTMLElement): boolean {
	const selection = globalThis.getSelection();
	const caret = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
	if (!caret?.collapsed || caret.startContainer.nodeType !== Node.TEXT_NODE || caret.startOffset < 2) {
		return false;
	}
	const before = document.createRange();
	before.selectNodeContents(editor);
	before.setEnd(caret.startContainer, caret.startOffset);
	const after = document.createRange();
	after.selectNodeContents(editor);
	after.setStart(caret.startContainer, caret.startOffset);
	const head = before.toString();
	if (!shouldTriggerDatePopup(head + after.toString(), head.length)) {
		return false;
	}
	const bangs = document.createRange();
	bangs.setStart(caret.startContainer, caret.startOffset - 2);
	bangs.setEnd(caret.startContainer, caret.startOffset);
	bangs.deleteContents();
	return true;
}

/** Where the popup's top-left goes: the caret's left edge and line bottom, in page coordinates. */
function caretPosition(): {left: number; top: number} {
	const selection = globalThis.getSelection();
	const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
	const rect = range?.getClientRects()[0] ?? range?.getBoundingClientRect();
	return {left: (rect?.left ?? 0) + globalThis.scrollX, top: (rect?.bottom ?? 0) + globalThis.scrollY};
}

/**
 * Upstream's `!!` date trigger: typing `!!` between whitespace/edges deletes both `!` and opens
 * the date picker at the caret. Enter with a parsed date, a preset or a day click inserts a pill;
 * Enter with nothing parsed and Escape insert nothing and do not restore the `!!`.
 * Call `handleInput` with the `onInput` native event before saving the edited text.
 */
export function useBangDatePicker({editorRef, dateSettings, onOpen, onInsert, onCancel}: BangDatePickerOptions): {
	handleInput: (native: Event) => void;
	popup: ReactNode;
} {
	const [picker, setPicker] = useState<OpenPicker | null>(null);
	// The open picker for close callbacks that can fire twice (a preset row selects, then the menu exits).
	const openRef = useRef<OpenPicker | null>(null);
	const openSettings = useOutlineStore((state) => state.openSettings);

	const handleInput = useCallback(
		(native: Event) => {
			const editor = editorRef.current;
			if (
				editor === null ||
				openRef.current !== null ||
				!(native instanceof InputEvent) ||
				!TRIGGER_INPUT_TYPES.has(native.inputType) ||
				!TRIGGER_DATA.has(native.data ?? "") ||
				!removeTypedBangs(editor)
			) {
				return;
			}
			const offset = caretTextOffset(editor);
			const opened: OpenPicker = {offset, position: caretPosition(), term: "", isRange: false};
			openRef.current = opened;
			onOpen(offset);
			setPicker(opened);
		},
		[editorRef, onOpen],
	);

	const close = useCallback((): OpenPicker | null => {
		const opened = openRef.current;
		openRef.current = null;
		setPicker(null);
		return opened;
	}, []);

	const apply = useCallback(
		(dates: Date[]) => {
			const opened = close();
			if (opened !== null) {
				onInsert(timeAttrsFromDates(dates), opened.offset);
			}
		},
		[close, onInsert],
	);

	const cancel = useCallback(() => {
		const opened = close();
		if (opened !== null) {
			onCancel(opened.offset);
		}
	}, [close, onCancel]);

	const update = useCallback((patch: Partial<OpenPicker>) => {
		const opened = openRef.current;
		if (opened !== null) {
			openRef.current = {...opened, ...patch};
			setPicker(openRef.current);
		}
	}, []);

	const guess = picker === null ? [] : guessDates(picker.term, {dateFormat: dateSettings.dateFormat});
	const popup =
		picker === null
			? null
			: createPortal(
					<DatePickerPopup
						selected={guess}
						weekStartDay={dateSettings.weekStartDay}
						isRange={picker.isRange}
						term={picker.term}
						position={picker.position}
						onTermChange={(term) => {
							update({term});
						}}
						onEnter={() => {
							if (guess.length > 0) {
								apply(guess);
							} else {
								cancel();
							}
						}}
						onApply={(dates) => {
							const [first] = dates;
							if (picker.isRange && dates.length === 1 && first !== undefined) {
								// A range's first click only fills the input; the second inserts the sorted range.
								update({
									term: formatPillLabel(timeAttrsFromDates([first]), {
										dateFormat: dateSettings.dateFormat,
									}),
								});
							} else {
								apply(dates);
							}
						}}
						onPreset={(preset: DatePreset) => {
							apply([presetDate(preset, {weekStartDay: dateSettings.weekStartDay})]);
						}}
						onToggleRange={() => {
							update({isRange: !picker.isRange});
						}}
						onFormat={() => {
							cancel();
							openSettings("Dates");
						}}
						onEscape={cancel}
						onClose={cancel}
					/>,
					document.body,
				);
	return {handleInput, popup};
}
