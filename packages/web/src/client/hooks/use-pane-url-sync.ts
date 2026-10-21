import {skipToken, useQuery} from "@tanstack/react-query";
import {useEffect, useRef} from "react";
import {NavigationType, useLocation, useNavigate, useNavigationType} from "react-router-dom";
import {parseLocationHash} from "../location.js";
import {nodeKeys} from "../node-cache.js";
import {SIDE_PANE_ID} from "../pane-ids.js";
import {
	PANE_RUNTIME_KEY,
	PANES_FRAGMENT,
	decodeSidePane,
	encodeSidePane,
	paneRuntimeState,
	reconcilePaneUrl,
	restoredActivePane,
	sameSidePane,
	withPanesFragment,
} from "../pane-url.js";
import type {PaneUrlIds, SidePaneUrl} from "../pane-url.js";
import {useOutlineStore} from "../stores/outline.js";

function storeSidePaneUrl(sidePane: {zoomedId: string | null} | null, ids: PaneUrlIds | null): SidePaneUrl | null {
	return sidePane === null || ids === null ? null : {...ids, location: sidePane.zoomedId};
}

function readRuntimeState(): string | null {
	try {
		return localStorage.getItem(PANE_RUNTIME_KEY);
	} catch {
		return null;
	}
}

/**
 * Keep the side pane and the URL's `panes=v2.` param in step, and mirror the
 * workspace into `pane-workspace-runtime:v1`. A URL naming a pane opens or
 * re-zooms it (reload, Back/Forward); a pane change pushes a new URL; closing
 * the pane drops the param. Mount once (the outline route owns it).
 */
export function usePaneUrlSync(resolveId: (locationId: string) => Promise<string | null>): void {
	const location = useLocation();
	const navigate = useNavigate();
	const isPop = useNavigationType() === NavigationType.Pop;
	const sidePane = useOutlineStore((state) => state.sidePane);
	const paneUrlIds = useOutlineStore((state) => state.paneUrlIds);
	const urlPane = decodeSidePane(parseLocationHash(location.hash).fragments[PANES_FRAGMENT]);
	const paneLocation = urlPane?.location ?? null;
	const resolved = useQuery({
		queryKey: nodeKeys.resolvedId(paneLocation ?? ""),
		queryFn: paneLocation === null ? skipToken : async () => resolveId(paneLocation),
		staleTime: Number.POSITIVE_INFINITY,
	});

	// URL → store: runs on location changes only, so a pane change is never undone before its URL is pushed.
	useEffect(() => {
		const url = decodeSidePane(parseLocationHash(location.hash).fragments[PANES_FRAGMENT]);
		const state = useOutlineStore.getState();
		const store = storeSidePaneUrl(state.sidePane, state.paneUrlIds);
		switch (reconcilePaneUrl({url, store, isPop})) {
			case "apply": {
				if (url === null || (url.location !== null && resolved.data === undefined)) {
					return;
				}
				if (url.location !== null && resolved.data === null) {
					state.closeSidePane();
					void navigate(withPanesFragment(location.hash, null), {replace: true});
					return;
				}
				const ids = {mainPaneId: url.mainPaneId, paneId: url.paneId};
				state.restoreSidePane({
					zoomedId: url.location === null ? null : (resolved.data ?? null),
					ids,
					active: restoredActivePane(readRuntimeState(), ids),
				});
				return;
			}
			case "close": {
				state.closeSidePane();
				return;
			}
			case "restore-url": {
				void navigate(
					withPanesFragment(location.hash, store === null ? null : (encodeSidePane(store) ?? null)),
					{
						replace: true,
					},
				);
				return;
			}
			case "none": {
				return;
			}
		}
	}, [isPop, location.hash, navigate, resolved.data]);

	// Store → URL: a pane opened, zoomed or closed in the app pushes a new history entry.
	const storeFragment = (() => {
		const store = storeSidePaneUrl(sidePane, paneUrlIds);
		return store === null ? null : (encodeSidePane(store) ?? null);
	})();
	const previousFragment = useRef(storeFragment);
	useEffect(() => {
		if (previousFragment.current === storeFragment) {
			return;
		}
		previousFragment.current = storeFragment;
		const {hash} = location;
		const url = decodeSidePane(parseLocationHash(hash).fragments[PANES_FRAGMENT]);
		if (!sameSidePane(url, decodeSidePane(storeFragment))) {
			void navigate(withPanesFragment(hash, storeFragment));
		}
	}, [location, navigate, storeFragment]);

	// Upstream `startRuntimePersistence`: rewrite the record when the panes or the active pane change.
	useEffect(
		() =>
			useOutlineStore.subscribe((state, previous) => {
				if (state.paneUrlIds === previous.paneUrlIds && state.activePaneId === previous.activePaneId) {
					return;
				}
				try {
					if (state.paneUrlIds === null) {
						localStorage.removeItem(PANE_RUNTIME_KEY);
					} else {
						const record = paneRuntimeState(state.paneUrlIds, state.activePaneId === SIDE_PANE_ID);
						localStorage.setItem(PANE_RUNTIME_KEY, JSON.stringify(record));
					}
				} catch {
					// Storage can be unavailable (private windows); the URL still carries the panes.
				}
			}),
		[],
	);
}
