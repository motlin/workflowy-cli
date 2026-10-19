import {useCallback, useEffect, useRef, useState} from "react";
import type {ReactNode} from "react";
import {placeCaretAtTextOffset, unitsBefore} from "../caret-dom.js";
import {SlashMenu} from "../components/slash-menu.js";
import type {CommandContext} from "../keys/dispatch.js";
import {LOCAL_SLASH_AVAILABLE, resolveSlash} from "../slash-commands.js";
import type {SlashCommandKey, SlashCommandOption, SlashGroup, SlashMathOption} from "../slash-commands.js";
import {slashKeyAction, slashMode} from "../slash-menu-state.js";
import {planSlashOpen, planSlashRearm, SLASH_CHIP_CLASS} from "../slash-trigger.js";
import type {SlashRange} from "../slash-trigger.js";
import {useOutlineStore} from "../stores/outline.js";
import {activeCommandRegistry} from "./use-global-keymap.js";

interface SlashOpen {
	groups: SlashGroup[];
	index: number;
	keyboardMode: boolean;
	/** The chip's bottom-left in document coordinates. */
	left: number;
	top: number;
}

interface SlashMenuOptions {
	editorRef: React.RefObject<HTMLElement | null>;
	/** The row the editor belongs to: the command's item. */
	nodeId: string;
	/** The editor's text changed outside a native input (the chip was unwrapped or replaced by a math result). */
	onChange: () => void;
	/** Save the editor's text now, before a command runs. */
	onSave: () => void;
}

type SlashOption = SlashCommandOption | SlashMathOption;

function flatOptions(groups: readonly SlashGroup[]): SlashOption[] {
	return groups.flatMap((group): SlashOption[] => group.options);
}

/** A slash command is offered when it has a local executor and the active registry can run it on this row. */
function commandContext(nodeId: string): CommandContext {
	return {items: [nodeId], zoomedId: useOutlineStore.getState().zoomedNodeId};
}

function resolve(chipText: string, nodeId: string): SlashGroup[] | null {
	if (!chipText.trimStart().startsWith("/")) {
		return null;
	}
	const registry = activeCommandRegistry();
	const ctx = commandContext(nodeId);
	const groups = resolveSlash(chipText, {
		available: (key) => {
			const command = registry[key];
			return LOCAL_SLASH_AVAILABLE(key) && command !== undefined && command.available?.(ctx) !== false;
		},
	});
	return groups !== null && flatOptions(groups).length > 0 ? groups : null;
}

/** The selection's collapsed caret inside `editor` when it sits in a text node there. */
function caretTextNode(editor: HTMLElement): {node: Text; offset: number} | null {
	const selection = globalThis.getSelection();
	if (selection === null || !selection.isCollapsed || selection.rangeCount === 0) {
		return null;
	}
	const {focusNode, focusOffset} = selection;
	if (!(focusNode instanceof Text) || !editor.contains(focusNode)) {
		return null;
	}
	return {node: focusNode, offset: focusOffset};
}

/** Wraps `range` of `node` in the slash chip and puts the caret at the end of the chip's text node. */
function wrapChip(node: Text, range: SlashRange): HTMLSpanElement {
	const chipText = node.splitText(range.start);
	chipText.splitText(range.end - range.start);
	const chip = document.createElement("span");
	chip.className = SLASH_CHIP_CLASS;
	chipText.replaceWith(chip);
	chip.append(chipText);
	const caret = document.createRange();
	caret.setStart(chipText, chipText.length);
	caret.collapse(true);
	const selection = globalThis.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(caret);
	return chip;
}

function chipAnchor(chip: HTMLElement): {left: number; top: number} {
	const rect = chip.getBoundingClientRect();
	return {left: rect.left + globalThis.scrollX, top: rect.bottom + globalThis.scrollY};
}

/**
 * Upstream's slash input (`qU4` + `WF.Suggest`): typing a first or standalone `/` wraps it in the
 * `slash-input` chip and opens the command menu under it; every input re-resolves the chip, and a
 * deleting input re-arms a nearby `/`. Call `handleKeyDown` first in the editor's keydown handler:
 * it returns true when the menu took the key. While the menu is open the editor must not schedule
 * saves (`isOpen`), and every save must `stripSlashChip` the editor's HTML.
 */
export function useSlashMenu({editorRef, nodeId, onChange, onSave}: SlashMenuOptions): {
	handleInput: (event?: Event) => void;
	handleKeyDown: (event: React.KeyboardEvent) => boolean;
	isOpen: () => boolean;
	detach: () => void;
	menu: ReactNode;
} {
	const [open, setOpenState] = useState<SlashOpen | null>(null);
	const openRef = useRef<SlashOpen | null>(null);
	const chipRef = useRef<HTMLSpanElement | null>(null);
	const setOpen = useCallback((next: SlashOpen | null) => {
		openRef.current = next;
		setOpenState(next);
	}, []);

	/**
	 * Replace the chip with `text` (its own text when omitted) as a plain text node and close the menu.
	 * The caret goes to the end of the replacement when `caretAtEnd`, else stays where it was when it
	 * was in the editor. Returns the replacement's start offset in the editor's text.
	 */
	const disarm = useCallback(
		({text, caretAtEnd}: {text?: string; caretAtEnd: boolean}): number | null => {
			const chip = chipRef.current;
			const editor = editorRef.current;
			chipRef.current = null;
			if (openRef.current !== null) {
				setOpen(null);
			}
			if (chip === null || editor === null || !chip.isConnected) {
				return null;
			}
			const start = unitsBefore(editor, chip, 0);
			const replacement = text ?? chip.textContent;
			const selection = globalThis.getSelection();
			const caretInEditor =
				selection !== null && selection.rangeCount > 0 && editor.contains(selection.focusNode);
			const caret =
				caretInEditor && selection.focusNode !== null
					? unitsBefore(editor, selection.focusNode, selection.focusOffset)
					: null;
			chip.replaceWith(document.createTextNode(replacement));
			editor.normalize();
			if (caretAtEnd) {
				placeCaretAtTextOffset(editor, start + replacement.length);
			} else if (caret !== null) {
				placeCaretAtTextOffset(editor, Math.min(caret, start + replacement.length));
			}
			return start;
		},
		[editorRef, setOpen],
	);

	const detach = useCallback(() => {
		if (chipRef.current !== null || openRef.current !== null) {
			disarm({caretAtEnd: false});
			onChange();
		}
	}, [disarm, onChange]);

	const arm = useCallback(
		(node: Text, range: SlashRange): boolean => {
			const groups = resolve(node.data.slice(range.start, range.end), nodeId);
			if (groups === null) {
				return false;
			}
			const chip = wrapChip(node, range);
			chipRef.current = chip;
			setOpen({groups, index: 0, keyboardMode: true, ...chipAnchor(chip)});
			return true;
		},
		[nodeId, setOpen],
	);

	const handleInput = useCallback(
		(event?: Event) => {
			const editor = editorRef.current;
			if (editor === null) {
				return;
			}
			const chip = chipRef.current;
			if (chip !== null) {
				const groups = chip.isConnected ? resolve(chip.textContent, nodeId) : null;
				if (groups === null) {
					disarm({caretAtEnd: false});
					return;
				}
				setOpen({groups, index: 0, keyboardMode: true, ...chipAnchor(chip)});
				return;
			}
			const inputType = event instanceof InputEvent ? event.inputType : "";
			const caret = caretTextNode(editor);
			if (caret === null) {
				return;
			}
			if (inputType.startsWith("insert") && caret.node.data[caret.offset - 1] === "/") {
				const range = planSlashOpen(caret.node.data, caret.offset - 1);
				if (range !== null) {
					arm(caret.node, range);
				}
			} else if (inputType.startsWith("delete")) {
				const range = planSlashRearm(caret.node.data, caret.offset);
				if (range !== null) {
					arm(caret.node, range);
				}
			}
		},
		[arm, disarm, editorRef, nodeId, setOpen],
	);

	const run = useCallback(
		(index: number) => {
			const current = openRef.current;
			const chip = chipRef.current;
			const option = current === null ? undefined : flatOptions(current.groups)[index];
			if (option === undefined || chip === null) {
				return;
			}
			if (!("key" in option)) {
				if (option.noop !== true) {
					disarm({text: option.label, caretAtEnd: true});
					onChange();
				}
				return;
			}
			const anchorRect = chip.getBoundingClientRect();
			disarm({text: "", caretAtEnd: true});
			onSave();
			const key: SlashCommandKey = option.key;
			const ctx: CommandContext = {...commandContext(nodeId), anchorRect};
			globalThis.requestAnimationFrame(() => {
				const command = activeCommandRegistry()[key];
				if (command !== undefined && command.available?.(ctx) !== false) {
					command.execute(ctx);
				}
			});
		},
		[disarm, nodeId, onChange, onSave],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent): boolean => {
			const current = openRef.current;
			const chip = chipRef.current;
			if (current === null || chip === null || event.nativeEvent.isComposing) {
				return false;
			}
			const caret = editorRef.current === null ? null : caretTextNode(editorRef.current);
			const action = slashKeyAction({
				key: event.key,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				caretAtChipEnd: caret !== null && chip.contains(caret.node) && caret.offset === caret.node.length,
			});
			if (action === null) {
				return false;
			}
			if (action === "disarmNoAbandon") {
				disarm({caretAtEnd: false});
				return false;
			}
			event.preventDefault();
			event.stopPropagation();
			const count = flatOptions(current.groups).length;
			switch (action) {
				case "down":
				case "up": {
					const step = action === "down" ? 1 : -1;
					setOpen({...current, index: (current.index + step + count) % count, keyboardMode: true});
					break;
				}
				case "select": {
					run(current.index);
					break;
				}
				case "abandon": {
					disarm({caretAtEnd: true});
					onChange();
					break;
				}
			}
			return true;
		},
		[disarm, editorRef, onChange, run, setOpen],
	);

	// The caret leaving the chip (a click elsewhere, ArrowLeft past it) disarms and keeps the text.
	useEffect(() => {
		if (open === null) {
			// oxlint-disable-next-line unicorn/no-useless-undefined -- consistent-return needs a value beside the cleanup return
			return undefined;
		}
		const onSelectionChange = () => {
			const chip = chipRef.current;
			const focus = globalThis.getSelection()?.focusNode ?? null;
			if (chip !== null && (focus === null || !chip.contains(focus))) {
				detach();
			}
		};
		document.addEventListener("selectionchange", onSelectionChange);
		return () => {
			document.removeEventListener("selectionchange", onSelectionChange);
		};
	}, [open, detach]);

	// Navigating to another location disarms.
	useEffect(
		() =>
			useOutlineStore.subscribe((state, previous) => {
				if (state.zoomedNodeId !== previous.zoomedNodeId) {
					detach();
				}
			}),
		[detach],
	);

	const isOpen = useCallback(() => chipRef.current !== null, []);

	const hover = useCallback(
		(index: number) => {
			const current = openRef.current;
			if (current !== null) {
				const mode = slashMode(
					{index: current.index, hidden: false, keyboardMode: current.keyboardMode},
					{type: "hover", index},
				);
				setOpen({...current, index: mode.index, keyboardMode: mode.keyboardMode});
			}
		},
		[setOpen],
	);
	const mouseMove = useCallback(() => {
		const current = openRef.current;
		if (current?.keyboardMode === true) {
			setOpen({...current, keyboardMode: false});
		}
	}, [setOpen]);

	const menu =
		open === null ? null : (
			<SlashMenu
				groups={open.groups}
				index={open.index}
				keyboardMode={open.keyboardMode}
				left={open.left}
				top={open.top}
				onSelect={run}
				onHover={hover}
				onMouseMove={mouseMove}
			/>
		);

	return {handleInput, handleKeyDown, isOpen, detach, menu};
}
