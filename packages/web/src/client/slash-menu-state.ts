import type {MenuKeyboardState} from "./components/flyout/menu-keyboard.js";

export interface SlashKeyInput {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	/** The caret sits at the end of the slash-input chip. */
	caretAtChipEnd: boolean;
}

/**
 * `abandon` disarms and replaces the chip with plain text (caret at its end, search not opened);
 * `disarmNoAbandon` disarms and lets the native undo run.
 */
export type SlashKeyAction = "down" | "up" | "select" | "abandon" | "disarmNoAbandon";

/** Upstream slash-menu keydown mapping; `null` leaves the key to the editor. */
export function slashKeyAction({key, ctrlKey, metaKey, caretAtChipEnd}: SlashKeyInput): SlashKeyAction | null {
	if (ctrlKey || metaKey) {
		if (key === "z" || key === "Z") {
			return "disarmNoAbandon";
		}
		if (ctrlKey && !metaKey) {
			if (key === "n") {
				return "down";
			}
			if (key === "p") {
				return "up";
			}
		}
		return null;
	}
	switch (key) {
		case "ArrowDown":
			return "down";
		case "ArrowUp":
			return "up";
		case "Enter":
		case "Tab":
			return "select";
		case "Escape":
			return "abandon";
		case "ArrowRight":
			return caretAtChipEnd ? "abandon" : null;
		default:
			return null;
	}
}

export type SlashModeEvent = {type: "mouseMove"} | {type: "hover"; index: number};

/**
 * Any `mousemove` over the scroller drops keyboard mode (no `active` row, every row `canHover`);
 * hovering a row then sets the index so the next arrow key continues from it.
 */
export function slashMode(state: MenuKeyboardState, event: SlashModeEvent): MenuKeyboardState {
	if (event.type === "mouseMove") {
		return {...state, keyboardMode: false};
	}
	return {...state, index: event.index, keyboardMode: false};
}
