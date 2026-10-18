import type {Options} from "react-hotkeys-hook";

/**
 * Hotkey bindings for punctuation keys.
 *
 * react-hotkeys-hook matches KeyboardEvent.code, not the typed character, and splits
 * a binding on "," into alternatives. Punctuation is therefore spelled by its lowercased
 * code name ("period" for Period, "bracketleft" for BracketLeft), never the character.
 */
export const punctuationHotkeys = {
	zoomIn: "meta+period",
	zoomOut: "meta+comma",
	historyBack: "meta+bracketleft",
	historyForward: "meta+bracketright",
	home: "meta+quote",
	toggleHelp: "meta+shift+slash",
} as const;

/**
 * Hotkey bindings for structural moves, each a comma-separated list of alternatives.
 * The ctrl+shift arrow aliases match workflowy.com.
 */
export const structureHotkeys = {
	indent: "tab, ctrl+shift+right",
	outdent: "shift+tab, ctrl+shift+left",
	moveUp: "shift+meta+up, ctrl+shift+up",
	moveDown: "shift+meta+down, ctrl+shift+down",
} as const;

/** Toggle complete on the edited node: Cmd+Enter on mac, Ctrl+Enter elsewhere, as upstream. */
export const completeHotkey = "meta+enter, ctrl+enter";

/**
 * Options for navigation shortcuts. Almost every keypress happens while a node is being
 * edited, so navigation fires from inside the edited text, as on workflowy.com.
 */
export const navigationShortcut = {
	preventDefault: true,
	enableOnFormTags: false,
	enableOnContentEditable: true,
} as const satisfies Options;
