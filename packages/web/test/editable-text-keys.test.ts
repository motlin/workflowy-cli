import {describe, expect, it} from "vite-plus/test";
import {classifyEditorKey} from "../src/client/editable-text-keys.js";
import type {EditorKeyEvent} from "../src/client/editable-text-keys.js";

function key(init: Partial<EditorKeyEvent> & {key: string}): EditorKeyEvent {
	return {metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init};
}

describe("classifyEditorKey", () => {
	it("maps keystrokes to upstream editor actions per platform", () => {
		const cases: [string, EditorKeyEvent, boolean][] = [
			["return", key({key: "Enter"}), true],
			["shift+return", key({key: "Enter", shiftKey: true}), true],
			["alt+return", key({key: "Enter", altKey: true}), true],
			["ctrl+shift+return", key({key: "Enter", ctrlKey: true, shiftKey: true}), true],
			["meta+return mac", key({key: "Enter", metaKey: true}), true],
			["ctrl+return non-mac", key({key: "Enter", ctrlKey: true}), false],
			["backspace", key({key: "Backspace"}), true],
			["ctrl+h mac", key({key: "h", ctrlKey: true}), true],
			["ctrl+h non-mac", key({key: "h", ctrlKey: true}), false],
			["ctrl+d mac", key({key: "d", ctrlKey: true}), true],
			["delete", key({key: "Delete"}), false],
			["ctrl+p mac", key({key: "p", ctrlKey: true}), true],
			["ctrl+n mac", key({key: "n", ctrlKey: true}), true],
			["ctrl+p non-mac", key({key: "p", ctrlKey: true}), false],
			["up", key({key: "ArrowUp"}), true],
			["down", key({key: "ArrowDown"}), false],
			["left", key({key: "ArrowLeft"}), true],
			["right", key({key: "ArrowRight"}), true],
			["shift+up", key({key: "ArrowUp", shiftKey: true}), true],
			["shift+down", key({key: "ArrowDown", shiftKey: true}), true],
			["meta+a mac", key({key: "a", metaKey: true}), true],
			["meta+up", key({key: "ArrowUp", metaKey: true}), true],
			["x", key({key: "x"}), true],
		];
		expect(cases.map(([name, event, isMac]) => [name, classifyEditorKey(event, isMac)])).toStrictEqual([
			["return", "RETURN"],
			["shift+return", "SHIFT_RETURN"],
			["alt+return", "CARRIAGE_RETURN"],
			["ctrl+shift+return", "CARRIAGE_RETURN"],
			["meta+return mac", "SUPER_RETURN"],
			["ctrl+return non-mac", "SUPER_RETURN"],
			["backspace", "DELETE_BACKWARD"],
			["ctrl+h mac", "DELETE_BACKWARD"],
			["ctrl+h non-mac", null],
			["ctrl+d mac", "DELETE_FORWARD"],
			["delete", "DELETE_FORWARD"],
			["ctrl+p mac", "CARET_UP"],
			["ctrl+n mac", "CARET_DOWN"],
			["ctrl+p non-mac", null],
			["up", "CARET_UP"],
			["down", "CARET_DOWN"],
			["left", "CARET_LEFT"],
			["right", "CARET_RIGHT"],
			["shift+up", "SELECT_UP"],
			["shift+down", "SELECT_DOWN"],
			["meta+a mac", "SELECT_ALL"],
			["meta+up", null],
			["x", null],
		]);
	});
});
