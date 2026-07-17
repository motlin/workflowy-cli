import type {QueryClient} from '@tanstack/react-query';
import type {NodeResponse} from '../node-types.js';
import {readChildren, readDetail} from './node-cache.js';
import {insertAfterPriority, insertBeforePriority, sortByPriority} from './tree-position.js';

/**
 * Tree-mutation planning: given the React Query cache and a node, compute the
 * payload for the corresponding create/move mutation (or null when the mutation
 * is a no-op). Each function hides the sibling-cache read + fractional-priority
 * arithmetic that the keyboard handlers and the editor would otherwise inline.
 *
 * These are pure over `(queryClient, node)`, so they unit-test by seeding a
 * QueryClient and asserting the emitted payload — no DOM, no key events.
 */

/** Payload accepted by the create-node mutation. */
export interface CreateNodePayload {
	parent_id?: string;
	name: string;
	note?: string;
	position?: number;
}

/** Payload accepted by the move-node mutation. */
export interface MoveNodePayload {
	nodeId: string;
	parent_id: string | null;
	position?: number;
}

/** The minimal node fields the planners read. */
type PlanNode = Pick<NodeResponse, 'id' | 'parent_id' | 'priority'>;

/** Create an empty sibling positioned immediately after `node` (Enter / new-sibling). */
export function planInsertSiblingAfter(queryClient: QueryClient, node: PlanNode): CreateNodePayload {
	const siblings = readChildren(queryClient, node.parent_id);
	const position = insertAfterPriority(siblings ? sortByPriority(siblings) : [], node.id, node.priority);
	return {parent_id: node.parent_id ?? undefined, name: '', position};
}

/** Duplicate `node`'s name/note as a sibling positioned immediately after it. */
export function planDuplicate(
	queryClient: QueryClient,
	node: PlanNode & Pick<NodeResponse, 'name' | 'note'>,
): CreateNodePayload {
	const siblings = readChildren(queryClient, node.parent_id);
	const position = insertAfterPriority(siblings ? sortByPriority(siblings) : [], node.id, node.priority);
	return {parent_id: node.parent_id ?? undefined, name: node.name ?? '', note: node.note ?? undefined, position};
}

/** Indent `node` under its previous sibling, or null if it has no previous sibling. */
export function planIndent(queryClient: QueryClient, node: PlanNode): MoveNodePayload | null {
	const siblings = readChildren(queryClient, node.parent_id);
	if (!siblings) return null;
	const sorted = sortByPriority(siblings);
	const index = sorted.findIndex((sibling) => sibling.id === node.id);
	if (index <= 0) return null;
	return {nodeId: node.id, parent_id: sorted[index - 1].id};
}

/** Outdent `node` to sit after its parent among the grandparent's children, or null if at root. */
export function planOutdent(queryClient: QueryClient, node: PlanNode): MoveNodePayload | null {
	if (node.parent_id === null) return null;
	const parent = readDetail(queryClient, node.parent_id);
	if (parent === undefined) return null;
	const grandparentId = parent.parent_id;
	const parentSiblings = readChildren(queryClient, grandparentId);
	const position = insertAfterPriority(
		parentSiblings ? sortByPriority(parentSiblings) : [],
		node.parent_id,
		parent.priority,
	);
	return {nodeId: node.id, parent_id: grandparentId, position};
}

/** Move `node` up among its siblings (before the previous one), or null if already first. */
export function planMoveUp(queryClient: QueryClient, node: PlanNode): MoveNodePayload | null {
	const siblings = readChildren(queryClient, node.parent_id);
	if (!siblings || siblings.length < 2) return null;
	const sorted = sortByPriority(siblings);
	const index = sorted.findIndex((sibling) => sibling.id === node.id);
	if (index <= 0) return null;
	const previous = sorted[index - 1];
	return {
		nodeId: node.id,
		parent_id: node.parent_id,
		position: insertBeforePriority(sorted, previous.id, previous.priority),
	};
}

/** Move `node` down among its siblings (after the next one), or null if already last. */
export function planMoveDown(queryClient: QueryClient, node: PlanNode): MoveNodePayload | null {
	const siblings = readChildren(queryClient, node.parent_id);
	if (!siblings || siblings.length < 2) return null;
	const sorted = sortByPriority(siblings);
	const index = sorted.findIndex((sibling) => sibling.id === node.id);
	if (index === -1 || index >= sorted.length - 1) return null;
	const next = sorted[index + 1];
	return {nodeId: node.id, parent_id: node.parent_id, position: insertAfterPriority(sorted, next.id, next.priority)};
}

/**
 * The node to select after `node` is deleted: the previous visible node, else the
 * parent, else null (root with nothing before it).
 */
export function nextSelectionAfterDelete(
	visibleNodes: string[],
	node: Pick<NodeResponse, 'id' | 'parent_id'>,
): string | null {
	const index = visibleNodes.indexOf(node.id);
	if (index > 0) return visibleNodes[index - 1];
	if (node.parent_id !== null) return node.parent_id;
	return null;
}
