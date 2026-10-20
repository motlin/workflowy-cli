import {uuidToShortId} from "./constants.js";

/**
 * An internal link's href: workflowy.com (or beta) with `#/` and a node's
 * short id or full UUID, which upstream resolves to the linked item.
 */
const INTERNAL_LINK_PATTERN =
	/href="https:\/\/(?:beta\.)?workflowy\.com\/#\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}|[\da-f]{12})(?![\da-f-])/giu;

/** The short ids of the nodes `text` links to (its `<a href>`s to workflowy.com), in order and deduplicated. */
export function internalLinkShortIds(text: string): string[] {
	const shortIds = new Set<string>();
	for (const [, id] of text.matchAll(INTERNAL_LINK_PATTERN)) {
		if (id !== undefined) {
			shortIds.add(uuidToShortId(id.toLowerCase()));
		}
	}
	return [...shortIds];
}

/** Whether `text` holds any internal link. */
export function hasInternalLink(text: string): boolean {
	return internalLinkShortIds(text).length > 0;
}
