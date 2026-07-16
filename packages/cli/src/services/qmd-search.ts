import {nodeContent} from '@workflowy/shared/db';
import * as schema from '@workflowy/shared/db';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import {and, eq} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {existsSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {createHash} from 'node:crypto';
import {
	createStore,
	type EmbedProgress,
	type EmbedResult,
	type HybridQueryResult,
	type SearchResult as QmdSearchResult,
	type QMDStore,
} from '@tobilu/qmd';
import {PathBuilder} from '@workflowy/shared/cache';
import {logger} from './logger.js';

function hashContent(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

const COLLECTION_NAME = 'workflowy';
const QMD_DB_DIR = '.cache/qmd';
const QMD_DB_FILE = 'workflowy.sqlite';

export type QmdSearchMode = 'hybrid' | 'vector' | 'keyword';

export type QmdSearchOptions = {
	query: string;
	limit?: number;
	minScore?: number;
	mode?: QmdSearchMode;
};

export type QmdSyncResult = {
	inserted: number;
	updated: number;
	unchanged: number;
	deactivated: number;
	totalTime: number;
};

export type QmdSearchResultItem = {
	id: string;
	name: string;
	note: string | null | undefined;
	priority: number;
	completed: boolean;
	createdAt: number;
	modifiedAt: number;
	completedAt: number | null;
	data: Record<string, unknown>;
	nodeId: string;
	fullPath: string;
	textContent: string;
	score: number;
};

function extractNodeId(virtualPath: string): string {
	// qmd virtual paths are like: qmd://workflowy/node-uuid
	const prefix = `qmd://${COLLECTION_NAME}/`;
	if (virtualPath.startsWith(prefix)) {
		return virtualPath.slice(prefix.length);
	}
	return virtualPath;
}

export class QmdSearchService {
	private database: BetterSQLite3Database<typeof schema>;
	private pathBuilder: PathBuilder;
	private store: QMDStore | null = null;

	constructor(database: BetterSQLite3Database<typeof schema>) {
		this.database = database;
		this.pathBuilder = new PathBuilder(database);
	}

	private getDbPath(): string {
		return join(QMD_DB_DIR, QMD_DB_FILE);
	}

	private async getStore(): Promise<QMDStore> {
		if (this.store) return this.store;

		const dbPath = this.getDbPath();
		const dir = dirname(dbPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, {recursive: true});
		}

		this.store = await createStore({
			dbPath,
			config: {
				collections: {
					[COLLECTION_NAME]: {
						path: '/virtual/workflowy',
						pattern: '**/*',
					},
				},
			},
		});

		return this.store;
	}

	async syncNodes(onProgress?: (message: string) => void): Promise<QmdSyncResult> {
		const startTime = Date.now();
		const store = await this.getStore();
		const {internal} = store;

		const currentNodes = this.database
			.select()
			.from(nodeContent)
			.where(eq(nodeContent.systemTo, FAR_FUTURE_DATE))
			.all();

		const allNodeIds = currentNodes.map((n) => n.id);
		const nonLeafIds = await this.pathBuilder.getNonLeafNodeIds(allNodeIds);
		const nonLeafNodes = currentNodes.filter((node) => nonLeafIds.has(node.id));

		onProgress?.(
			`Found ${nonLeafNodes.length} non-leaf nodes (${currentNodes.length - nonLeafNodes.length} leaf nodes skipped)`,
		);

		const nodeIds = nonLeafNodes.map((n) => n.id);
		const [pathMap, contentMap, childrenMap] = await Promise.all([
			this.pathBuilder.buildFullPathsBatch(nodeIds),
			this.pathBuilder.buildTextContentBatch(nodeIds),
			this.pathBuilder.buildChildrenTextBatch(nodeIds),
		]);

		let inserted = 0;
		let updated = 0;
		let unchanged = 0;
		const now = new Date().toISOString();
		const processedPaths = new Set<string>();

		for (let i = 0; i < nonLeafNodes.length; i++) {
			const node = nonLeafNodes[i];
			const fullPath = pathMap.get(node.id) ?? '';
			const textContent = contentMap.get(node.id) ?? '';
			const childrenText = childrenMap.get(node.id) ?? '';

			const combinedText = childrenText
				? `PATH: ${fullPath}\nCONTENT: ${textContent}\nCHILDREN:\n${childrenText}`
				: `PATH: ${fullPath}\nCONTENT: ${textContent}`;

			const nodePath = node.id;
			processedPaths.add(nodePath);
			const nodeName = node.name ?? '';

			const hash = hashContent(combinedText);

			const existing = internal.findActiveDocument(COLLECTION_NAME, nodePath);

			if (existing) {
				if (existing.hash === hash) {
					unchanged++;
					continue;
				}

				internal.insertContent(hash, combinedText, now);
				internal.updateDocument(existing.id, nodeName, hash, now);
				updated++;
			} else {
				internal.insertContent(hash, combinedText, now);
				internal.insertDocument(COLLECTION_NAME, nodePath, nodeName, hash, now, now);
				inserted++;
			}

			if ((i + 1) % 100 === 0) {
				onProgress?.(`Synced ${i + 1}/${nonLeafNodes.length} nodes...`);
			}
		}

		const activePaths = internal.getActiveDocumentPaths(COLLECTION_NAME);
		let deactivated = 0;
		for (const path of activePaths) {
			if (!processedPaths.has(path)) {
				internal.deactivateDocument(COLLECTION_NAME, path);
				deactivated++;
			}
		}

		const totalTime = (Date.now() - startTime) / 1000;

		logger.debug(
			`qmd sync: ${inserted} inserted, ${updated} updated, ${unchanged} unchanged, ${deactivated} deactivated in ${totalTime.toFixed(1)}s`,
		);

		return {inserted, updated, unchanged, deactivated, totalTime};
	}

	async embed(options?: {force?: boolean}, onProgress?: (info: EmbedProgress) => void): Promise<EmbedResult> {
		const store = await this.getStore();
		return store.embed({
			force: options?.force,
			onProgress,
		});
	}

	async search(options: QmdSearchOptions): Promise<QmdSearchResultItem[]> {
		const {query, limit = 5, minScore, mode = 'hybrid'} = options;
		const store = await this.getStore();

		let rawResults: Array<{nodeId: string; score: number}>;

		switch (mode) {
			case 'hybrid': {
				const results: HybridQueryResult[] = await store.search({
					query,
					limit,
					minScore,
					collection: COLLECTION_NAME,
				});
				rawResults = results.map((r) => ({
					nodeId: extractNodeId(r.file),
					score: r.score,
				}));
				break;
			}

			case 'keyword': {
				const results: QmdSearchResult[] = await store.searchLex(query, {
					limit,
					collection: COLLECTION_NAME,
				});
				rawResults = results.map((r) => ({
					nodeId: extractNodeId(r.filepath),
					score: r.score,
				}));
				break;
			}

			case 'vector': {
				const results: QmdSearchResult[] = await store.searchVector(query, {
					limit,
					collection: COLLECTION_NAME,
				});
				rawResults = results.map((r) => ({
					nodeId: extractNodeId(r.filepath),
					score: r.score,
				}));
				break;
			}
		}

		return this.enrichResults(rawResults);
	}

	async close(): Promise<void> {
		if (this.store) {
			await this.store.close();
			this.store = null;
		}
	}

	private async enrichResults(rawResults: Array<{nodeId: string; score: number}>): Promise<QmdSearchResultItem[]> {
		const enriched: QmdSearchResultItem[] = [];

		for (const raw of rawResults) {
			const {nodeId} = raw;

			const [fullPath, textContent] = await Promise.all([
				this.pathBuilder.buildFullPath(nodeId),
				this.pathBuilder.buildTextContent(nodeId),
			]);

			const nodeWithRelations = this.database.query.nodeContent
				.findFirst({
					where: and(eq(schema.nodeContent.id, nodeId), eq(schema.nodeContent.systemTo, FAR_FUTURE_DATE)),
					with: {
						metadata: true,
						aiMetadata: true,
						referencesRoot: true,
					},
				})
				.sync();

			if (!nodeWithRelations) continue;

			const priority = nodeWithRelations.metadata?.priority ?? 0;
			const data: Record<string, unknown> = {};

			if (nodeWithRelations.metadata?.layoutMode) {
				data.layoutMode = nodeWithRelations.metadata.layoutMode;
			}

			if (nodeWithRelations.referencesRoot) {
				data.isReferencesRoot = true;
			}

			if (nodeWithRelations.aiMetadata) {
				data.ai = {
					inChat: Boolean(nodeWithRelations.aiMetadata.inChat),
				};
			}

			enriched.push({
				id: nodeWithRelations.id,
				name: nodeWithRelations.name || '',
				note: nodeWithRelations.note,
				priority,
				completed: nodeWithRelations.metadata?.completedAt !== null,
				createdAt: nodeWithRelations.metadata?.createdAt
					? Math.floor(nodeWithRelations.metadata.createdAt.getTime() / 1000)
					: 0,
				modifiedAt: nodeWithRelations.metadata?.modifiedAt
					? Math.floor(nodeWithRelations.metadata.modifiedAt.getTime() / 1000)
					: 0,
				completedAt: nodeWithRelations.metadata?.completedAt
					? Math.floor(nodeWithRelations.metadata.completedAt.getTime() / 1000)
					: null,
				data,
				nodeId,
				fullPath,
				textContent,
				score: raw.score,
			});
		}

		return enriched;
	}
}
