/**
 * Expansion state synced with workflowy.com: hydrate `expandedIds` from `GET /api/v1/expansion`
 * once on app load. The outline store PATCHes each later change itself.
 */

import {useEffect} from "react";
import {readJson} from "../read-json.js";
import {disableExpansionPersistence, useOutlineStore} from "../stores/outline.js";

/** Adopt the account's expanded ids; on 503 expansion stays in memory for the session. */
export async function loadExpansion(): Promise<void> {
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
		useOutlineStore.getState().setExpanded(new Set(expandedIds));
	} catch (error) {
		console.error("Failed to load expansion", error);
	}
}

export function useExpansionSync(): void {
	useEffect(() => {
		void loadExpansion();
	}, []);
}
