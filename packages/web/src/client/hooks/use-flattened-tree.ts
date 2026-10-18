import type {NodeResponse} from "../../node-types.js";
import {isPotentiallyVisible, rowHasChildren} from "../tree-ops.js";

/**
 * A flattened node includes the original node data plus its depth in the tree.
 * This allows us to render a flat list with proper indentation.
 */
interface FlattenedNode {
	node: NodeResponse;
	depth: number;
	isExpanded: boolean;
	hasChildren: boolean;
}

/**
 * Recursively flattens the tree structure into an array for virtualization.
 * Only includes nodes that are visible (i.e., all ancestors are expanded).
 */
export function flattenTree(
	nodes: NodeResponse[] | undefined,
	expandedIds: Set<string>,
	showCompleted: boolean,
	depth: number,
	childrenMap: Map<string, NodeResponse[]>,
	animating: ReadonlySet<string>,
): FlattenedNode[] {
	if (!nodes || nodes.length === 0) {
		return [];
	}

	const visibleNodes = nodes.filter((node) => isPotentiallyVisible(node, showCompleted, animating));

	const result: FlattenedNode[] = [];

	for (const node of visibleNodes) {
		const isExpanded = expandedIds.has(node.id);
		const children = childrenMap.get(node.id);
		// Use the server-provided child flags when available, otherwise fall back to checking fetched children
		const hasChildren =
			node.hasChildren === undefined
				? children === undefined || children.length > 0
				: rowHasChildren(node, showCompleted);

		result.push({
			node,
			depth,
			isExpanded,
			hasChildren,
		});

		// Only recurse into expanded nodes that have fetched children
		if (isExpanded && children && children.length > 0) {
			const childFlattened = flattenTree(children, expandedIds, showCompleted, depth + 1, childrenMap, animating);
			result.push(...childFlattened);
		}
	}

	return result;
}
