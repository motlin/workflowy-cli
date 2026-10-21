import {isShortId} from "@workflowy/shared/workflowy";
import {useQueryClient} from "@tanstack/react-query";
import {useEffect, useRef} from "react";
import {NavigationType, useLocation, useNavigationType} from "react-router-dom";
import {useStableNavigate} from "./hooks/use-stable-navigate.js";
import type {NodeResponse} from "../node-types.js";
import {useDeleteNode} from "./hooks/use-nodes.js";
import {afterNextPaint} from "./after-paint.js";
import {caretTextOffset, editorElement} from "./caret-dom.js";
import {locationUrl, parseLocationHash, shortId} from "./location.js";
import {readChildren, readNode} from "./node-cache.js";
import {locFromHash} from "./nav-stack.js";
import {sidePaneFragments} from "./pane-url.js";
import {useOutlineStore} from "./stores/outline.js";
import type {NavigateFn} from "./stores/outline.js";

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
/**
 * What a bullet click does: a plain left click zooms in-app; a Cmd/Ctrl click or
 * a non-left button is left to the browser so it opens the bullet's href in a new tab.
 */
export function bulletClickAction(event: {metaKey: boolean; ctrlKey: boolean; button: number}): "zoom" | "browser" {
	return event.metaKey || event.ctrlKey || event.button !== 0 ? "browser" : "zoom";
}

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

/**
 * Keep the edited row from focusing inside the frame that swaps the outline: stop editing for the swap, then resume at
 * the same caret after the paint (when nothing else took the edit meanwhile). A row that mounts editing focuses in its
 * commit, which forces a style and layout pass of the whole new view inside that frame; after the paint it is cheap.
 */
function holdEditingAcrossSwap(): void {
	const {editingId, editingCaretOffset, stopEditing} = useOutlineStore.getState();
	if (editingId === null) {
		return;
	}
	const editor = editorElement(editingId);
	const offset = editor === null ? (editingCaretOffset ?? 0) : caretTextOffset(editor);
	stopEditing();
	void (async () => {
		await afterNextPaint();
		const state = useOutlineStore.getState();
		if (state.editingId === null) {
			state.resumeEditing(editingId, offset);
		}
	})();
}

/**
 * Record a move to `nodeId` (null for home) on the in-app stacks, zoom the outline, then push its URL carrying any
 * open side pane. Zooming here rather than after the route resolves the URL's short id swaps the outline in the same
 * frame as the click, and keeping the `panes` param spares the pane sync a second, replacing navigation.
 */
export function goToNode(navigate: NavigateFn, nodeId: string | null): void {
	const {dispatchNav, zoom, sidePane, paneUrlIds} = useOutlineStore.getState();
	dispatchNav({type: "navigate", loc: {id: nodeId === null ? null : shortId(nodeId), query: null}});
	if (nodeId !== useOutlineStore.getState().zoomedNodeId) {
		holdEditingAcrossSwap();
	}
	zoom(nodeId);
	void navigate(locationUrl({id: nodeId, fragments: sidePaneFragments(sidePane, paneUrlIds)}));
}

/**
 * Commit a search: push the zoomed node's URL with `?q=<query>` through the same
 * navigate path as a node move (an empty query clears it). A new query on the same
 * node is a distinct location, so it is never deduped.
 */
export function navigateToSearch(navigate: NavigateFn, query: string): void {
	useOutlineStore.getState().pushSearchLocation(query, navigate);
}

/**
 * Zoom the outline to the node `hash` names when `resolve` finds its full id in the cache (home for no id), so the
 * outline swaps in the same render as the URL change rather than after the hash route resolves it. An id the cache
 * cannot resolve leaves the zoom to the route.
 */
export function zoomToCachedLocation(hash: string, resolve: (locationId: string) => string | undefined): void {
	zoomToCachedId(parseLocationHash(hash).id, resolve);
}

function zoomToCachedId(locationId: string | null, resolve: (locationId: string) => string | undefined): void {
	const target = locationId === null ? null : resolve(locationId);
	if (target !== undefined && target !== useOutlineStore.getState().zoomedNodeId) {
		holdEditingAcrossSwap();
		useOutlineStore.getState().zoom(target);
	}
}

/**
 * Upstream's Back/Forward: step the in-app stacks and push a new browser entry
 * for the target (never `history.back()`); a no-op when that stack is empty.
 * A target `resolve` finds in the cache is zoomed before the push, as `goToNode` does.
 */
export function stepNav(
	navigate: NavigateFn,
	direction: "back" | "forward",
	resolve: (locationId: string) => string | undefined,
): void {
	const {nav: before, dispatchNav} = useOutlineStore.getState();
	if ((direction === "back" ? before.back : before.forward).length === 0) {
		return;
	}
	dispatchNav({type: direction});
	const {nav, sidePane, paneUrlIds} = useOutlineStore.getState();
	if (nav.current !== null) {
		zoomToCachedId(nav.current.id, resolve);
		void navigate(locationUrl({...nav.current, fragments: sidePaneFragments(sidePane, paneUrlIds)}));
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

export interface EmptyDayCleanupDeps {
	getNode: (id: string) => NodeResponse | undefined;
	getChildren: (id: string) => readonly NodeResponse[] | undefined;
	deleteNode: (id: string) => unknown;
}

/**
 * Upstream `ZX4` (`location.change.before`): leaving a 📆 Calendar day page for a
 * node not inside it deletes the day's child when it is the only one and is
 * empty (no name, note or children) and writable, so a visited-and-left day keeps
 * no blank row. A childless lone child means the day's only descendant is that
 * child, so "not inside" is "not the day and not the child".
 */
export function cleanupEmptyDayOnLeave(fromId: string | null, toId: string | null, deps: EmptyDayCleanupDeps): void {
	if (fromId === null || fromId === toId || deps.getNode(fromId)?.calendar?.level !== "day") {
		return;
	}
	const children = deps.getChildren(fromId);
	const child = children?.length === 1 ? children[0] : undefined;
	if (child === undefined) {
		return;
	}
	const empty = (child.name ?? "") === "" && (child.note ?? "") === "" && child.hasChildren !== true;
	if (empty && child.isMirror !== true && child.id !== toId) {
		deps.deleteNode(child.id);
	}
}

/** Run the empty-day cleanup whenever the zoomed node changes. Mount once (the outline route owns it). */
export function useEmptyDayCleanup(): void {
	const queryClient = useQueryClient();
	const {mutate: deleteNode} = useDeleteNode();
	const zoomedNodeId = useOutlineStore((state) => state.zoomedNodeId);
	const previous = useRef(zoomedNodeId);

	useEffect(() => {
		const fromId = previous.current;
		previous.current = zoomedNodeId;
		cleanupEmptyDayOnLeave(fromId, zoomedNodeId, {
			getNode: (id) => readNode(queryClient, id),
			getChildren: (id) => readChildren(queryClient, id),
			deleteNode,
		});
	}, [deleteNode, queryClient, zoomedNodeId]);
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
	const navigate = useStableNavigate();

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
		cancelSearch: () => {
			useOutlineStore.getState().cancelSearch(navigate);
		},
	};
}
