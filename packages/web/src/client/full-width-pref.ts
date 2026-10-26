/**
 * Upstream's `full_width_page` account feature. The public API does not expose it, so it lives in this browser;
 * the user's account has it on, so on is the default.
 */
export const FULL_WIDTH_STORAGE_KEY = "workflowy-full-width-page";

export function readFullWidthPref(storage: Pick<Storage, "getItem">): boolean {
	try {
		return storage.getItem(FULL_WIDTH_STORAGE_KEY) !== "false";
	} catch {
		return true;
	}
}

export function writeFullWidthPref(storage: Pick<Storage, "setItem">, fullWidth: boolean): void {
	try {
		storage.setItem(FULL_WIDTH_STORAGE_KEY, String(fullWidth));
	} catch {
		// Storage can be unavailable; the preference stays in memory.
	}
}
