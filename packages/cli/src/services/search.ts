import {nodeEmbeddings} from '@workflowy/shared/db';
import * as schema from '@workflowy/shared/db';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import type {WorkflowyNode} from '@workflowy/shared/types';
import {and, eq, sql} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {EMBEDDING_MODELS, type EmbeddingModelKey, embeddingService} from './embeddings.js';
import {logger} from './logger.js';
import {PathBuilder} from '@workflowy/shared/cache';

export type SearchMode = 'vector' | 'keyword' | 'hybrid';

export type SearchOptions = {
	query: string;
	limit?: number;
	threshold?: number;
	model?: EmbeddingModelKey;
	mode?: SearchMode;
};

export type SearchResult = WorkflowyNode & {
	completed: boolean;
	completedAt: number | null;
	nodeId: string;
	fullPath: string;
	textContent: string;
	distance: number;
};

export class SearchService {
	private database: BetterSQLite3Database<typeof schema>;
	private pathBuilder: PathBuilder;

	constructor(database: BetterSQLite3Database<typeof schema>) {
		this.database = database;
		this.pathBuilder = new PathBuilder(database);
	}

	async search(options: SearchOptions): Promise<SearchResult[]> {
		const {query, limit = 5, mode = 'vector'} = options;

		switch (mode) {
			case 'vector': {
				return this.searchVector(options);
			}
			case 'keyword': {
				return this.searchKeyword(query, limit);
			}
			case 'hybrid': {
				return this.searchHybrid(options);
			}
		}
	}

	private async searchVector(options: SearchOptions): Promise<SearchResult[]> {
		const {query, limit = 5, model = 'minilm'} = options;
		const modelConfig = EMBEDDING_MODELS[model];
		const threshold = options.threshold ?? modelConfig.defaultThreshold;

		const queryEmbedding = await embeddingService.generateEmbedding(query, model, {isQuery: true});
		const queryBuffer = Buffer.from(queryEmbedding.buffer);

		const searchResults = this.database
			.select({
				nodeId: nodeEmbeddings.nodeId,
				distance: sql<number>`vec_distance_cosine(${nodeEmbeddings.embedding}, vec_f32(${queryBuffer}))`,
				id: schema.nodeContent.id,
				name: schema.nodeContent.name,
				note: schema.nodeContent.note,
			})
			.from(nodeEmbeddings)
			.innerJoin(
				schema.nodeContent,
				and(eq(nodeEmbeddings.nodeId, schema.nodeContent.id), eq(schema.nodeContent.systemTo, FAR_FUTURE_DATE)),
			)
			.where(
				and(
					eq(nodeEmbeddings.model, model),
					eq(nodeEmbeddings.systemTo, FAR_FUTURE_DATE),
					sql`vec_distance_cosine(${nodeEmbeddings.embedding}, vec_f32(${queryBuffer})) < ${threshold}`,
				),
			)
			.orderBy(sql`vec_distance_cosine(${nodeEmbeddings.embedding}, vec_f32(${queryBuffer}))`)
			.limit(limit)
			.all();
		logger.logSqlResult('vectorSearch', searchResults);

		return this.enrichResults(searchResults.map((r) => ({nodeId: r.nodeId, distance: r.distance})));
	}

	private async searchKeyword(query: string, limit: number): Promise<SearchResult[]> {
		const ftsResults = this.database.all(
			sql`SELECT node_id, rank as score FROM node_fts WHERE node_fts MATCH ${query} ORDER BY rank LIMIT ${limit}`,
		) as Array<{node_id: string; score: number}>;
		logger.logSqlResult('ftsSearch', ftsResults);

		// FTS5 rank is negative (lower = better), convert to distance-like metric
		return this.enrichResults(
			ftsResults.map((r) => ({
				nodeId: r.node_id,
				distance: Math.abs(r.score) / (1 + Math.abs(r.score)),
			})),
		);
	}

	private async searchHybrid(options: SearchOptions): Promise<SearchResult[]> {
		const {query, limit = 5} = options;
		const k = 60; // RRF constant

		// Run vector and FTS5 in parallel
		const [vectorResults, ftsResults] = await Promise.all([
			this.searchVector({...options, limit: limit * 3}),
			this.searchKeyword(query, limit * 3),
		]);

		// Build RRF scores
		const rrfScores = new Map<string, {score: number; result: SearchResult}>();

		for (const [rank, result] of vectorResults.entries()) {
			const existing = rrfScores.get(result.nodeId);
			const contribution = 1 / (k + rank + 1);
			if (existing) {
				existing.score += contribution;
			} else {
				rrfScores.set(result.nodeId, {score: contribution, result});
			}
		}

		for (const [rank, result] of ftsResults.entries()) {
			const existing = rrfScores.get(result.nodeId);
			const contribution = 1 / (k + rank + 1);
			if (existing) {
				existing.score += contribution;
			} else {
				rrfScores.set(result.nodeId, {score: contribution, result});
			}
		}

		// Sort by RRF score descending, convert to distance (lower = better)
		const sorted = [...rrfScores.values()].sort((a, b) => b.score - a.score).slice(0, limit);

		return sorted.map(({result, score}) => ({
			...result,
			distance: 1 - score, // Convert RRF score to distance-like metric
		}));
	}

	private async enrichResults(rawResults: Array<{nodeId: string; distance: number}>): Promise<SearchResult[]> {
		return Promise.all(
			rawResults.map(async (result) => {
				const [fullPath, textContent] = await Promise.all([
					this.pathBuilder.buildFullPath(result.nodeId),
					this.pathBuilder.buildTextContent(result.nodeId),
				]);

				const nodeWithRelations = this.database.query.nodeContent
					.findFirst({
						where: and(
							eq(schema.nodeContent.id, result.nodeId),
							eq(schema.nodeContent.systemTo, FAR_FUTURE_DATE),
						),
						with: {
							metadata: true,
							aiMetadata: true,
							referencesRoot: true,
						},
					})
					.sync();
				logger.logSqlResult('nodeWithRelations', nodeWithRelations);

				const priority = nodeWithRelations?.metadata?.priority ?? 0;
				const data: Record<string, unknown> = {};

				if (nodeWithRelations?.metadata?.layoutMode) {
					data.layoutMode = nodeWithRelations.metadata.layoutMode;
				}

				if (nodeWithRelations?.referencesRoot) {
					data.isReferencesRoot = true;
				}

				if (nodeWithRelations?.aiMetadata) {
					data.ai = {
						inChat: Boolean(nodeWithRelations.aiMetadata.inChat),
					};
				}

				return {
					id: nodeWithRelations?.id || result.nodeId,
					name: nodeWithRelations?.name || '',
					note: nodeWithRelations?.note,
					priority,
					completed: nodeWithRelations?.metadata?.completedAt !== null,
					createdAt: nodeWithRelations?.metadata?.createdAt
						? Math.floor(nodeWithRelations.metadata.createdAt.getTime() / 1000)
						: 0,
					modifiedAt: nodeWithRelations?.metadata?.modifiedAt
						? Math.floor(nodeWithRelations.metadata.modifiedAt.getTime() / 1000)
						: 0,
					completedAt: nodeWithRelations?.metadata?.completedAt
						? Math.floor(nodeWithRelations.metadata.completedAt.getTime() / 1000)
						: null,
					data,
					nodeId: result.nodeId,
					fullPath,
					textContent,
					distance: result.distance,
				};
			}),
		);
	}
}
