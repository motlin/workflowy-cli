/**
 * Fractional-priority arithmetic for positioning a node among its siblings.
 *
 * Workflowy orders siblings by an integer `priority`; inserting between two
 * siblings uses the midpoint of their priorities, and inserting past either end
 * steps 100 beyond the edge sibling. This logic was previously inlined ~10 times
 * across the keyboard-shortcut handlers; centralizing it here makes it pure and
 * unit-testable, independent of React and the query cache.
 */

export interface SiblingLike {
	id: string;
	priority: number;
}

/** Return a copy of the siblings sorted by ascending priority. */
export function sortByPriority<T extends SiblingLike>(siblings: T[]): T[] {
	return [...siblings].sort((a, b) => a.priority - b.priority);
}

/**
 * Priority for a node inserted immediately AFTER `nodeId` among `sorted`
 * (ascending). Midpoint between the node and its next sibling, or
 * `fallbackPriority + 100` if the node is last or absent.
 */
export function insertAfterPriority(sorted: SiblingLike[], nodeId: string, fallbackPriority: number): number {
	const index = sorted.findIndex((sibling) => sibling.id === nodeId);
	if (index !== -1 && index < sorted.length - 1) {
		return Math.floor((sorted[index].priority + sorted[index + 1].priority) / 2);
	}
	return fallbackPriority + 100;
}

/**
 * Priority for a node inserted immediately BEFORE `nodeId` among `sorted`
 * (ascending). Midpoint between the node and its previous sibling, or
 * `fallbackPriority - 100` if the node is first or absent.
 */
export function insertBeforePriority(sorted: SiblingLike[], nodeId: string, fallbackPriority: number): number {
	const index = sorted.findIndex((sibling) => sibling.id === nodeId);
	if (index > 0) {
		return Math.floor((sorted[index - 1].priority + sorted[index].priority) / 2);
	}
	return fallbackPriority - 100;
}
