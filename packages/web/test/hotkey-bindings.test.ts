import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {
	completeHotkey,
	navigationShortcut,
	punctuationHotkeys,
	structureHotkeys,
} from "../src/client/hotkey-bindings.js";

type IsHotkeyPressed = (key: string | readonly string[], delimiter?: string) => boolean;

const fakeDocument = new EventTarget();
let isHotkeyPressed: IsHotkeyPressed;

function dispatch(type: "keydown" | "keyup", code: string): void {
	fakeDocument.dispatchEvent(Object.assign(new Event(type), {code}));
}

beforeAll(async () => {
	// The library tracks pressed keys from document keydown/keyup listeners it installs on import
	vi.stubGlobal("document", fakeDocument);
	({isHotkeyPressed} = await import("react-hotkeys-hook"));
});

afterEach(() => {
	// Releasing Meta clears every pressed key
	dispatch("keyup", "MetaLeft");
});

describe("punctuationHotkeys", () => {
	const cases = [
		{name: "zoomIn", binding: punctuationHotkeys.zoomIn, codes: ["MetaLeft", "Period"]},
		{name: "zoomOut", binding: punctuationHotkeys.zoomOut, codes: ["MetaLeft", "Comma"]},
		{name: "historyBack", binding: punctuationHotkeys.historyBack, codes: ["MetaLeft", "BracketLeft"]},
		{name: "historyForward", binding: punctuationHotkeys.historyForward, codes: ["MetaLeft", "BracketRight"]},
		{name: "home", binding: punctuationHotkeys.home, codes: ["MetaLeft", "Quote"]},
		{name: "toggleHelp", binding: punctuationHotkeys.toggleHelp, codes: ["MetaLeft", "ShiftLeft", "Slash"]},
	];

	it.each(cases)("$name matches the keys it is bound to", ({binding, codes}) => {
		for (const code of codes) {
			dispatch("keydown", code);
		}
		expect({binding, pressed: isHotkeyPressed(binding, "+")}).toStrictEqual({binding, pressed: true});
	});

	it("contains no comma, which the library treats as a separator between alternatives", () => {
		expect(Object.values(punctuationHotkeys).filter((binding) => binding.includes(","))).toStrictEqual([]);
	});
});

describe("navigationShortcut", () => {
	it("fires while a node's text is being edited, but not from form fields", () => {
		expect(navigationShortcut).toStrictEqual({
			preventDefault: true,
			enableOnFormTags: false,
			enableOnContentEditable: true,
		});
	});
});

describe("structureHotkeys", () => {
	it("binds the upstream ctrl+shift arrow aliases beside tab and shift+meta arrows", () => {
		expect(structureHotkeys).toStrictEqual({
			indent: "tab, ctrl+shift+right",
			outdent: "shift+tab, ctrl+shift+left",
			moveUp: "shift+meta+up, ctrl+shift+up",
			moveDown: "shift+meta+down, ctrl+shift+down",
		});
	});
});

describe("completeHotkey", () => {
	it("binds meta+enter on mac and ctrl+enter elsewhere", () => {
		expect(completeHotkey).toBe("meta+enter, ctrl+enter");
	});
});
