/**
 * Expansion state synced with workflowy.com: hydrate `expandedIds` from `GET /api/v1/expansion`
 * on app load, and re-GET it when the tab regains focus (and every {@link EXPANSION_POLL_MS} while it stays focused)
 * so changes made elsewhere show up. The outline store PATCHes each local change itself.
 *
 * Upstream limits that local cannot fix, so they are not local bugs: each upstream browser keeps a localStorage
 * override for every row it ever toggled, which wins over the server's list on load, and it pushes a toggle as a
 * pending delta only with its next edit (its poll interval is 1 hour otherwise). A local change can therefore look
 * ignored upstream, or be undone minutes later by an upstream browser's stale delta (last writer wins by push time).
 */

import {useEffect} from "react";
import {readJson} from "../read-json.js";
import {
	disableExpansionPersistence,
	isExpansionPersisted,
	localExpansionChangeState,
	useOutlineStore,
} from "../stores/outline.js";

/** Focus refreshes run at most this often, matching the server's expanded-keys freshness window. */
const EXPANSION_REFRESH_INTERVAL_MS = 30_000;

/** A tab that stays visible and focused re-reads the account's expansion this often; unchanged keys cost a 304. */
export const EXPANSION_POLL_MS = 120_000;

/** An expansion GET that has not answered by then is aborted and treated as a failure. */
const EXPANSION_FETCH_TIMEOUT_MS = 30_000;

/**
 * A local change reaches the server's cache only after its debounced push lands, so a GET
 * this soon after one may still hold the old value; skip the refresh rather than revert it.
 */
const LOCAL_CHANGE_GRACE_MS = 5000;

/**
 * The page-load GET waits out an API server restart (the dev proxy's 502/504, or a refused connection) on this backoff,
 * about 23s in all, instead of logging an error and leaving the page without the account's expanded levels.
 */
const LOAD_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 8000];

let loading: Promise<void> | undefined;
let loadSettled = false;
let lastFetchAt = Number.NEGATIVE_INFINITY;
let lastEtag: string | undefined;

/**
 * Adopt the account's expanded ids; on 503 expansion stays in memory for the
 * session. One GET per page load: later calls (StrictMode's second effect) share it.
 */
export async function loadExpansion(now = Date.now()): Promise<void> {
	loading ??= fetchExpansion(now).finally(() => {
		loadSettled = true;
	});
	return loading;
}

/**
 * Whether the page load's expansion GET is still in flight. Its body holds every expanded id in the account (over a
 * megabyte), so a view loaded meanwhile asks the server to expand the account's rows instead of waiting on it.
 */
export function initialExpansionPending(): boolean {
	return loading !== undefined && !loadSettled;
}

/**
 * Expand the rows a view load found expanded in the account, so they render expanded with the first rows; the page
 * load's GET replaces the whole set when it lands. Ignored once that GET has been applied, which already holds them.
 */
export function adoptViewExpansion(ids: readonly string[]): void {
	const current = useOutlineStore.getState().expandedIds;
	if (!initialExpansionPending() || ids.every((id) => current.has(id))) {
		return;
	}
	useOutlineStore.getState().setExpanded(new Set([...current, ...ids]));
}

/**
 * Re-GET the expanded ids (tab focus) and apply the differences without PATCHing them back.
 * Throttled to one GET per {@link EXPANSION_REFRESH_INTERVAL_MS}, counting the initial load; skipped
 * right after a local change, and discarded when a local change lands while the GET is in flight.
 */
export async function refreshExpansion(now = Date.now()): Promise<void> {
	if (!isExpansionPersisted() || now - lastFetchAt < EXPANSION_REFRESH_INTERVAL_MS) {
		return;
	}
	const local = localExpansionChangeState();
	if (now - local.at < LOCAL_CHANGE_GRACE_MS) {
		return;
	}
	await fetchExpansion(now, local.count);
}

/** Page load takes the server's cached keys; a focus refresh (`localCount` set) asks for fresh ones. */
async function fetchExpansion(now: number, localCount?: number): Promise<void> {
	lastFetchAt = now;
	const guard = localCount ?? localExpansionChangeState().count;
	try {
		const response =
			localCount === undefined
				? await fetchThroughRestart("/api/v1/expansion", LOAD_RETRY_DELAYS_MS)
				: await fetchExpansionBody("/api/v1/expansion?fresh=1");
		if (response.status === 503) {
			disableExpansionPersistence();
			return;
		}
		if (response.status === 304) {
			return;
		}
		if (!response.ok) {
			console.error(`Failed to load expansion: ${response.status}`);
			return;
		}
		const body = await readExpansion(response);
		if (localCount !== undefined && localExpansionChangeState().count !== guard) {
			return;
		}
		applyExpandedIds(body.expandedIds);
		if (body.refreshing) {
			await collectRefresh(guard);
		}
	} catch (error) {
		console.error("Failed to load expansion", error);
	}
}

/** The server answered from keys it is still re-reading: wait for that re-read once and apply it. */
async function collectRefresh(guard: number): Promise<void> {
	const response = await fetchExpansionBody("/api/v1/expansion?wait=1");
	if (!response.ok) {
		return;
	}
	const body = await readExpansion(response);
	if (localExpansionChangeState().count !== guard) {
		return;
	}
	applyExpandedIds(body.expandedIds);
}

async function readExpansion(response: Response): Promise<{expandedIds: string[]; refreshing?: boolean}> {
	const etag = response.headers.get("etag");
	if (etag !== null) {
		lastEtag = etag;
	}
	return readJson<{expandedIds: string[]; refreshing?: boolean}>(response);
}

function applyExpandedIds(expandedIds: readonly string[]): void {
	const next = new Set(expandedIds);
	if (!sameIds(useOutlineStore.getState().expandedIds, next)) {
		useOutlineStore.getState().setExpanded(next);
	}
}

/** A conditional GET: sends the last ETag, so an unchanged account answers 304, and aborts after the timeout. */
async function fetchExpansionBody(url: string, conditional = true): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, EXPANSION_FETCH_TIMEOUT_MS);
	try {
		return await fetch(url, {
			signal: controller.signal,
			...(conditional && lastEtag !== undefined ? {headers: {"If-None-Match": lastEtag}} : {}),
		});
	} finally {
		clearTimeout(timer);
	}
}

/** GET `url`, retrying after each delay while the API server is restarting; the last attempt's outcome is returned. */
async function fetchThroughRestart(url: string, retryDelaysMs: readonly number[]): Promise<Response> {
	for (const delayMs of retryDelaysMs) {
		try {
			// oxlint-disable-next-line no-await-in-loop -- each retry waits on the one before it.
			const response = await fetchExpansionBody(url, false);
			if (response.status !== 502 && response.status !== 504) {
				return response;
			}
		} catch {
			// A refused connection: the API server is between processes.
		}
		// oxlint-disable-next-line no-await-in-loop -- the backoff is sequential by design.
		await new Promise((resolve) => {
			setTimeout(resolve, delayMs);
		});
	}
	return fetchExpansionBody(url, false);
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
	return a.size === b.size && [...a].every((id) => b.has(id));
}

/** Every {@link EXPANSION_POLL_MS}, refresh while this tab is visible and focused; returns the stop function. */
export function startExpansionPolling(): () => void {
	const timer = setInterval(() => {
		if (document.visibilityState === "visible" && document.hasFocus()) {
			void refreshExpansion();
		}
	}, EXPANSION_POLL_MS);
	return () => {
		clearInterval(timer);
	};
}

export function useExpansionSync(): void {
	useEffect(() => {
		void loadExpansion();
		const refresh = () => {
			if (document.visibilityState === "visible") {
				void refreshExpansion();
			}
		};
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", refresh);
		const stopPolling = startExpansionPolling();
		return () => {
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refresh);
			stopPolling();
		};
	}, []);
}
