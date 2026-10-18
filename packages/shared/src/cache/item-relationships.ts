/**
 * Item relationships carried only in Workflowy's per-item `metadata` (a backup
 * file or the internal `/get_tree_data/` read), never by the public REST API:
 * mirrors, backlinks, virtual roots and references roots.
 *
 * Both import adapters normalize item metadata through
 * {@link collectItemRelationships} and merge the composite-key tables through
 * {@link mergeItemRelationships}, so the parse and the merge live in one place.
 */

import {eq} from "drizzle-orm";
import {backlinks, mirrors, virtualRootIds} from "../db/schema.js";
import {FAR_FUTURE_DATE} from "../temporal/index.js";
import type {UnitOfWork} from "./node-composite.js";
import type {
	NormalizedBacklinkRow,
	NormalizedMirrorRow,
	NormalizedReferencesRootsRow,
	NormalizedVirtualRootIdRow,
} from "./normalized-rows.js";
import {joinKey, temporalMerge} from "./temporal-merge.js";
import type {TemporalMergeResult} from "./temporal-merge.js";

export interface ItemRelationships {
	mirrors: NormalizedMirrorRow[];
	backlinks: NormalizedBacklinkRow[];
	virtualRootIds: NormalizedVirtualRootIdRow[];
	referencesRoots: NormalizedReferencesRootsRow[];
}

export interface MergeItemRelationshipsResult {
	mirrors: TemporalMergeResult;
	backlinks: TemporalMergeResult;
	virtualRootIds: TemporalMergeResult;
}

export function emptyItemRelationships(): ItemRelationships {
	return {mirrors: [], backlinks: [], virtualRootIds: [], referencesRoots: []};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keysOf(value: unknown): string[] {
	return isRecord(value) ? Object.keys(value) : [];
}

/**
 * Append the relationships in one item's `metadata` to `into`. Unknown or
 * malformed fields are ignored, so it reads both the validated backup shape and
 * the untyped `/get_tree_data/` items.
 */
export function collectItemRelationships(into: ItemRelationships, id: string, metadata: unknown): void {
	if (!isRecord(metadata)) {
		return;
	}
	if (metadata.isReferencesRoot === true) {
		into.referencesRoots.push({nodeId: id});
	}
	const {mirror, backlink} = metadata;
	if (isRecord(mirror)) {
		// originalId: this node mirrors that original.
		if (typeof mirror.originalId === "string" && mirror.originalId !== "") {
			into.mirrors.push({mirrorId: id, originalId: mirror.originalId});
		}
		// mirrorRootIds / backlinkMirrorRootIds: this node is the original of each id.
		for (const mirrorId of [...keysOf(mirror.mirrorRootIds), ...keysOf(mirror.backlinkMirrorRootIds)]) {
			into.mirrors.push({mirrorId, originalId: id});
		}
	}
	if (isRecord(backlink) && typeof backlink.sourceID === "string" && typeof backlink.targetID === "string") {
		into.backlinks.push({nodeId: id, sourceId: backlink.sourceID, targetId: backlink.targetID});
	}
	for (const virtualRootId of keysOf(metadata.virtualRootIds)) {
		into.virtualRootIds.push({nodeId: id, virtualRootId});
	}
}

function dedupe<T>(rows: T[], key: (row: T) => string): T[] {
	return [...new Map(rows.map((row) => [key(row), row])).values()];
}

const mirrorKey = (m: NormalizedMirrorRow): string => joinKey(m.mirrorId, m.originalId);
const backlinkKey = (b: NormalizedBacklinkRow): string => joinKey(b.nodeId, b.sourceId, b.targetId);
const virtualRootKey = (r: NormalizedVirtualRootIdRow): string => joinKey(r.nodeId, r.virtualRootId);

/**
 * Globally merge `mirrors`, `backlinks` and `virtual_root_ids` to the desired
 * state in `relationships`, in the caller's unit of work. Only rows whose nodes
 * are in `liveNodeIds` are kept: a mirror needs both sides (Workflowy keeps a
 * mirror's `originalId` after deleting its original, and an original's
 * `mirrorRootIds` after deleting a mirror), and a backlink or virtual-root row
 * needs its owning node.
 */
export function mergeItemRelationships(
	unitOfWork: UnitOfWork,
	relationships: ItemRelationships,
	liveNodeIds: ReadonlySet<string>,
): MergeItemRelationshipsResult {
	const {tx, systemTime} = unitOfWork;

	const mirrorRows = dedupe(
		relationships.mirrors.filter((m) => liveNodeIds.has(m.mirrorId) && liveNodeIds.has(m.originalId)),
		mirrorKey,
	);
	const mirrorResult = temporalMerge(
		tx,
		{
			table: mirrors,
			keyColumns: [mirrors.mirrorId, mirrors.originalId],
			systemToColumn: mirrors.systemTo,
			incomingKey: mirrorKey,
			currentKey: mirrorKey,
			contentMatches: () => true, // the key is the whole row
			buildInsertRow: (m: NormalizedMirrorRow) => ({mirrorId: m.mirrorId, originalId: m.originalId}),
		},
		mirrorRows,
		tx.select().from(mirrors).where(eq(mirrors.systemTo, FAR_FUTURE_DATE)).all(),
		systemTime,
	);

	const backlinkRows = dedupe(
		relationships.backlinks.filter((b) => liveNodeIds.has(b.nodeId)),
		backlinkKey,
	);
	const backlinkResult = temporalMerge(
		tx,
		{
			table: backlinks,
			keyColumns: [backlinks.nodeId, backlinks.sourceId, backlinks.targetId],
			systemToColumn: backlinks.systemTo,
			incomingKey: backlinkKey,
			currentKey: backlinkKey,
			contentMatches: () => true, // the key is the whole row
			buildInsertRow: (b: NormalizedBacklinkRow) => ({
				nodeId: b.nodeId,
				sourceId: b.sourceId,
				targetId: b.targetId,
			}),
		},
		backlinkRows,
		tx.select().from(backlinks).where(eq(backlinks.systemTo, FAR_FUTURE_DATE)).all(),
		systemTime,
	);

	const virtualRootRows = dedupe(
		relationships.virtualRootIds.filter((r) => liveNodeIds.has(r.nodeId)),
		virtualRootKey,
	);
	const virtualRootResult = temporalMerge(
		tx,
		{
			table: virtualRootIds,
			keyColumns: [virtualRootIds.nodeId, virtualRootIds.virtualRootId],
			systemToColumn: virtualRootIds.systemTo,
			incomingKey: virtualRootKey,
			currentKey: virtualRootKey,
			contentMatches: () => true, // the key is the whole row
			buildInsertRow: (r: NormalizedVirtualRootIdRow) => ({nodeId: r.nodeId, virtualRootId: r.virtualRootId}),
		},
		virtualRootRows,
		tx.select().from(virtualRootIds).where(eq(virtualRootIds.systemTo, FAR_FUTURE_DATE)).all(),
		systemTime,
	);

	return {mirrors: mirrorResult, backlinks: backlinkResult, virtualRootIds: virtualRootResult};
}
