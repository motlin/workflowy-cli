import {parseLocationHash, shortId} from "./location.js";

/** The part of `window` scroll restoration uses. */
export interface ScrollWindow extends EventTarget {
	readonly scrollY: number;
	scrollTo: (x: number, y: number) => void;
	history: {readonly state: unknown; scrollRestoration: ScrollRestoration};
	readonly location: {readonly href: string; readonly hash: string};
	readonly sessionStorage?: Pick<Storage, "getItem" | "setItem">;
}

/** Where the saved scroll positions survive a reload, as the browser's own restoration does. */
const STORAGE_KEY = "workflowy.scroll-positions";

/** Each history entry's last scroll position, by entry key. */
const positions = new Map<string, number>();

/** The scroll a Back/Forward owes its entry, once the outline shows the entry's location. */
let pending: {key: string; locationId: string | null; scrollY: number} | undefined;

/** A history entry's key: the router's entry key, else (an entry the router did not push) its URL. */
function entryKey(win: ScrollWindow): string {
	const {state} = win.history;
	const key = typeof state === "object" && state !== null && "key" in state ? state.key : undefined;
	return typeof key === "string" ? key : win.location.href;
}

function readSaved(win: ScrollWindow): void {
	try {
		const saved: unknown = JSON.parse(win.sessionStorage?.getItem(STORAGE_KEY) ?? "[]");
		if (Array.isArray(saved)) {
			for (const entry of saved) {
				if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number") {
					positions.set(entry[0], entry[1]);
				}
			}
		}
	} catch {
		// No saved positions: Back after a reload scrolls to the top.
	}
}

function save(win: ScrollWindow): void {
	try {
		win.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify([...positions]));
	} catch {
		// Storage unavailable: positions last until the reload.
	}
}

/**
 * Take over the browser's scroll restoration: it scrolls on `popstate`, while the outline still shows the view being
 * left (a view the cache lacks swaps in only after it loads), so the old rows jump before the new ones arrive. Instead
 * each entry's scroll is saved as it scrolls (and across reloads) and restored by `restorePoppedScroll` in the commit
 * that shows the entry's view. Returns the uninstall.
 */
export function installScrollRestoration(win: ScrollWindow): () => void {
	readSaved(win);
	win.history.scrollRestoration = "manual";
	const onScroll = () => {
		positions.set(entryKey(win), win.scrollY);
	};
	const oweEntryScroll = () => {
		const key = entryKey(win);
		const {id} = parseLocationHash(win.location.hash);
		pending = {key, locationId: id === null ? null : shortId(id), scrollY: positions.get(key) ?? 0};
	};
	// A reload returns to its entry's scroll once the page's first view shows, as the browser's restoration did.
	if (positions.has(entryKey(win))) {
		oweEntryScroll();
	}
	const onPagehide = () => {
		save(win);
	};
	win.addEventListener("scroll", onScroll, {passive: true});
	win.addEventListener("popstate", oweEntryScroll);
	win.addEventListener("pagehide", onPagehide);
	return () => {
		win.removeEventListener("scroll", onScroll);
		win.removeEventListener("popstate", oweEntryScroll);
		win.removeEventListener("pagehide", onPagehide);
		win.history.scrollRestoration = "auto";
		pending = undefined;
	};
}

/** The restore owed to `shownRootId`'s view (null for home), dropping one a navigation away from its entry left. */
function poppedFor(shownRootId: string | null, win: ScrollWindow): typeof pending {
	if (pending !== undefined && pending.key !== entryKey(win)) {
		pending = undefined;
	}
	return pending?.locationId === (shownRootId === null ? null : shortId(shownRootId)) ? pending : undefined;
}

/**
 * The scroll a Back/Forward will restore once `rootId`'s view shows, else 0: the view mounts rows down to it, not just
 * a viewport's worth, so the restored position has rows to land on.
 */
export function poppedScrollY(rootId: string | null, win: ScrollWindow = globalThis.window): number {
	return poppedFor(rootId, win)?.scrollY ?? 0;
}

/**
 * Scroll to the position a Back/Forward entry was left at, when the outline now shows `shownRootId` (null for home)
 * and that is the entry's location; call it in the layout effect of each swap, so the scroll lands in the swap's
 * frame. A navigation away from the popped entry drops its restore.
 */
export function restorePoppedScroll(shownRootId: string | null, win: ScrollWindow = globalThis.window): void {
	const popped = poppedFor(shownRootId, win);
	if (popped !== undefined) {
		pending = undefined;
		win.scrollTo(0, popped.scrollY);
	}
}
