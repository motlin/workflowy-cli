import {useEffect, useRef} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {isMacPlatform} from "../editable-text-keys.js";
import {deferToFocusedControl, keymapCombo, processAppMessageCombo, processCombo} from "../keys/dispatch.js";
import {comboFromEvent} from "../keys/keymap.js";
import type {CommandContext, CommandRegistry} from "../keys/dispatch.js";
import {commandTargets} from "../item-selection.js";
import {useOutlineStore} from "../stores/outline.js";
import {currentSelectionView} from "./use-selection-keymap.js";

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
 * selection in display order when there is one, else on the edited row. A shown app message's action shortcuts
 * take precedence, as upstream's capture-phase toast listener does.
 */
export function useGlobalKeymap(registry: CommandRegistry): void {
	const queryClient = useQueryClient();
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
			const combo = keymapCombo(event, isMac, isFormField(event.target));
			if (combo === null || deferToFocusedControl(combo, focusedElement())) {
				return;
			}
			const {editingId, zoomedNodeId, itemSelection} = useOutlineStore.getState();
			const ctx: CommandContext = {
				items: isFormField(event.target)
					? []
					: commandTargets(itemSelection, () => currentSelectionView(queryClient).tree, editingId),
				zoomedId: zoomedNodeId,
			};
			if (processCombo(combo, registryRef.current, ctx, isMac) === "claimed") {
				event.preventDefault();
			}
		};
		globalThis.addEventListener("keydown", onKeyDown);
		return () => {
			globalThis.removeEventListener("keydown", onKeyDown);
		};
	}, [queryClient]);
}
