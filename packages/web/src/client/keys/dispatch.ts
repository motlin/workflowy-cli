/**
 * Upstream's window keydown dispatcher (`fg4`) and `WF.Hotkeys.process` (`ng4`): every combo in the hotkey table
 * runs its command, and a bound combo is claimed (preventDefault) even when its command is missing or unavailable,
 * so ⌘S never opens Save and ⌘P never prints.
 */
import {buildHotkeys, comboFromEvent, currentPlatform} from "./keymap.js";
import type {KeyComboEvent} from "./keymap.js";

/** What a command acts on: the row holding the caret (upstream's focused item) and the zoomed node. */
export interface CommandContext {
	items: readonly string[];
	zoomedId: string | null;
}

export interface Command {
	/** Upstream's `available()`; a command without one is always available. */
	available?: (ctx: CommandContext) => boolean;
	execute: (ctx: CommandContext) => void;
}

/** Commands keyed by upstream command id (`zoom_in`, `complete`, ...). */
export type CommandRegistry = Readonly<Record<string, Command>>;

export type ComboResult = "claimed" | "unclaimed";

/**
 * Local-only bindings kept until the user decides: in-app history on ⌘[ / ⌘] (upstream binds it only in Electron)
 * and ⌘? for the shortcuts panel beside upstream's ⌘/.
 */
const LOCAL_HOTKEYS = [
	["meta+[", "navigate_backward"],
	["meta+]", "navigate_forward"],
	["meta+shift+/", "toggle_rightbar"],
] as const;

const tables = new Map<boolean, ReadonlyMap<string, string>>();

/** The combo-to-command table for the current browser, with its mac flag overridden, plus the local extras. */
export function hotkeyTable(isMac: boolean): ReadonlyMap<string, string> {
	let table = tables.get(isMac);
	if (table === undefined) {
		const map = new Map(buildHotkeys({...currentPlatform(), mac: isMac}));
		for (const [combo, command] of LOCAL_HOTKEYS) {
			if (!map.has(combo)) {
				map.set(combo, command);
			}
		}
		table = map;
		tables.set(isMac, table);
	}
	return table;
}

/** Upstream's `lg4`: combos left to the browser when their command is unavailable (Emacs ctrl+p/n/t on mac). */
function passesThrough(combo: string, isMac: boolean): boolean {
	const passthrough: Readonly<Record<string, boolean>> = {
		"ctrl+p": isMac,
		"ctrl+n": isMac,
		"ctrl+t": isMac,
		"alt+;": isMac,
		"alt+w": true,
	};
	return passthrough[combo] === true;
}

/** Upstream's `process(combo)`: run the bound command when available; claim every bound combo but the passthroughs. */
export function processCombo(
	combo: string,
	registry: CommandRegistry,
	ctx: CommandContext,
	isMac: boolean,
	table: ReadonlyMap<string, string> = hotkeyTable(isMac),
): ComboResult {
	const commandId = table.get(combo);
	if (commandId === undefined) {
		return "unclaimed";
	}
	const command = registry[commandId];
	if (command !== undefined && command.available?.(ctx) !== false) {
		command.execute(ctx);
		return "claimed";
	}
	return passesThrough(combo, isMac) ? "unclaimed" : "claimed";
}

/** Combos a focused button, input or menu keeps for itself. */
const CONTROL_COMBOS = new Set(["tab", "shift+tab", "meta+a", "ctrl+a", "return"]);

export interface FocusedElement {
	tabIndex: number;
	closest: (selector: string) => unknown;
}

/** Upstream returns early for these combos when a focusable control outside the outline's text holds focus. */
export function deferToFocusedControl(combo: string, active: FocusedElement | null): boolean {
	return CONTROL_COMBOS.has(combo) && active !== null && active.tabIndex >= 0 && active.closest(".name") === null;
}

/**
 * Upstream commands the local app still leaves to the browser or another owner: select-all and shift-arrow
 * selection inside the editor, and Escape (EditableText and search own it).
 * Their combos are not dispatched at all, so they keep their default behavior.
 */
export const BROWSER_NATIVE_COMMANDS: ReadonlySet<string> = new Set([
	"select_all",
	"expand_selection_up",
	"expand_selection_down",
	"focus_or_unfocus_search",
]);

/** Commands a focused form field (search box, dialog input) keeps native: upstream binds undo with `enableOnFormTags: false`. */
const FORM_FIELD_NATIVE_COMMANDS: ReadonlySet<string> = new Set(["undo", "redo"]);

/** The combo to dispatch for a keydown, or null when its command is left to the browser. */
export function keymapCombo(event: KeyComboEvent, isMac: boolean, inFormField = false): string | null {
	const combo = comboFromEvent(event);
	const commandId = hotkeyTable(isMac).get(combo);
	if (commandId === undefined) {
		return combo;
	}
	const native = BROWSER_NATIVE_COMMANDS.has(commandId) || (inFormField && FORM_FIELD_NATIVE_COMMANDS.has(commandId));
	return native ? null : combo;
}
