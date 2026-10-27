import {and, eq, inArray} from "drizzle-orm";
import type {InternalTreeItem} from "../api/workflowy-internal-client.js";
import {nodeContent, nodeMetadata} from "../db/schema.js";
import type {NodeContentType, NodeMetadataType} from "../db/schema.js";
import type {AppDatabase} from "../db/types.js";
import {FAR_FUTURE_DATE, formatTemporalTimestamp} from "../temporal/index.js";
import {WorkflowyNodeSchema} from "../types/index.js";
import type {WorkflowyNode} from "../types/index.js";
import {uuidToShortId} from "../workflowy/index.js";
import {contentMatches, metadataComparisonStats, metadataMatches, normalizeLayoutMode} from "./cache-temporal.js";
import {applyNodeRowsBatch, applyRows} from "./importer.js";
import type {NormalizedRowsByTable} from "./importer.js";
import {collectItemRelationships, emptyItemRelationships, mergeItemRelationships} from "./item-relationships.js";
import type {ItemRelationships} from "./item-relationships.js";
import {endNodeComposites, endOrphanedParts, runUnitOfWork} from "./node-composite.js";
import type {UnitOfWork} from "./node-composite.js";
import type {NormalizedNodeContentRow, NormalizedNodeMetadataRow} from "./normalized-rows.js";
import {nextSystemTime} from "./system-clock.js";

/** Bound-parameter chunk for `id IN (...)` lookups; Durable Object SQLite caps a statement at 100. */
const LOOKUP_CHUNK_SIZE = 90;

/** The logging the import needs; the host decides where it goes. */
export interface ImportLogger {
	debug(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export interface ImportApiResult {
	totalNodes: number;
	nodesAdded: number;
	nodesUpdated: number;
	nodesUnchanged: number;
	nodesDeleted: number;
	nodesPhasedOut: number;
	contentUpdated: number;
	metadataUpdated: number;
	priorityUpdated: number;
	importTimestamp: Date;
}

export interface ImportFromApiOptions {
	logger?: ImportLogger;
	timestamp?: Date;
	/**
	 * A full `/get_tree_data/` read. The public API carries no mirrors, backlinks,
	 * virtual roots or references roots; when given, those merge from its item
	 * metadata in the same unit of work. Without it their rows are left untouched.
	 */
	treeItems?: InternalTreeItem[];
}

interface ProcessedNode {
	id: string;
	shortId: string;
	name: string;
	note: string | null;
	parentId: string | null;
	priority: number;
	createdAt: number | null;
	modifiedAt: number | null;
	completedAt: number | null;
	layoutMode: string | null;
}

/** Progress of one batched import. Opaque to callers; pass it between the three calls. */
export interface ApiImportState {
	readonly database: AppDatabase;
	readonly logger: ImportLogger | undefined;
	readonly importTimestamp: Date;
	readonly seenIds: Set<string>;
	totalNodes: number;
	nodesAdded: number;
	nodesUpdated: number;
	nodesUnchanged: number;
	contentUpdated: number;
	metadataUpdated: number;
	validationErrors: number;
	startTime: number;
	relationshipNodeIds?: Set<string>;
}

function timestampToDate(timestamp: number | null | undefined): Date | null {
	return timestamp === null || timestamp === undefined ? null : new Date(timestamp * 1000);
}

function nonEmpty(value: string | null | undefined): string | undefined {
	return value === "" || value === null ? undefined : value;
}

function processNodes(state: ApiImportState, apiNodes: WorkflowyNode[]): ProcessedNode[] {
	const processed: ProcessedNode[] = [];
	for (const node of apiNodes) {
		const parsed = WorkflowyNodeSchema.safeParse(node);
		if (!parsed.success) {
			state.validationErrors++;
			state.logger?.error(
				`Validation error for node ${node.id}: ${parsed.error.message}\nNode JSON: ${JSON.stringify(node, null, 2)}`,
			);
			continue;
		}
		const validated = parsed.data;
		processed.push({
			id: validated.id,
			shortId: uuidToShortId(validated.id),
			name: validated.name,
			note: nonEmpty(validated.note) ?? null,
			parentId: validated.parent_id ?? null,
			priority: validated.priority,
			createdAt: validated.createdAt,
			modifiedAt: validated.modifiedAt ?? null,
			completedAt: validated.completedAt ?? null,
			layoutMode: normalizeLayoutMode(validated.data?.layoutMode),
		});
	}
	return processed;
}

/** Start a batched import. The system time is fixed here so every batch lands at the same instant. */
export function beginApiImport(
	database: AppDatabase,
	options: {logger?: ImportLogger; timestamp?: Date} = {},
): ApiImportState {
	const startTime = Date.now();
	options.logger?.debug("[IMPORT-API] Starting import");
	metadataComparisonStats.reset();
	return {
		database,
		logger: options.logger,
		importTimestamp: options.timestamp ?? nextSystemTime(database),
		seenIds: new Set(),
		totalNodes: 0,
		nodesAdded: 0,
		nodesUpdated: 0,
		nodesUnchanged: 0,
		contentUpdated: 0,
		metadataUpdated: 0,
		validationErrors: 0,
		startTime,
	};
}

function applyBatchIn(unitOfWork: UnitOfWork, state: ApiImportState, apiNodes: WorkflowyNode[]): void {
	const nodes = processNodes(state, apiNodes);
	const {tx} = unitOfWork;
	const ids = nodes.map((node) => node.id);

	// Classify against only this batch's current rows.
	const existingContent = new Map<string, NodeContentType>();
	const existingMetadata = new Map<string, NodeMetadataType>();
	for (let start = 0; start < ids.length; start += LOOKUP_CHUNK_SIZE) {
		const chunk = ids.slice(start, start + LOOKUP_CHUNK_SIZE);
		for (const row of tx
			.select()
			.from(nodeContent)
			.where(and(eq(nodeContent.systemTo, FAR_FUTURE_DATE), inArray(nodeContent.id, chunk)))
			.all()) {
			existingContent.set(row.id, row);
		}
		for (const row of tx
			.select()
			.from(nodeMetadata)
			.where(and(eq(nodeMetadata.systemTo, FAR_FUTURE_DATE), inArray(nodeMetadata.nodeId, chunk)))
			.all()) {
			existingMetadata.set(row.nodeId, row);
		}
	}
	for (const node of nodes) {
		const content = existingContent.get(node.id);
		const metadata = existingMetadata.get(node.id);
		const contentChanged = content && !contentMatches(content, node);
		const metadataChanged = metadata && !metadataMatches(metadata, node);
		if (!content) {
			state.nodesAdded++;
		} else if (contentChanged || metadataChanged) {
			state.nodesUpdated++;
			if (contentChanged) {
				state.contentUpdated++;
			}
			if (metadataChanged) {
				state.metadataUpdated++;
			}
		} else {
			state.nodesUnchanged++;
		}
		state.seenIds.add(node.id);
	}
	state.totalNodes += nodes.length;

	const contentRows: NormalizedNodeContentRow[] = nodes.map((node) => ({
		id: node.id,
		name: node.name,
		note: node.note,
		parentId: node.parentId,
	}));
	const metadataRows: NormalizedNodeMetadataRow[] = nodes.map((node) => ({
		nodeId: node.id,
		shortId: node.shortId,
		priority: node.priority,
		createdAt: timestampToDate(node.createdAt),
		modifiedAt: timestampToDate(node.modifiedAt),
		completedAt: timestampToDate(node.completedAt),
		layoutMode: node.layoutMode,
	}));
	applyNodeRowsBatch(unitOfWork, {nodeContent: contentRows, nodeMetadata: metadataRows});
}

/**
 * Merge one batch of API nodes. Looks up existing rows by `id IN (...)` for
 * this batch only; nothing absent from the batch is touched.
 */
export function applyApiBatch(state: ApiImportState, apiNodes: WorkflowyNode[]): void {
	runUnitOfWork(
		state.database,
		(unitOfWork) => {
			applyBatchIn(unitOfWork, state, apiNodes);
		},
		formatTemporalTimestamp(state.importTimestamp),
	);
}

function finishIn(unitOfWork: UnitOfWork, state: ApiImportState, treeItems?: InternalTreeItem[]): ImportApiResult {
	const {tx} = unitOfWork;
	const unseen: string[] = [];
	for (const row of tx
		.select({id: nodeContent.id})
		.from(nodeContent)
		.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
		.all()) {
		if (!state.seenIds.has(row.id)) {
			unseen.push(row.id);
		}
	}
	endNodeComposites(unitOfWork, unseen);

	if (treeItems !== undefined) {
		const relationships: ItemRelationships = emptyItemRelationships();
		for (const item of treeItems) {
			collectItemRelationships(relationships, item.id, item.metadata);
		}
		const rowsByTable: NormalizedRowsByTable = {
			referencesRoots: relationships.referencesRoots.filter((row) => state.seenIds.has(row.nodeId)),
		};
		applyRows(unitOfWork, rowsByTable, undefined);
		mergeItemRelationships(unitOfWork, relationships, state.seenIds);
	}
	endOrphanedParts(unitOfWork);

	state.logger?.debug(`[IMPORT-API] Finished in ${Date.now() - state.startTime}ms`);
	return {
		totalNodes: state.totalNodes,
		nodesAdded: state.nodesAdded,
		nodesUpdated: state.nodesUpdated,
		nodesUnchanged: state.nodesUnchanged,
		nodesDeleted: unseen.length,
		nodesPhasedOut: unseen.length,
		contentUpdated: state.contentUpdated,
		metadataUpdated: state.metadataUpdated,
		priorityUpdated: 0,
		importTimestamp: state.importTimestamp,
	};
}

/**
 * Finish a batched import: end every node no batch mentioned (with its whole
 * composite), then merge the tree-derived relationships when given.
 */
export function finishApiImport(state: ApiImportState, treeItems?: InternalTreeItem[]): ImportApiResult {
	if (state.validationErrors > 0) {
		state.logger?.warn(`Encountered ${state.validationErrors} validation errors during import`);
	}
	return runUnitOfWork(
		state.database,
		(unitOfWork) => finishIn(unitOfWork, state, treeItems),
		formatTemporalTimestamp(state.importTimestamp),
	);
}

/**
 * Import nodes from the Workflowy API export endpoint in one unit of work.
 *
 * The input is a flat list whose nodes already carry `parent_id`. The merge
 * runs through the same batch path as {@link applyApiBatch}, with a single batch.
 */
export function importFromApi(
	database: AppDatabase,
	apiNodes: WorkflowyNode[],
	options: ImportFromApiOptions = {},
): ImportApiResult {
	const state = beginApiImport(database, options);
	const result = runUnitOfWork(
		database,
		(unitOfWork) => {
			applyBatchIn(unitOfWork, state, apiNodes);
			return finishIn(unitOfWork, state, options.treeItems);
		},
		formatTemporalTimestamp(state.importTimestamp),
	);
	metadataComparisonStats.log();
	if (state.validationErrors > 0) {
		state.logger?.warn(`Encountered ${state.validationErrors} validation errors during import`);
	}
	return result;
}
