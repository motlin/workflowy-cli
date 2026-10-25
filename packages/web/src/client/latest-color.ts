import {useSyncExternalStore} from "react";
import type {ColorName} from "../color-palette.js";
import {isColorName} from "../color-palette.js";
import {toggleColor} from "./rich-text.js";
import type {ColorChoice, ColorKind} from "./rich-text.js";

/**
 * Upstream's `latestColor` (`WF.CoreKv`): the color the toolbar's font button and Shift+Cmd+H reapply. The
 * public API does not expose the account KV, so it is kept per browser.
 */
const STORAGE_KEY = "wf.latestColor";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

let storage: StorageLike | undefined;
let latest: ColorChoice | undefined;
let loaded = false;
let toggleOff = false;
const listeners = new Set<() => void>();

function backing(): StorageLike | undefined {
	if (storage !== undefined) {
		return storage;
	}
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
}

function isKind(value: unknown): value is ColorKind {
	return value === "text" || value === "highlight";
}

function load(): void {
	if (loaded) {
		return;
	}
	loaded = true;
	try {
		const raw = backing()?.getItem(STORAGE_KEY);
		const parsed: unknown = raw === null || raw === undefined ? undefined : JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && "kind" in parsed && "color" in parsed) {
			const {kind, color} = parsed;
			if (isKind(kind) && isColorName(color)) {
				latest = {kind, color};
			}
		}
	} catch {
		latest = undefined;
	}
}

function emit(): void {
	for (const listener of listeners) {
		listener();
	}
}

/** The latest color, or undefined before any was picked. */
export function get(): ColorChoice | undefined {
	load();
	return latest;
}

/** Upstream's `be.change`: a color becomes the latest; `null` sets a one-shot removal and keeps the latest. */
export function change(kind: ColorKind, color: ColorName | null): void {
	load();
	if (color === null) {
		toggleOff = true;
		return;
	}
	toggleOff = false;
	latest = {kind, color};
	try {
		backing()?.setItem(STORAGE_KEY, JSON.stringify(latest));
	} catch {
		// Storage is only a convenience; the in-memory value still applies.
	}
	emit();
}

/** Upstream's `be.applyToCaret` on stored HTML: toggles the latest color, or clears the range once after a removal. */
export function planApply(html: string, start: number, end: number): string {
	const current = get();
	if (current === undefined) {
		return html;
	}
	const clear = toggleOff;
	toggleOff = false;
	return toggleColor(html, start, end, current.kind, clear ? null : current.color);
}

/** The latest color's class (`c-X` or `bc-X`), or "" before any was picked. */
export function swatchClass(): string {
	const current = get();
	return current === undefined ? "" : `${current.kind === "text" ? "c" : "bc"}-${current.color}`;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** The toolbar font button's color class, kept current as the latest color changes. */
export function useLatestColorClass(): string {
	return useSyncExternalStore(subscribe, swatchClass, () => "");
}

export function resetLatestColorForTests(replacement?: StorageLike): void {
	storage = replacement;
	latest = undefined;
	loaded = false;
	toggleOff = false;
	emit();
}
