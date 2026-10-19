import type {NodeResponse} from "../node-types.js";
import type {TreeSearchResult} from "../server/tree-search.js";

/** A committed search applied to the outline in place: the server's result plus the per-search client state. */
export interface SearchFilter {
	result: TreeSearchResult;
	/** Items created while searching stay visible though they do not match. */
	createdIds: ReadonlySet<string>;
	/** Per-item expansion overrides while searching: false collapses, true shows every child. */
	expansion: ReadonlyMap<string, boolean>;
}

/** Upstream's expansion during a search: an override wins, else matching-descendant ancestors are open. */
export function isSearchExpanded(id: string, search: SearchFilter): boolean {
	return search.expansion.get(id) ?? search.result.ancestorIds.includes(id);
}

/**
 * Whether `node` is rendered during the search: it matches, has matching descendants, was created during the
 * search, or its parent was fully expanded by an arrow click.
 */
export function searchShowsNode(node: NodeResponse, search: SearchFilter): boolean {
	return (
		search.result.matchIds.includes(node.id) ||
		search.result.ancestorIds.includes(node.id) ||
		search.createdIds.has(node.id) ||
		(node.parent_id !== null && search.expansion.get(node.parent_id) === true)
	);
}

/** Completed matches stay hidden while completed rows are hidden, unless the query asks for them (is:complete). */
export function searchShowsCompleted(showCompleted: boolean, search: SearchFilter | null): boolean {
	return showCompleted || search?.result.revealsCompleted === true;
}
