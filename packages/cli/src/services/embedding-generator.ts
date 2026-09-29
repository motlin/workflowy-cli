import {mirrors, nodeContent, type NodeContentType, nodeEmbeddings} from '@workflowy/shared/db';
import * as schema from '@workflowy/shared/db';
import {FAR_FUTURE_DATE, formatTemporalTimestamp} from '@workflowy/shared/temporal';
import {and, eq, inArray, sql} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {DEFAULT_MODELS, type EmbeddingModelKey, embeddingService} from './embeddings.js';
import {notAMirror, PathBuilder} from '@workflowy/shared/cache';

/**
 * The current nodes worth indexing: those with children, excluding mirrors,
 * which have no text of their own (their original is indexed instead).
 */
export async function loadEmbeddableNodes(
	database: BetterSQLite3Database<typeof schema>,
	pathBuilder = new PathBuilder(database),
): Promise<NodeContentType[]> {
	const currentNodes = database
		.select()
		.from(nodeContent)
		.where(and(eq(nodeContent.systemTo, FAR_FUTURE_DATE), notAMirror(nodeContent.id)))
		.all();
	const nonLeafIds = await pathBuilder.getNonLeafNodeIds(currentNodes.map((n) => n.id));
	return currentNodes.filter((node) => nonLeafIds.has(node.id));
}

/** Delete every embedding, of any model or version, keyed to a current mirror. Returns the count. */
function pruneMirrorEmbeddings(database: BetterSQLite3Database<typeof schema>): number {
	return database
		.delete(nodeEmbeddings)
		.where(
			inArray(
				nodeEmbeddings.nodeId,
				database.select({id: mirrors.mirrorId}).from(mirrors).where(eq(mirrors.systemTo, FAR_FUTURE_DATE)),
			),
		)
		.run().changes;
}

export type EmbeddingGeneratorOptions = {
	batchSize: number;
	force: boolean;
	model?: EmbeddingModelKey;
};

export type EmbeddingGeneratorProgress = {
	processed: number;
	total: number;
	elapsed: number;
	estimatedRemaining: number;
	currentModel: EmbeddingModelKey;
	message?: string;
};

export type EmbeddingGeneratorResult = {
	totalProcessed: number;
	totalTime: number;
	alreadyComplete: boolean;
	modelStats: Map<EmbeddingModelKey, {needed: number; processed: number}>;
};

export class EmbeddingGeneratorService {
	private database: BetterSQLite3Database<typeof schema>;
	private pathBuilder: PathBuilder;

	constructor(database: BetterSQLite3Database<typeof schema>) {
		this.database = database;
		this.pathBuilder = new PathBuilder(database);
	}

	async generateEmbeddings(
		options: EmbeddingGeneratorOptions,
		onProgress?: (progress: EmbeddingGeneratorProgress) => void,
	): Promise<EmbeddingGeneratorResult> {
		const modelsToProcess: EmbeddingModelKey[] = options.model ? [options.model] : DEFAULT_MODELS;

		const pruned = pruneMirrorEmbeddings(this.database);
		if (pruned > 0) {
			onProgress?.({
				processed: 0,
				total: 0,
				elapsed: 0,
				estimatedRemaining: 0,
				currentModel: modelsToProcess[0],
				message: `🧹 Pruned ${pruned} embeddings of mirror nodes`,
			});
		}

		if (options.force) {
			for (const model of modelsToProcess) {
				this.database
					.delete(nodeEmbeddings)
					.where(and(eq(nodeEmbeddings.model, model), eq(nodeEmbeddings.systemTo, FAR_FUTURE_DATE)))
					.run();
			}
		}

		const nonLeafNodes = await loadEmbeddableNodes(this.database, this.pathBuilder);

		// Populate FTS5 index with all non-leaf nodes (independent of model selection)
		await this.populateFts(nonLeafNodes, onProgress);

		const nodesToProcessByModel = await this.calculateNodesToProcess(modelsToProcess, nonLeafNodes);
		const totalToProcess = [...nodesToProcessByModel.values()].reduce((sum, nodeList) => sum + nodeList.length, 0);

		const modelStats = new Map<EmbeddingModelKey, {needed: number; processed: number}>();
		for (const model of modelsToProcess) {
			const nodes = nodesToProcessByModel.get(model) ?? [];
			modelStats.set(model, {needed: nodes.length, processed: 0});
		}

		onProgress?.({
			processed: 0,
			total: totalToProcess,
			elapsed: 0,
			estimatedRemaining: 0,
			currentModel: modelsToProcess[0],
			message: `📊 ${nonLeafNodes.length} nodes (leaf nodes and mirrors skipped), ${modelsToProcess.length} models. Need embeddings: ${[...modelStats.entries()].map(([m, s]) => `${m}=${s.needed}`).join(', ')}`,
		});

		if (totalToProcess === 0) {
			return {
				totalProcessed: 0,
				totalTime: 0,
				alreadyComplete: true,
				modelStats,
			};
		}

		onProgress?.({
			processed: 0,
			total: totalToProcess,
			elapsed: 0,
			estimatedRemaining: 0,
			currentModel: modelsToProcess[0],
			message: `🤖 Initializing ${modelsToProcess.length === 1 ? `model "${modelsToProcess[0]}"` : 'default models'}...`,
		});

		const startTime = Date.now();
		let totalProcessed = 0;

		for (const model of modelsToProcess) {
			const nodesToProcess = nodesToProcessByModel.get(model) ?? [];
			const stats = modelStats.get(model)!;

			if (nodesToProcess.length === 0) {
				continue;
			}

			onProgress?.({
				processed: totalProcessed,
				total: totalToProcess,
				elapsed: (Date.now() - startTime) / 1000,
				estimatedRemaining: 0,
				currentModel: model,
				message: `🔄 Starting ${model}: ${nodesToProcess.length} nodes to process`,
			});

			// Pre-fetch all paths, content, and children in batch (O(depth) queries instead of O(nodes × depth))
			const nodeIds = nodesToProcess.map((n) => n.id);
			const [pathMap, contentMap, childrenMap] = await Promise.all([
				this.pathBuilder.buildFullPathsBatch(nodeIds),
				this.pathBuilder.buildTextContentBatch(nodeIds),
				this.pathBuilder.buildChildrenTextBatch(nodeIds),
			]);

			for (let index = 0; index < nodesToProcess.length; index += options.batchSize) {
				const batch = nodesToProcess.slice(index, index + options.batchSize);
				const nowStr = formatTemporalTimestamp(new Date());

				const embeddingRows: Array<{
					nodeId: string;
					model: EmbeddingModelKey;
					embedding: Buffer;
					systemFrom: string;
					systemTo: string;
				}> = [];

				for (const node of batch) {
					const fullPath = pathMap.get(node.id) ?? '';
					const textContent = contentMap.get(node.id) ?? '';
					const childrenText = childrenMap.get(node.id) ?? '';

					const combinedText = childrenText
						? `PATH: ${fullPath}\nCONTENT: ${textContent}\nCHILDREN:\n${childrenText}`
						: `PATH: ${fullPath}\nCONTENT: ${textContent}`;
					const embedding = await embeddingService.generateEmbedding(combinedText, model, {isQuery: false});

					embeddingRows.push({
						nodeId: node.id,
						model,
						embedding: Buffer.from(embedding.buffer),
						systemFrom: nowStr,
						systemTo: FAR_FUTURE_DATE,
					});

					totalProcessed++;
					stats.processed++;

					if (onProgress && totalProcessed % 10 === 0) {
						const elapsed = (Date.now() - startTime) / 1000;
						const rate = totalProcessed / elapsed;
						const remaining = Math.ceil((totalToProcess - totalProcessed) / rate);

						onProgress({
							processed: totalProcessed,
							total: totalToProcess,
							elapsed,
							estimatedRemaining: remaining,
							currentModel: model,
						});
					}
				}

				if (embeddingRows.length > 0) {
					this.database.insert(nodeEmbeddings).values(embeddingRows).run();
				}
			}

			onProgress?.({
				processed: totalProcessed,
				total: totalToProcess,
				elapsed: (Date.now() - startTime) / 1000,
				estimatedRemaining: 0,
				currentModel: model,
				message: `✅ Finished ${model}: ${stats.processed} embeddings generated`,
			});
		}

		const totalTime = (Date.now() - startTime) / 1000;

		return {
			totalProcessed,
			totalTime,
			alreadyComplete: false,
			modelStats,
		};
	}

	private async populateFts(
		nonLeafNodes: {id: string; name: string | null}[],
		onProgress?: (progress: EmbeddingGeneratorProgress) => void,
	): Promise<void> {
		const nodeIds = nonLeafNodes.map((n) => n.id);

		// Check if FTS5 table exists
		const tableExists = this.database.all(
			sql`SELECT name FROM sqlite_master WHERE type='table' AND name='node_fts'`,
		);
		if (tableExists.length === 0) return;

		const [pathMap, contentMap, childrenMap] = await Promise.all([
			this.pathBuilder.buildFullPathsBatch(nodeIds),
			this.pathBuilder.buildTextContentBatch(nodeIds),
			this.pathBuilder.buildChildrenTextBatch(nodeIds),
		]);

		// Clear and repopulate FTS index
		this.database.run(sql`DELETE FROM node_fts`);

		let populated = 0;
		for (const node of nonLeafNodes) {
			const fullPath = pathMap.get(node.id) ?? '';
			const textContent = contentMap.get(node.id) ?? '';
			const childrenText = childrenMap.get(node.id) ?? '';

			const combinedText = childrenText
				? `PATH: ${fullPath}\nCONTENT: ${textContent}\nCHILDREN:\n${childrenText}`
				: `PATH: ${fullPath}\nCONTENT: ${textContent}`;

			this.database.run(sql`INSERT INTO node_fts(node_id, content) VALUES(${node.id}, ${combinedText})`);
			populated++;
		}

		onProgress?.({
			processed: 0,
			total: 0,
			elapsed: 0,
			estimatedRemaining: 0,
			currentModel: 'minilm' as EmbeddingModelKey,
			message: `FTS5 index populated with ${populated} nodes`,
		});
	}

	private async calculateNodesToProcess(
		models: EmbeddingModelKey[],
		currentNodes: {id: string}[],
	): Promise<Map<EmbeddingModelKey, {id: string}[]>> {
		const result = new Map<EmbeddingModelKey, {id: string}[]>();

		for (const model of models) {
			const existingEmbeddings = this.database
				.select({nodeId: nodeEmbeddings.nodeId})
				.from(nodeEmbeddings)
				.where(and(eq(nodeEmbeddings.model, model), eq(nodeEmbeddings.systemTo, FAR_FUTURE_DATE)))
				.all();

			const existingIds = new Set(existingEmbeddings.map((embedding) => embedding.nodeId));
			const nodesToProcess = currentNodes.filter((node) => !existingIds.has(node.id));
			result.set(model, nodesToProcess);
		}

		return result;
	}
}
