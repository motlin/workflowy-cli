import type {NodeResponse} from "../node-types.js";
import {isPotentiallyVisible} from "./tree-ops.js";
import type {SearchFilter} from "./search-filter.js";
import {isSearchExpanded, searchShowsCompleted, searchShowsNode} from "./search-filter.js";

/**
 * Row windowing, after upstream `WF.VirtualScrolling.useMaxToRender` / `useScrollableItem`: one row budget for the
 * whole outline, spent depth-first in document order, so a tree with thousands of visible rows (a broad search, a
 * deeply expanded page) mounts, and on Back unmounts, a bounded number of them. Upstream starts at a viewport of
 * minimal-height rows and adds 24 rows per screen scrolled; the local sentinel after the last row adds one step each
 * time it scrolls into view.
 */
const MINIMAL_ROW_HEIGHT = 24;
const ROW_STEP = 24;

/** A viewport of minimal-height rows plus one step of slack below the fold. */
export function initialRowBudget(viewportHeight: number): number {
	return Math.ceil(viewportHeight / MINIMAL_ROW_HEIGHT) + ROW_STEP;
}

export function nextRowBudget(current: number): number {
	return current + ROW_STEP;
}

/** What decides which rows the outline shows: expansion and completion, or the search while one is applied. */
export interface RowView {
	expandedIds: ReadonlySet<string>;
	showCompleted: boolean;
	animatingCompletionIds: ReadonlySet<string>;
	search: SearchFilter | null;
}

/** Whether `node` renders as a row: completion visibility, then the search filter when one is applied. */
export function rendersRow(
	node: NodeResponse,
	showCompleted: boolean,
	animatingCompletionIds: ReadonlySet<string>,
	search: SearchFilter | null,
): boolean {
	return (
		isPotentiallyVisible(node, searchShowsCompleted(showCompleted, search), animatingCompletionIds) &&
		(search === null || searchShowsNode(node, search))
	);
}

/** Whether `id`'s children render: the search's expansion during a search, else `expandedIds`. */
export function rendersChildren(id: string, expandedIds: ReadonlySet<string>, search: SearchFilter | null): boolean {
	return search === null ? expandedIds.has(id) : isSearchExpanded(id, search);
}

export interface RowLimits {
	/** How many of each loaded, rendered parent's visible children render. */
	limits: ReadonlyMap<string | null, number>;
	/** The budget left after every loaded row, for a parent whose children have not loaded yet. */
	remaining: number;
}

/** Spends `budget` rows depth-first over the loaded tree under `rootId`, filtering rows as `OutlineChildren` does. */
export function rowLimits(
	getChildren: (parentId: string | null) => NodeResponse[] | undefined,
	rootId: string | null,
	budget: number,
	{expandedIds, showCompleted, animatingCompletionIds, search}: RowView,
): RowLimits {
	const limits = new Map<string | null, number>();
	let used = 0;
	const visit = (parentId: string | null) => {
		const children = getChildren(parentId);
		if (children === undefined) {
			return;
		}
		let count = 0;
		for (const node of children) {
			if (used >= budget) {
				break;
			}
			if (!rendersRow(node, showCompleted, animatingCompletionIds, search)) {
				continue;
			}
			used += 1;
			count += 1;
			if (rendersChildren(node.id, expandedIds, search)) {
				visit(node.id);
			}
		}
		limits.set(parentId, count);
	};
	visit(rootId);
	return {limits, remaining: budget - used};
}

/** The rows `parentId` may render: its share when loaded, else whatever budget is left. */
export function rowLimit(limits: RowLimits, parentId: string | null): number {
	return limits.limits.get(parentId) ?? limits.remaining;
}

/** A value that changes exactly when some parent's limit or the remaining budget does. */
export function rowLimitsKey({limits, remaining}: RowLimits): string {
	return `${remaining}|${[...limits].map(([id, limit]) => `${id}:${limit}`).join(",")}`;
}
