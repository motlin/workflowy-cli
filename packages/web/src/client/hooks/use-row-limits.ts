import {createContext, useCallback, useEffect, useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import type {NodeResponse} from "../../node-types.js";
import {nodeKeys} from "../node-cache.js";
import type {SearchFilter} from "../search-filter.js";
import type {RowLimits} from "../render-window.js";
import {initialRowBudget, nextRowBudget, rowLimits, rowLimitsKey} from "../render-window.js";
import {useOutlineStore} from "../stores/outline.js";

/** The outline's per-parent row limits; null outside an `OutlineTree`, where `.children` render every row. */
export const RowLimitsContext = createContext<RowLimits | null>(null);

/** Every children query's hash starts so (TanStack hashes a key as its JSON). */
const CHILDREN_HASH_PREFIX = JSON.stringify(nodeKeys.children(null)).replace(/null\]$/u, "");

function viewportHeight(): number {
	return typeof window === "undefined" ? 0 : window.innerHeight;
}

/**
 * The row limits for the outline under `rootId`, recomputed as children load or change, plus the current budget and
 * a callback raising it by one step. The budget restarts at a viewport of rows on each zoom and each search result.
 * The limits keep their identity until some limit changes, so a cache write that moves no limit re-renders nothing.
 */
export function useRowLimits(
	rootId: string | null,
	search: SearchFilter | null,
): {rowLimits: RowLimits; budgetRows: number; growBudget: () => void} {
	const queryClient = useQueryClient();
	const expandedIds = useOutlineStore((state) => state.expandedIds);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const animatingCompletionIds = useOutlineStore((state) => state.animatingCompletionIds);
	const result = search?.result;

	const [budget, setBudget] = useState({rootId, result, rows: initialRowBudget(viewportHeight())});
	if (budget.rootId !== rootId || budget.result !== result) {
		setBudget({rootId, result, rows: initialRowBudget(viewportHeight())});
	}

	const compute = (): RowLimits =>
		rowLimits(
			(parentId) => queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(parentId)),
			rootId,
			budget.rows,
			{expandedIds, showCompleted, animatingCompletionIds, search},
		);
	const computed = compute();
	const [stable, setStable] = useState(computed);
	if (rowLimitsKey(stable) !== rowLimitsKey(computed)) {
		setStable(computed);
	}

	const latestCompute = useRef(compute);
	useEffect(() => {
		latestCompute.current = compute;
	});
	useEffect(
		() =>
			queryClient.getQueryCache().subscribe((event) => {
				if (event.type !== "updated" || !event.query.queryHash.startsWith(CHILDREN_HASH_PREFIX)) {
					return;
				}
				const next = latestCompute.current();
				setStable((current) => (rowLimitsKey(current) === rowLimitsKey(next) ? current : next));
			}),
		[queryClient],
	);

	const growBudget = useCallback(() => {
		setBudget((current) => ({...current, rows: nextRowBudget(current.rows)}));
	}, []);
	return {rowLimits: stable, budgetRows: budget.rows, growBudget};
}
