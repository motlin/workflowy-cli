/**
 * Upstream's hotkey hint formatter: turns a command's first combo into the chip text shown in the hotkeys panel.
 */

import {buildHotkeys} from "./keymap.js";
import type {Hotkey} from "./keymap.js";

/** The mac `[combo, command]` table in upstream insertion order, using upstream combo spelling. */
export const MAC_HOTKEYS: readonly Hotkey[] = buildHotkeys({
	mac: true,
	safari: false,
	windows: false,
	linux: false,
	chromeos: false,
	electron: false,
});

const MAC_KEYS: Readonly<Record<string, string>> = {
	meta: "⌘",
	ctrl: "⌃",
	alt: "⌥",
	shift: "⇧",
	backspace: "⌫",
	enter: "↵",
	return: "↵",
	tab: "⇥",
	space: "Space",
	down: "↓",
	up: "↑",
	left: "←",
	right: "→",
};

const OTHER_KEYS: Readonly<Record<string, string>> = {
	meta: "",
	ctrl: "Ctrl",
	alt: "Alt",
	shift: "Shift",
	backspace: "Backspace",
	enter: "Enter",
	return: "Enter",
	tab: "Tab",
};

export function hint(command: string, isMac = true): string | undefined {
	const combo = MAC_HOTKEYS.find(([, bound]) => bound === command)?.[0];
	if (combo === undefined) {
		return undefined;
	}
	const keys = isMac ? MAC_KEYS : OTHER_KEYS;
	return combo
		.replace("meta+shift", "shift+meta")
		.split("+")
		.map((part) => keys[part] ?? part.toUpperCase())
		.join(isMac ? "" : "+");
}
