import {useEffect, useRef} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useStableNavigate} from "./use-stable-navigate.js";
import {isMacPlatform} from "../editable-text-keys.js";
import {
	deferToFocusedControl,
	keymapCombo,
	processAppMessageCombo,
	processCombo,
	processSelectionKey,
} from "../keys/dispatch.js";
import {comboFromEvent} from "../keys/keymap.js";
import type {CommandContext, CommandRegistry} from "../keys/dispatch.js";
import {commandTargets} from "../item-selection.js";
import {activeZoomedId, useOutlineStore} from "../stores/outline.js";
import {useDeleteNode} from "./use-nodes.js";
import {currentSelectionView, isTextTarget, runSelectionKey} from "./use-selection-keymap.js";

/** Whether keys typed into `target` belong to a form field rather than the outline. */
function isFormField(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

function focusedElement(): HTMLElement | null {
	return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

let activeRegistry: CommandRegistry = {};

/** The registry the global keymap dispatches to, for editors that run a command by id (the slash menu). */
export function activeCommandRegistry(): CommandRegistry {
	return activeRegistry;
}

/**
 * Upstream's bubble-phase `window` keydown dispatcher: one listener turns each keydown into a combo and runs the
 * bound command from `registry`, claiming every bound combo but the passthroughs. Item commands act on the item
 * selection in display order when there is one, else on the edited row. The phases run in a fixed order: a shown app
 * message's action shortcuts first (upstream's capture-phase toast listener), then the item selection's own keys
 * while items are selected (upstream's capture-phase Backspace/Delete and selection hotkeys), then the hotkey table.
 */
export function useGlobalKeymap(registry: CommandRegistry): void {
	const queryClient = useQueryClient();
	const navigate = useStableNavigate();
	const {mutate: deleteNode} = useDeleteNode();
	const registryRef = useRef(registry);
	useEffect(() => {
		registryRef.current = registry;
		activeRegistry = registry;
	}, [registry]);

	useEffect(() => {
		const isMac = isMacPlatform();
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.isComposing) {
				return;
			}
			const {appMessage} = useOutlineStore.getState();
			if (appMessage && processAppMessageCombo(comboFromEvent(event), appMessage.actions) === "claimed") {
				event.preventDefault();
				return;
			}
			const selectionResult = processSelectionKey(
				event,
				isMac,
				{
					hasSelection: useOutlineStore.getState().itemSelection.entries.length > 0,
					inText: isTextTarget(event.target),
				},
				(action) => {
					runSelectionKey(action, queryClient, deleteNode, navigate);
				},
			);
			if (selectionResult === "claimed") {
				event.preventDefault();
				return;
			}
			const combo = keymapCombo(event, isMac, isFormField(event.target));
			if (combo === null || deferToFocusedControl(combo, focusedElement())) {
				return;
			}
			const state = useOutlineStore.getState();
			const {editingId, itemSelection} = state;
			const ctx: CommandContext = {
				items: isFormField(event.target)
					? []
					: commandTargets(itemSelection, () => currentSelectionView(queryClient).tree, editingId),
				zoomedId: activeZoomedId(state),
			};
			if (processCombo(combo, registryRef.current, ctx, isMac) === "claimed") {
				event.preventDefault();
			}
		};
		globalThis.addEventListener("keydown", onKeyDown);
		return () => {
			globalThis.removeEventListener("keydown", onKeyDown);
		};
	}, [queryClient, deleteNode, navigate]);
}
