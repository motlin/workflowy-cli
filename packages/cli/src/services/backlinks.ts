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
	const auth = readInternalAuth();
	if (!auth) {
		return undefined;
	}
	const adapter = new WorkflowyInternalAdapter({
		client: new WorkflowyInternalClient(auth),
		db: database,
		writeThrough,
	});
	return adapter.syncBacklinks(sourceIds);
}
