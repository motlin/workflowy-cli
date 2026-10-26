// Reads a node's layout ancestors out of the query cache, for callers outside the React tree (commands, drag, export).
import type {QueryClient} from "@tanstack/react-query";
import {readNode} from "./node-cache.js";
import {activePaneView} from "./stores/outline.js";

export interface CachedAncestorLayouts {
	/** Ancestor layouts, nearest first, up to and including the zoomed item (the render root). */
	layouts: {layoutMode: string | null}[];
	/** The walk stopped at the render root, or the node is the render root itself. */
	reachedRoot: boolean;
}

export function cachedAncestorLayouts(
	queryClient: QueryClient,
	nodeId: string,
	zoomedId: string | null = activePaneView().zoomedNodeId,
): CachedAncestorLayouts {
	const layouts: {layoutMode: string | null}[] = [];
	let reachedRoot = nodeId === zoomedId;
	let current = readNode(queryClient, nodeId);
	while (!reachedRoot && current?.parent_id !== null && current?.parent_id !== undefined) {
		const parent = readNode(queryClient, current.parent_id);
		if (parent === undefined) {
			break;
		}
		layouts.push({layoutMode: parent.data.layoutMode ?? null});
		if (parent.id === zoomedId) {
			reachedRoot = true;
		}
		current = parent;
	}
	return {layouts, reachedRoot};
}
