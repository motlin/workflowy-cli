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
