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

async function fetchExpansion(now: number, localCount?: number): Promise<void> {
	lastFetchAt = now;
	try {
		const response = await fetch("/api/v1/expansion");
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
