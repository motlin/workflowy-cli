import {isShortId} from "@workflowy/shared/workflowy";
import {useEffect} from "react";
import {NavigationType, useLocation, useNavigate, useNavigationType} from "react-router-dom";
import {locationUrl, shortId} from "./location.js";
import {locFromHash} from "./nav-stack.js";
import {useOutlineStore} from "./stores/outline.js";

type NavigateFn = (to: string) => unknown;

/**
 * The client URL for a node view: upstream's `/#/<last 12 chars of uuid>`.
 *
 * The hash router resolves the short id back to the full uuid before zooming, so
 * `zoomedNodeId` always holds a full id. Every node link must go through this
 * helper so the form stays consistent.
 */
export function nodeUrl(nodeId: string): string {
	return locationUrl({id: nodeId});
}

/**
 * Resolve a location id to a zoom target: `"home"` for no id, a full uuid as is,
 * and a 12-hex short id through `lookup` (null when it is unknown).
 */
export function resolveZoomTarget(param: string | null, lookup: (id: string) => string | null) {
	if (param === null) {
		return "home";
	}
	return isShortId(param) ? lookup(param) : param;
}

export type ZoomFocus = "first_child" | "last_selected";

export interface ZoomFocusInput {
	zoomedId: string | null;
	/** `first_child`: the node to zoom into (null for home). Unused by `last_selected`. */
	targetId: string | null;
	/** The target's first potentially visible child. */
	firstChildId: string | null;
	parentOfZoomed: string | null;
	/** The row edited before the zoom, and its caret offset. */
	previousEditingId: string | null;
	previousOffset: number;
}

export interface ZoomFocusPlan {
	route: string;
	/** The row to edit after navigating, or null to stop editing. */
	editId: string | null;
	offset: number;
	/** Scroll the outline to the top. */
	scrollTop: boolean;
}

/**
 * Upstream `zoomTo(target, focus)`. `first_child` (bullet click, zoom_in) zooms into the target and edits its first
 * visible child, or its title when it has none (nothing at home), keeping the old caret offset when that row already
 * had focus, then scrolls to the top. `last_selected` (zoom_out) zooms to the parent and edits the node zoomed out of
 * at offset 0. Null when there is nothing to do: the target is already zoomed, or zooming out at the root.
 */
export function planZoomFocus(
	focus: ZoomFocus,
	{zoomedId, targetId, firstChildId, parentOfZoomed, previousEditingId, previousOffset}: ZoomFocusInput,
): ZoomFocusPlan | null {
	if (focus === "first_child") {
		if (targetId === zoomedId) {
			return null;
		}
		const editId = firstChildId ?? targetId;
		const offset = editId !== null && editId === previousEditingId ? previousOffset : 0;
		return {route: targetId === null ? "/" : nodeUrl(targetId), editId, offset, scrollTop: true};
	}
	if (zoomedId === null) {
		return null;
	}
	return {
		route: parentOfZoomed === null ? "/" : nodeUrl(parentOfZoomed),
		editId: zoomedId,
		offset: 0,
		scrollTop: false,
	};
}

/** Record a move to `nodeId` (null for home) on the in-app stacks, then push its URL. */
export function goToNode(navigate: NavigateFn, nodeId: string | null): void {
	useOutlineStore
		.getState()
		.dispatchNav({type: "navigate", loc: {id: nodeId === null ? null : shortId(nodeId), query: null}});
	void navigate(nodeId === null ? "/" : nodeUrl(nodeId));
}

/**
 * Commit a search: push the zoomed node's URL with `?q=<query>` through the same
 * navigate path as a node move (an empty query clears it). A new query on the same
 * node is a distinct location, so it is never deduped.
 */
export function navigateToSearch(navigate: NavigateFn, query: string): void {
	const {zoomedNodeId, dispatchNav} = useOutlineStore.getState();
	const q = query === "" ? null : query;
	dispatchNav({type: "navigate", loc: {id: zoomedNodeId === null ? null : shortId(zoomedNodeId), query: q}});
	void navigate(locationUrl({id: zoomedNodeId, query: q}));
}

/**
 * Upstream's Back/Forward: step the in-app stacks and push a new browser entry
 * for the target (never `history.back()`); a no-op when that stack is empty.
 */
export function stepNav(navigate: NavigateFn, direction: "back" | "forward"): void {
	const {nav, dispatchNav} = useOutlineStore.getState();
	if ((direction === "back" ? nav.back : nav.forward).length === 0) {
		return;
	}
	dispatchNav({type: direction});
	const {current} = useOutlineStore.getState().nav;
	if (current !== null) {
		void navigate(locationUrl(current));
	}
}

/**
 * Fold a router location change into the stacks: browser Back/Forward (`isPop`)
 * sets the current location only; anything else (a link click) is a navigation,
 * deduped against the URL the app itself just pushed.
 */
export function syncNavLocation(hash: string, isPop: boolean): void {
	const loc = locFromHash(hash);
	useOutlineStore.getState().dispatchNav(isPop ? {type: "popstate", loc} : {type: "navigate", loc});
}

/** Keep the in-app stacks in step with the outline route's URL. Mount once (the top bar owns it). */
export function useNavStackSync(): void {
	const location = useLocation();
	const navigationType = useNavigationType();

	useEffect(() => {
		if (location.pathname === "/") {
			syncNavLocation(location.hash, navigationType === NavigationType.Pop);
		}
	}, [location, navigationType]);
}

export function useNodeNavigation() {
	const navigate = useNavigate();

	return {
		navigateToNode: (nodeId: string | null) => {
			goToNode(navigate, nodeId);
		},
		navigateToRoot: () => {
			goToNode(navigate, null);
		},
		navigateToSearch: (query: string) => {
			navigateToSearch(navigate, query);
		},
	};
}
