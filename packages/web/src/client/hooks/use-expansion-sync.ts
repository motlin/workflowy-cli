/**
 * Expansion state synced with workflowy.com: hydrate `expandedIds` from `GET /api/v1/expansion`
 * on app load, and re-GET it when the tab regains focus so changes made elsewhere show up.
 * The outline store PATCHes each local change itself.
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
let lastFetchAt = Number.NEGATIVE_INFINITY;

/**
 * Adopt the account's expanded ids; on 503 expansion stays in memory for the
 * session. One GET per page load: later calls (StrictMode's second effect) share it.
 */
export async function loadExpansion(now = Date.now()): Promise<void> {
	loading ??= fetchExpansion(now);
	return loading;
}

/**
 * Settles once the page load's expansion GET has been applied (or failed); resolved at once when none started. A view
 * loaded before it would render without the account's expanded levels and fill them in one at a time after.
 */
export async function initialExpansionLoaded(): Promise<void> {
	return loading;
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
	try {
		const response =
			localCount === undefined
				? await fetchThroughRestart("/api/v1/expansion", LOAD_RETRY_DELAYS_MS)
				: await fetch("/api/v1/expansion?fresh=1");
		if (response.status === 503) {
			disableExpansionPersistence();
			return;
		}
		if (!response.ok) {
			console.error(`Failed to load expansion: ${response.status}`);
			return;
		}
		const {expandedIds} = await readJson<{expandedIds: string[]}>(response);
		if (localCount !== undefined && localExpansionChangeState().count !== localCount) {
			return;
		}
		const next = new Set(expandedIds);
		const current = useOutlineStore.getState().expandedIds;
		if (sameIds(current, next)) {
			return;
		}
		useOutlineStore.getState().setExpanded(next);
	} catch (error) {
		console.error("Failed to load expansion", error);
	}
}

/** GET `url`, retrying after each delay while the API server is restarting; the last attempt's outcome is returned. */
async function fetchThroughRestart(url: string, retryDelaysMs: readonly number[]): Promise<Response> {
	for (const delayMs of retryDelaysMs) {
		try {
			// oxlint-disable-next-line no-await-in-loop -- each retry waits on the one before it.
			const response = await fetch(url);
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
	return fetch(url);
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
	return a.size === b.size && [...a].every((id) => b.has(id));
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
		return () => {
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, []);
}
