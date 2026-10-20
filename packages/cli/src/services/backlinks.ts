import {WorkflowyInternalClient} from "@workflowy/shared/api";
import type {WorkflowyWriteThroughClient} from "@workflowy/shared/cache";
import {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import type {BacklinkSync} from "@workflowy/shared/internal";
import {readInternalAuth} from "@workflowy/shared/node";
import {hasInternalLink} from "@workflowy/shared/workflowy";
import type {createDatabase} from "../db/index.js";

/**
 * Bring the backlinks of `sourceIds` in line with their internal links, as
 * upstream's client does after a create or edit, when `texts` (the sources'
 * text before and after the write) hold any link: only a link added or
 * removed can change backlinks. Needs the internal API; undefined without it
 * or without a link.
 */
export async function syncBacklinksIfLinked(
	sourceIds: string[],
	texts: (string | null | undefined)[],
	database: ReturnType<typeof createDatabase>,
	writeThrough: WorkflowyWriteThroughClient,
): Promise<BacklinkSync | undefined> {
	if (sourceIds.length === 0 || !hasInternalLink(texts.join(" "))) {
		return undefined;
	}
	return internalAdapter(database, writeThrough)?.syncBacklinks(sourceIds);
}

/**
 * After a delete, remove the backlink items of the deleted `sourceIds`, as
 * upstream's client does; pass `linkedSourcesInSubtree` read before the
 * delete. Needs the internal API; does nothing without it or without a source.
 */
export async function deleteBacklinksOfDeleted(
	sourceIds: string[],
	database: ReturnType<typeof createDatabase>,
	writeThrough: WorkflowyWriteThroughClient,
): Promise<string[]> {
	if (sourceIds.length === 0) {
		return [];
	}
	return (await internalAdapter(database, writeThrough)?.deleteBacklinksOf(sourceIds)) ?? [];
}

function internalAdapter(
	database: ReturnType<typeof createDatabase>,
	writeThrough: WorkflowyWriteThroughClient,
): WorkflowyInternalAdapter | undefined {
	const auth = readInternalAuth();
	return auth
		? new WorkflowyInternalAdapter({client: new WorkflowyInternalClient(auth), db: database, writeThrough})
		: undefined;
}
