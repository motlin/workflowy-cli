import {parseQuery} from "@workflowy/shared/search";
import type {SearchItem} from "@workflowy/shared/search";

/** A live node as loaded for tree search. Timestamps are epoch milliseconds. */
export interface TreeSearchRow {
	id: string;
	parentId: string | null;
	priority: number | null;
	name: string | null;
	note: string | null;
	createdAt: number | null;
	modifiedAt: number | null;
	completedAt: number | null;
	layoutMode: string | null;
	isMirror: boolean;
}

export interface TreeSearchResult {
	matchIds: string[];
	nameMatchIds: string[];
	noteMatchIds: string[];
	/** Operator-only matches: matched without a name or note text match. */
	metaMatchIds: string[];
	/** Nodes (excluding the root) with at least one matching descendant. */
	ancestorIds: string[];
	/** Ancestors with at least one child that neither matches nor has matching descendants. */
	halfExpandedIds: string[];
	rootHalfExpanded: boolean;
	/** Matches that are completed or sit under a completed ancestor. */
	completedMatchCount: number;
	matchCount: number;
	revealsCompleted: boolean;
}

interface Visit {
	id: string;
	childIds: string[];
	matches: boolean;
	nameMatches: boolean;
	noteMatches: boolean;
	metaMatches: boolean;
	completed: boolean;
}

function emptyResult(revealsCompleted: boolean): TreeSearchResult {
	return {
		matchIds: [],
		nameMatchIds: [],
		noteMatchIds: [],
		metaMatchIds: [],
		ancestorIds: [],
		halfExpandedIds: [],
		rootHalfExpanded: false,
		completedMatchCount: 0,
		matchCount: 0,
		revealsCompleted,
	};
}

function childrenByParent(rows: TreeSearchRow[]): Map<string | null, TreeSearchRow[]> {
	const children = new Map<string | null, TreeSearchRow[]>();
	for (const row of rows) {
		const siblings = children.get(row.parentId);
		if (siblings) {
			siblings.push(row);
		} else {
			children.set(row.parentId, [row]);
		}
	}
	for (const siblings of children.values()) {
		siblings.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
	}
	return children;
}

/**
 * Port of upstream's in-place search: matches every descendant of `rootId` (the whole tree when null) against the
 * query AST, never the root itself, and reports ids in document order (parent, then children by priority).
 */
export function computeTreeSearch(
	rows: TreeSearchRow[],
	rootId: string | null,
	query: string,
	now: number,
): TreeSearchResult {
	const parsed = parseQuery(query, {now});
	if (parsed.isEmpty()) {
		return emptyResult(false);
	}

	const children = childrenByParent(rows);
	const rootCompleted = rootId !== null && rows.some((row) => row.id === rootId && row.completedAt !== null);
	const visits: Visit[] = [];

	const walk = (parentId: string | null, ancestorCompleted: boolean): void => {
		for (const row of children.get(parentId) ?? []) {
			const item: SearchItem = {
				id: row.id,
				nameHtml: row.name ?? "",
				noteHtml: row.note ?? "",
				completedAt: row.completedAt,
				createdAt: row.createdAt,
				modifiedAt: row.modifiedAt,
				layoutMode: row.layoutMode,
				childCount: children.get(row.id)?.length ?? 0,
				isMirror: row.isMirror,
				ancestorCompleted,
			};
			const match = parsed.matches(item);
			const completed = ancestorCompleted || row.completedAt !== null;
			visits.push({
				id: row.id,
				childIds: (children.get(row.id) ?? []).map((child) => child.id),
				...match,
				completed,
			});
			walk(row.id, completed);
		}
	};
	walk(rootId, rootCompleted);

	// Children follow their parent in `visits`, so a reverse pass sees every child before its parent.
	const hasDescendantMatch = new Set<string>();
	const visible = new Set<string>();
	for (const visit of visits.toReversed()) {
		if (visit.childIds.some((id) => visible.has(id))) {
			hasDescendantMatch.add(visit.id);
		}
		if (visit.matches || hasDescendantMatch.has(visit.id)) {
			visible.add(visit.id);
		}
	}
	const isHalfExpanded = (childIds: string[]): boolean =>
		childIds.some((id) => visible.has(id)) && childIds.some((id) => !visible.has(id));

	const result = emptyResult(parsed.revealsCompleted());
	for (const visit of visits) {
		if (visit.matches) {
			result.matchIds.push(visit.id);
			result.matchCount += 1;
			if (visit.completed) {
				result.completedMatchCount += 1;
			}
			if (visit.nameMatches) {
				result.nameMatchIds.push(visit.id);
			}
			if (visit.noteMatches) {
				result.noteMatchIds.push(visit.id);
			}
			if (visit.metaMatches && !visit.nameMatches && !visit.noteMatches) {
				result.metaMatchIds.push(visit.id);
			}
		}
		if (hasDescendantMatch.has(visit.id)) {
			result.ancestorIds.push(visit.id);
			if (isHalfExpanded(visit.childIds)) {
				result.halfExpandedIds.push(visit.id);
			}
		}
	}
	result.rootHalfExpanded = isHalfExpanded((children.get(rootId) ?? []).map((child) => child.id));
	return result;
}
