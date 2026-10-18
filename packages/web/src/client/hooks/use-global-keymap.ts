import {useEffect, useRef} from "react";
import {isMacPlatform} from "../editable-text-keys.js";
import {deferToFocusedControl, keymapCombo, processCombo} from "../keys/dispatch.js";
import type {CommandContext, CommandRegistry} from "../keys/dispatch.js";
import {useOutlineStore} from "../stores/outline.js";

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

/**
 * Upstream's bubble-phase `window` keydown dispatcher: one listener turns each keydown into a combo and runs the
 * bound command from `registry`, claiming every bound combo but the passthroughs.
 */
export function useGlobalKeymap(registry: CommandRegistry): void {
	const registryRef = useRef(registry);
	useEffect(() => {
		registryRef.current = registry;
	}, [registry]);

	useEffect(() => {
		const isMac = isMacPlatform();
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.isComposing) {
				return;
			}
			const combo = keymapCombo(event, isMac, isFormField(event.target));
			if (combo === null || deferToFocusedControl(combo, focusedElement())) {
				return;
			}
			const {editingId, zoomedNodeId} = useOutlineStore.getState();
			const ctx: CommandContext = {
				items: editingId !== null && !isFormField(event.target) ? [editingId] : [],
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
	}, []);
}
