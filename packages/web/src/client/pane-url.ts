import {z} from "zod";
import {locationUrl, parseLocationHash, shortId} from "./location.js";

/** The hash fragment key upstream stores the pane workspace under (`#/<id>?panes=v2.…`). */
export const PANES_FRAGMENT = "panes";
/** Upstream's `localStorage` key for pane widths and the active pane. */
export const PANE_RUNTIME_KEY = "pane-workspace-runtime:v1";

const VERSION_PREFIX = "v2.";
const MAX_LENGTH = 65_536;
const ITEM_TREE = "item-tree";
/** Upstream's item-tree urlState names Home by `WF.Item.root.id`. */
const HOME_ID = "None";
const PANE_ID = /^[A-Za-z0-9_-]{11}$/u;

/** `[[mainId, "item-tree"], [paneId, type, urlState], …]`. */
export type PanesState = [string, string, ...unknown[]][];

export type DecodedPanes = {kind: "absent"} | {kind: "invalid"} | {kind: "valid"; state: PanesState};

/**
 * The side pane as the URL sees it: both pane ids, the pane's zoom (full or short id; null is Home) and its own
 * search query (null or "" for none).
 */
export interface SidePaneUrl {
	mainPaneId: string;
	paneId: string;
	location: string | null;
	query?: string | null;
}

export interface PaneUrlIds {
	mainPaneId: string;
	paneId: string;
}

function toBase64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCodePoint(byte);
	}
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Upstream `$92`: `v2.` + base64url of the UTF-8 JSON; undefined past the 65536-character cap. */
export function encodePanes(state: readonly unknown[]): string | undefined {
	const encoded = VERSION_PREFIX + toBase64url(new TextEncoder().encode(JSON.stringify(state)));
	return encoded.length > MAX_LENGTH ? undefined : encoded;
}

function parsePayload(payload: string): unknown {
	const base64 = payload
		.replaceAll("-", "+")
		.replaceAll("_", "/")
		.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
	const binary = atob(base64);
	const bytes = Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
	return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)) as unknown;
}

/** Upstream `q92`: decode and validate a `panes` fragment value. */
export function decodePanes(value: string | null | undefined): DecodedPanes {
	if (value === null || value === undefined) {
		return {kind: "absent"};
	}
	const payload = value.slice(VERSION_PREFIX.length);
	if (
		value.length > MAX_LENGTH ||
		!value.startsWith(VERSION_PREFIX) ||
		payload === "" ||
		!/^[A-Za-z0-9_-]+$/u.test(payload) ||
		payload.length % 4 === 1
	) {
		return {kind: "invalid"};
	}
	let parsed: unknown;
	try {
		parsed = parsePayload(payload);
	} catch {
		return {kind: "invalid"};
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		return {kind: "invalid"};
	}
	const [main, ...rest] = parsed as unknown[];
	if (!Array.isArray(main) || main.length !== 2) {
		return {kind: "invalid"};
	}
	const [mainId, mainType] = main as unknown[];
	if (typeof mainId !== "string" || !PANE_ID.test(mainId) || mainType !== ITEM_TREE) {
		return {kind: "invalid"};
	}
	const seen = new Set([mainId]);
	const state: PanesState = [[mainId, ITEM_TREE]];
	for (const entry of rest) {
		if (!Array.isArray(entry) || entry.length !== 3) {
			return {kind: "invalid"};
		}
		const [id, type, urlState] = entry as unknown[];
		if (typeof id !== "string" || !PANE_ID.test(id) || seen.has(id) || typeof type !== "string" || type === "") {
			return {kind: "invalid"};
		}
		seen.add(id);
		state.push([id, type, urlState]);
	}
	return {kind: "valid", state};
}

function paneQuery(query: string | null | undefined): string | null {
	return query === undefined || query === "" ? null : query;
}

/** The item-tree pane's `toUrl`: `[shortId]` or `[shortId, searchQuery]`, Home as `None`. */
export function encodeSidePane({mainPaneId, paneId, location, query}: SidePaneUrl): string | undefined {
	const zoom = location === null ? HOME_ID : shortId(location);
	const search = paneQuery(query);
	return encodePanes([
		[mainPaneId, ITEM_TREE],
		[paneId, ITEM_TREE, search === null ? [zoom] : [zoom, search]],
	]);
}

/** The first extra item-tree pane named by a `panes` value (its `fromUrl`); null when absent or malformed. */
export function decodeSidePane(value: string | null | undefined): (SidePaneUrl & {query: string | null}) | null {
	const decoded = decodePanes(value);
	if (decoded.kind !== "valid") {
		return null;
	}
	const [main, pane] = decoded.state;
	if (main === undefined || pane === undefined || pane[1] !== ITEM_TREE) {
		return null;
	}
	const urlState: unknown = pane[2];
	if (!Array.isArray(urlState)) {
		return null;
	}
	const [id, query = null] = urlState as unknown[];
	if (typeof id !== "string" || id === "" || (query !== null && typeof query !== "string")) {
		return null;
	}
	return {mainPaneId: main[0], paneId: pane[0], location: id === HOME_ID ? null : id, query};
}

/** The side pane as the URL should name it, from the store's pane and its URL ids; null with no side pane. */
export function storeSidePaneUrl(
	sidePane: {zoomedId: string | null; query: string} | null,
	ids: PaneUrlIds | null,
): SidePaneUrl | null {
	return sidePane === null || ids === null
		? null
		: {...ids, location: sidePane.zoomedId, query: paneQuery(sidePane.query)};
}

/**
 * The `panes` fragment naming the store's side pane, empty with none. A main-pane navigation carries it so the pane
 * sync never has to replace the pushed URL a frame later.
 */
export function sidePaneFragments(
	sidePane: {zoomedId: string | null; query: string} | null,
	ids: PaneUrlIds | null,
): Record<string, string> {
	const store = storeSidePaneUrl(sidePane, ids);
	const value = store === null ? undefined : encodeSidePane(store);
	return value === undefined ? {} : {[PANES_FRAGMENT]: value};
}

/** The URL for `hash` with its `panes` param set to `value`, or dropped for null. */
export function withPanesFragment(hash: string, value: string | null): string {
	const {id, query, fragments} = parseLocationHash(hash);
	const {[PANES_FRAGMENT]: _dropped, ...rest} = fragments;
	return locationUrl({id, query, fragments: value === null ? rest : {...rest, [PANES_FRAGMENT]: value}});
}

function shortZoom(location: string | null): string | null {
	return location === null ? null : shortId(location);
}

/** Upstream's item-tree `equals`: same pane ids, the same zoom by short id and the same search query. */
export function sameSidePane(a: SidePaneUrl | null, b: SidePaneUrl | null): boolean {
	if (a === null || b === null) {
		return a === b;
	}
	return (
		a.mainPaneId === b.mainPaneId &&
		a.paneId === b.paneId &&
		shortZoom(a.location) === shortZoom(b.location) &&
		paneQuery(a.query) === paneQuery(b.query)
	);
}

export type PaneUrlAction = "none" | "apply" | "close" | "restore-url";

/**
 * After a location change: a URL naming a pane wins (reload, Back/Forward, a
 * pasted link). A URL without one closes the pane only on browser Back/Forward;
 * an in-app navigation that dropped the param gets the open pane written back.
 */
export function reconcilePaneUrl({
	url,
	store,
	isPop,
}: {
	url: SidePaneUrl | null;
	store: SidePaneUrl | null;
	isPop: boolean;
}): PaneUrlAction {
	if (sameSidePane(url, store)) {
		return "none";
	}
	if (url !== null) {
		return "apply";
	}
	return isPop ? "close" : "restore-url";
}

/** Upstream `createPaneId`: 8 random bytes as 11 base64url characters. */
export function createPaneId(
	randomBytes: () => Uint8Array = () => globalThis.crypto.getRandomValues(new Uint8Array(8)),
): string {
	return toBase64url(randomBytes());
}

export interface PaneRuntimeState {
	activePaneId: string;
	panes: {id: string; type: string; widthPercent: number}[];
}

/** The `pane-workspace-runtime:v1` record; the local side pane always splits the width in half. */
export function paneRuntimeState({mainPaneId, paneId}: PaneUrlIds, sideActive: boolean): PaneRuntimeState {
	return {
		activePaneId: sideActive ? paneId : mainPaneId,
		panes: [
			{id: mainPaneId, type: ITEM_TREE, widthPercent: 50},
			{id: paneId, type: ITEM_TREE, widthPercent: 50},
		],
	};
}

const runtimeStateSchema = z.object({activePaneId: z.string(), panes: z.array(z.object({id: z.string()}))});

/** Upstream `restoreRuntimeState`: the stored active pane counts only when the record names the URL's panes. */
export function restoredActivePane(stored: string | null, {mainPaneId, paneId}: PaneUrlIds): boolean {
	try {
		const parsed = runtimeStateSchema.safeParse(JSON.parse(stored ?? "null"));
		if (!parsed.success) {
			return false;
		}
		const ids = new Set(parsed.data.panes.map((pane) => pane.id));
		return ids.has(mainPaneId) && ids.has(paneId) && parsed.data.activePaneId === paneId;
	} catch {
		return false;
	}
}
