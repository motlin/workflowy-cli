/**
 * Upstream's window keydown dispatcher (`fg4`) and `WF.Hotkeys.process` (`ng4`): every combo in the hotkey table
 * runs its command, and a bound combo is claimed (preventDefault) even when its command is missing or unavailable,
 * so ⌘S never opens Save and ⌘P never prints.
 */
import {buildHotkeys, comboFromEvent, currentPlatform} from "./keymap.js";
import type {KeyComboEvent} from "./keymap.js";
import {selectionKeyAction} from "../item-selection.js";
import type {SelectionKeyAction} from "../item-selection.js";
import type {AppMessageAction} from "../stores/outline.js";

/** What a command acts on: the row holding the caret (upstream's focused item) and the zoomed node. */
export interface CommandContext {
	items: readonly string[];
	zoomedId: string | null;
	/** Where a picker the command opens anchors, e.g. the removed slash chip's rect. */
	anchorRect?: DOMRect;
}

export interface Command {
	/** Upstream's `available()`; a command without one is always available. */
	available?: (ctx: CommandContext) => boolean;
	execute: (ctx: CommandContext) => void;
}

/** Commands keyed by upstream command id (`zoom_in`, `complete`, ...). */
export type CommandRegistry = Readonly<Record<string, Command>>;

export type ComboResult = "claimed" | "unclaimed";

/** Local-only bindings kept until the user decides: in-app history on ⌘[ / ⌘] (upstream binds it only in Electron). */
const LOCAL_HOTKEYS = [
	["meta+[", "navigate_backward"],
	["meta+]", "navigate_forward"],
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

/**
 * Upstream `Fe4`'s keydown handler: while an app message is shown, a combo matching one of its actions' shortcuts runs
 * that action (without hiding the message) and is claimed before the hotkey table sees it.
 */
export function processAppMessageCombo(combo: string, actions: readonly AppMessageAction[]): ComboResult {
	const action = actions.find(({shortcut}) => shortcut === combo);
	if (action === undefined) {
		return "unclaimed";
	}
	action.run();
	return "claimed";
}

interface KeydownTarget {
	addEventListener: (type: "keydown", handler: (event: KeyboardEvent) => void, capture: boolean) => void;
	removeEventListener: (type: "keydown", handler: (event: KeyboardEvent) => void, capture: boolean) => void;
}

/**
 * Upstream registers the toast's shortcut listener in the capture phase, so it runs before any element handler. A
 * matching combo is claimed with `preventDefault()` only; propagation continues. Returns the remover.
 */
export function listenForAppMessageKeys(
	target: KeydownTarget,
	getActions: () => readonly AppMessageAction[] | undefined,
	comboOf: (event: KeyboardEvent) => string,
): () => void {
	const handler = (event: KeyboardEvent): void => {
		const actions = getActions();
		if (event.isComposing || actions === undefined) {
			return;
		}
		if (processAppMessageCombo(comboOf(event), actions) === "claimed") {
			event.preventDefault();
		}
	};
	target.addEventListener("keydown", handler, true);
	return () => {
		target.removeEventListener("keydown", handler, true);
	};
}

export interface SelectionKeyEvent {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	defaultPrevented: boolean;
	isComposing: boolean;
}

/**
 * The item selection's keys (upstream's hotkeys enabled while it has entries), dispatched before the hotkey table:
 * run and claim one while items are selected and focus is off every text field. A keydown an editor already turned
 * into a selection (defaultPrevented) is left alone, so one ⇧↓ never also expands it.
 */
export function processSelectionKey(
	event: SelectionKeyEvent,
	isMac: boolean,
	{hasSelection, inText}: {hasSelection: boolean; inText: boolean},
	run: (action: SelectionKeyAction) => void,
): ComboResult {
	if (event.defaultPrevented || event.isComposing || !hasSelection || inText) {
		return "unclaimed";
	}
	const action = selectionKeyAction(event, isMac);
	if (action === null) {
		return "unclaimed";
	}
	run(action);
	return "claimed";
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
 * selection inside the editor, and Escape (`useSearchEscape` owns it).
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
