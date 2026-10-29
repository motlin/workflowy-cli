/**
 * Item relationships carried only in Workflowy's per-item `metadata` (a backup
 * file or the internal `/get_tree_data/` read), never by the public REST API:
 * mirrors, backlinks, virtual roots and references roots.
 *
 * Both import adapters normalize item metadata through
 * {@link collectItemRelationships} and merge the composite-key tables through
 * {@link mergeItemRelationships}, so the parse and the merge live in one place.
 */

import {and, eq, inArray, or} from "drizzle-orm";
import {backlinks, mirrors, referencesRoots, virtualRootIds} from "../db/schema.js";
import {FAR_FUTURE_DATE} from "../temporal/index.js";
import type {UnitOfWork} from "./node-composite.js";
import type {
	NormalizedBacklinkRow,
	NormalizedMirrorRow,
	NormalizedReferencesRootsRow,
	NormalizedVirtualRootIdRow,
} from "./normalized-rows.js";
import {joinKey, temporalMerge} from "./temporal-merge.js";
import type {TemporalMergeResult, TemporalTransaction} from "./temporal-merge.js";

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

/**
 * Insert the `mirrors`, `backlinks` and `references_roots` rows in
 * `relationships` that are not already current, in the caller's unit of work.
 * Unlike {@link mergeItemRelationships} it ends nothing: it records what an
 * accepted push created.
 */
export function recordItemRelationships(unitOfWork: UnitOfWork, relationships: ItemRelationships): void {
	const {tx, systemTime} = unitOfWork;
	const current = {systemFrom: systemTime, systemTo: FAR_FUTURE_DATE};
	for (const row of dedupe(relationships.mirrors, mirrorKey)) {
		const exists = tx
			.select({id: mirrors.mirrorId})
			.from(mirrors)
			.where(
				and(
					eq(mirrors.mirrorId, row.mirrorId),
					eq(mirrors.originalId, row.originalId),
					eq(mirrors.systemTo, FAR_FUTURE_DATE),
				),
			)
			.get();
		if (exists === undefined) {
			tx.insert(mirrors)
				.values({mirrorId: row.mirrorId, originalId: row.originalId, ...current})
				.run();
		}
	}
	for (const row of dedupe(relationships.backlinks, backlinkKey)) {
		const exists = tx
			.select({id: backlinks.nodeId})
			.from(backlinks)
			.where(
				and(
					eq(backlinks.nodeId, row.nodeId),
					eq(backlinks.sourceId, row.sourceId),
					eq(backlinks.targetId, row.targetId),
					eq(backlinks.systemTo, FAR_FUTURE_DATE),
				),
			)
			.get();
		if (exists === undefined) {
			tx.insert(backlinks)
				.values({nodeId: row.nodeId, sourceId: row.sourceId, targetId: row.targetId, ...current})
				.run();
		}
	}
	for (const nodeId of new Set(relationships.referencesRoots.map((row) => row.nodeId))) {
		const exists = tx
			.select({id: referencesRoots.nodeId})
			.from(referencesRoots)
			.where(and(eq(referencesRoots.nodeId, nodeId), eq(referencesRoots.systemTo, FAR_FUTURE_DATE)))
			.get();
		if (exists === undefined) {
			tx.insert(referencesRoots)
				.values({nodeId, ...current})
				.run();
		}
	}
}

/** The relationship part of one item's upstream metadata, as `/get_tree_data/` carries it. */
export interface UpstreamRelationshipMetadata {
	mirror?: {
		originalId?: string;
		isMirrorRoot?: true;
		mirrorRootIds?: Record<string, true>;
		backlinkMirrorRootIds?: Record<string, true>;
	};
	backlink?: {sourceID: string; targetID: string};
	isReferencesRoot?: true;
}

const ID_BATCH_SIZE = 500;

/**
 * Each node's upstream `mirror`, `backlink` and `isReferencesRoot` objects,
 * rebuilt from the current `mirrors`, `backlinks` and `references_roots` rows
 * (the inverse of {@link collectItemRelationships}). A mirror that is a backlink
 * item is listed under its original's `backlinkMirrorRootIds`, any other under
 * `mirrorRootIds`; a `backlinks` row also lists its item under its source's
 * `backlinkMirrorRootIds`. A node with no relationships maps to `{}`.
 */
export function upstreamRelationshipMetadata(
	tx: TemporalTransaction,
	nodeIds: readonly string[],
): Map<string, UpstreamRelationshipMetadata> {
	const result = new Map<string, UpstreamRelationshipMetadata>(nodeIds.map((id) => [id, {}]));
	const ids = [...result.keys()];
	for (let start = 0; start < ids.length; start += ID_BATCH_SIZE) {
		const batch = ids.slice(start, start + ID_BATCH_SIZE);
		const mirrorRows = tx
			.select({mirrorId: mirrors.mirrorId, originalId: mirrors.originalId})
			.from(mirrors)
			.where(
				and(
					or(inArray(mirrors.mirrorId, batch), inArray(mirrors.originalId, batch)),
					eq(mirrors.systemTo, FAR_FUTURE_DATE),
				),
			)
			.all();
		const backlinkItemIds = new Set(
			tx
				.select({nodeId: backlinks.nodeId})
				.from(backlinks)
				.where(
					and(
						inArray(
							backlinks.nodeId,
							mirrorRows.map((row) => row.mirrorId),
						),
						eq(backlinks.systemTo, FAR_FUTURE_DATE),
					),
				)
				.all()
				.map((row) => row.nodeId),
		);
		for (const {mirrorId, originalId} of mirrorRows) {
			const asMirror = result.get(mirrorId);
			if (asMirror !== undefined) {
				asMirror.mirror = {...asMirror.mirror, originalId, isMirrorRoot: true};
			}
			const asOriginal = result.get(originalId);
			if (asOriginal !== undefined) {
				const mirror = (asOriginal.mirror ??= {});
				const field = backlinkItemIds.has(mirrorId) ? "backlinkMirrorRootIds" : "mirrorRootIds";
				mirror[field] = {...mirror[field], [mirrorId]: true};
			}
		}
		const backlinkRows = tx
			.select({nodeId: backlinks.nodeId, sourceId: backlinks.sourceId, targetId: backlinks.targetId})
			.from(backlinks)
			.where(
				and(
					or(inArray(backlinks.nodeId, batch), inArray(backlinks.sourceId, batch)),
					eq(backlinks.systemTo, FAR_FUTURE_DATE),
				),
			)
			.all();
		for (const {nodeId, sourceId, targetId} of backlinkRows) {
			const metadata = result.get(nodeId);
			if (metadata !== undefined) {
				metadata.backlink = {sourceID: sourceId, targetID: targetId};
			}
			// Some backlink items have no mirrors row; the backlinks row alone lists them on their source.
			const source = result.get(sourceId);
			if (source !== undefined) {
				const mirror = (source.mirror ??= {});
				mirror.backlinkMirrorRootIds = {...mirror.backlinkMirrorRootIds, [nodeId]: true};
			}
		}
		const rootRows = tx
			.select({nodeId: referencesRoots.nodeId})
			.from(referencesRoots)
			.where(and(inArray(referencesRoots.nodeId, batch), eq(referencesRoots.systemTo, FAR_FUTURE_DATE)))
			.all();
		for (const {nodeId} of rootRows) {
			const metadata = result.get(nodeId);
			if (metadata !== undefined) {
				metadata.isReferencesRoot = true;
			}
		}
	}
	return result;
}
