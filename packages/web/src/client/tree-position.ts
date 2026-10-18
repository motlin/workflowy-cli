/**
 * Priority helpers for sibling order. Workflowy orders siblings by `priority`;
 * writes target an exact sibling index, so priorities here only order the
 * client cache.
 */

export interface SiblingLike {
	id: string;
	priority: number;
}

/** Return a copy of the siblings sorted by ascending priority. */
export function sortByPriority<T extends SiblingLike>(siblings: T[]): T[] {
	return [...siblings].toSorted((a, b) => a.priority - b.priority);
}

/**
 * A client-cache priority that sorts a new row into slot `index` (omitted = bottom)
 * among `siblings`, for optimistic rows before the server's real priorities arrive.
 */
export function priorityAtIndex(siblings: SiblingLike[], index: number | undefined): number {
	const sorted = sortByPriority(siblings);
	const before = sorted[Math.min(index ?? sorted.length, sorted.length) - 1];
	const after = index === undefined ? undefined : sorted[index];
	if (before !== undefined && after !== undefined) {
		return (before.priority + after.priority) / 2;
	}
	if (after !== undefined) {
		return after.priority - 1;
	}
	return before === undefined ? 0 : before.priority + 1;
}
