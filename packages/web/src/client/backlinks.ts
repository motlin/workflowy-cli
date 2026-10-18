import type {BacklinksResponse} from "../node-types.js";

/** Upstream's references-root label: `${count} Backlink${count > 1 ? "s" : ""}`. */
export function backlinksLabel(count: number): string {
	return `${count} Backlink${count > 1 ? "s" : ""}`;
}

/**
 * Upstream's `isDisplayable` for a references root: it has a root and at least
 * one backlink whose source is visible (not completed while completed items are hidden).
 */
export function isBacklinksSectionVisible(backlinks: BacklinksResponse | undefined, showCompleted: boolean): boolean {
	if (backlinks?.rootId == null) {
		return false;
	}
	return backlinks.items.some((item) => showCompleted || item.node.completedAt === null);
}
