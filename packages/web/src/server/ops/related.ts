import {z} from "zod";
import {notAMirror, PathBuilder} from "@workflowy/shared/cache";
import {and, count, eq, ne, sql} from "drizzle-orm";
import {nodeContent, nodeEmbeddings} from "@workflowy/shared/db";
import type {AppDatabase} from "@workflowy/shared/db";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {stripHtmlTags} from "@workflowy/shared/html";
import {defineOp, fail, jsonOf, ok} from "./define.js";

type RelatedType = "similar" | "parent-candidates" | "link-targets";

interface RelatedNode {
	id: string;
	name: string | null;
	note: string | null;
	distance: number;
	path: string[];
}

interface RelatedResponse {
	results: RelatedNode[];
}

/** Fill each node's ancestor path in one batched PathBuilder query. */
function fillPaths(database: AppDatabase, nodes: RelatedNode[]): void {
	const parts = new PathBuilder(database).buildFullPathPartsBatch(nodes.map((n) => n.id));
	for (const node of nodes) {
		node.path = parts.get(node.id) ?? [];
	}
}

function findSimilarNodes(
	database: AppDatabase,
	sourceEmbedding: Buffer,
	sourceNodeId: string,
	model: string,
	limit: number,
	threshold: number,
): RelatedNode[] {
	const results = database
		.select({
			nodeId: nodeEmbeddings.nodeId,
			distance: sql<number>`vec_distance_cosine(${nodeEmbeddings.embedding}, vec_f32(${sourceEmbedding}))`,
			name: nodeContent.name,
			note: nodeContent.note,
		})
		.from(nodeEmbeddings)
		.innerJoin(
			nodeContent,
			and(eq(nodeEmbeddings.nodeId, nodeContent.id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)),
		)
		.where(
			and(
				eq(nodeEmbeddings.model, model),
				eq(nodeEmbeddings.systemTo, FAR_FUTURE_DATE),
				notAMirror(nodeContent.id),
				ne(nodeEmbeddings.nodeId, sourceNodeId),
				sql`vec_distance_cosine(${nodeEmbeddings.embedding}, vec_f32(${sourceEmbedding})) < ${threshold}`,
			),
		)
		.orderBy(sql`vec_distance_cosine(${nodeEmbeddings.embedding}, vec_f32(${sourceEmbedding}))`)
		.limit(limit)
		.all();

	const nodes: RelatedNode[] = results.map((result) => ({
		id: result.nodeId,
		name: result.name,
		note: result.note,
		distance: result.distance,
		path: [],
	}));
	fillPaths(database, nodes);
	return nodes;
}

function findParentCandidates(
	database: AppDatabase,
	sourceEmbedding: Buffer,
	sourceNodeId: string,
	model: string,
	limit: number,
	threshold: number,
): RelatedNode[] {
	// Parent candidates are nodes that:
	// 1. Are semantically similar to the source
	// 2. Already have children (are likely container nodes)
	// 3. Are not the source node itself or its ancestors/descendants

	// Get current parent chain to exclude
	const ancestors = new Set<string>();
	let currentId: string | null = sourceNodeId;
	while (currentId) {
		ancestors.add(currentId);
		const node = database
			.select({parentId: nodeContent.parentId})
			.from(nodeContent)
			.where(and(eq(nodeContent.id, currentId), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
			.get();
		currentId = node?.parentId ?? null;
	}

	// Find similar nodes that have children
	const results = database
		.select({
			nodeId: nodeEmbeddings.nodeId,
			distance: sql<number>`vec_distance_cosine(${nodeEmbeddings.embedding}, vec_f32(${sourceEmbedding}))`,
			name: nodeContent.name,
			note: nodeContent.note,
		})
		.from(nodeEmbeddings)
		.innerJoin(
			nodeContent,
			and(eq(nodeEmbeddings.nodeId, nodeContent.id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)),
		)
		.where(
			and(
				eq(nodeEmbeddings.model, model),
				eq(nodeEmbeddings.systemTo, FAR_FUTURE_DATE),
				notAMirror(nodeContent.id),
				ne(nodeEmbeddings.nodeId, sourceNodeId),
				sql`vec_distance_cosine(${nodeEmbeddings.embedding}, vec_f32(${sourceEmbedding})) < ${threshold}`,
			),
		)
		.orderBy(sql`vec_distance_cosine(${nodeEmbeddings.embedding}, vec_f32(${sourceEmbedding}))`)
		.limit(limit * 3) // Fetch more since we'll filter
		.all();

	// Filter and enhance results
	const candidates: RelatedNode[] = [];
	for (const result of results) {
		if (ancestors.has(result.nodeId)) {
			continue;
		}

		// Check if this node has children (makes it a good parent candidate)
		const childCount = database
			.select({count: count()})
			.from(nodeContent)
			.where(and(eq(nodeContent.parentId, result.nodeId), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
			.get();

		if (childCount && childCount.count > 0) {
			candidates.push({
				id: result.nodeId,
				name: result.name,
				note: result.note,
				distance: result.distance,
				path: [],
			});

			if (candidates.length >= limit) {
				break;
			}
		}
	}

	fillPaths(database, candidates);
	return candidates;
}

function findLinkTargets(
	database: AppDatabase,
	sourceEmbedding: Buffer,
	sourceNodeId: string,
	model: string,
	limit: number,
	threshold: number,
): RelatedNode[] {
	// Link targets prioritize nodes with meaningful names (not just empty/bullet points)
	// and are not the source node itself
	const results = database
		.select({
			nodeId: nodeEmbeddings.nodeId,
			distance: sql<number>`vec_distance_cosine(${nodeEmbeddings.embedding}, vec_f32(${sourceEmbedding}))`,
			name: nodeContent.name,
			note: nodeContent.note,
		})
		.from(nodeEmbeddings)
		.innerJoin(
			nodeContent,
			and(eq(nodeEmbeddings.nodeId, nodeContent.id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)),
		)
		.where(
			and(
				eq(nodeEmbeddings.model, model),
				eq(nodeEmbeddings.systemTo, FAR_FUTURE_DATE),
				notAMirror(nodeContent.id),
				ne(nodeEmbeddings.nodeId, sourceNodeId),
				sql`vec_distance_cosine(${nodeEmbeddings.embedding}, vec_f32(${sourceEmbedding})) < ${threshold}`,
			),
		)
		.orderBy(sql`vec_distance_cosine(${nodeEmbeddings.embedding}, vec_f32(${sourceEmbedding}))`)
		.limit(limit * 2) // Fetch more to filter empty names
		.all();

	// Filter to nodes with meaningful names
	const targets: RelatedNode[] = [];
	for (const result of results) {
		const plainName = result.name ? stripHtmlTags(result.name) : "";
		if (plainName.length > 0) {
			targets.push({
				id: result.nodeId,
				name: result.name,
				note: result.note,
				distance: result.distance,
				path: [],
			});

			if (targets.length >= limit) {
				break;
			}
		}
	}

	fillPaths(database, targets);
	return targets;
}

/** Finds related nodes using semantic similarity; the required fields are validated here so each 400 names what is missing. */
export const relatedFind = defineOp({
	input: z.object({
		nodeId: z.string().optional(),
		type: z.string().optional(),
		limit: z.number().optional(),
		threshold: z.number().optional(),
		model: z.string().optional(),
	}),
	run(ctx, {nodeId, type, limit = 10, threshold = 0.5, model = "minilm"}) {
		if (!nodeId) {
			return fail(400, {error: "nodeId is required"});
		}

		if (!type) {
			return fail(400, {error: "type is required"});
		}

		const validTypes: RelatedType[] = ["similar", "parent-candidates", "link-targets"];
		const relatedType = validTypes.find((valid) => valid === type);
		if (!relatedType) {
			return fail(400, {error: `type must be one of: ${validTypes.join(", ")}`});
		}

		// Without embeddings (no vector extension) there is nothing to rank: the empty result clients already handle.
		const {db: database, config} = ctx;
		if (!config.features.embeddings) {
			const empty: RelatedResponse = {results: []};
			return ok(jsonOf(empty));
		}

		// Get the source node's embedding
		const sourceEmbedding = database
			.select({embedding: nodeEmbeddings.embedding})
			.from(nodeEmbeddings)
			.where(
				and(
					eq(nodeEmbeddings.nodeId, nodeId),
					eq(nodeEmbeddings.model, model),
					eq(nodeEmbeddings.systemTo, FAR_FUTURE_DATE),
				),
			)
			.get();

		if (!sourceEmbedding) {
			return fail(404, {error: "Node embedding not found. Ensure embeddings have been generated."});
		}

		const embeddingBuffer = sourceEmbedding.embedding;

		let results: RelatedNode[];

		switch (relatedType) {
			case "similar": {
				results = findSimilarNodes(database, embeddingBuffer, nodeId, model, limit, threshold);
				break;
			}
			case "parent-candidates": {
				results = findParentCandidates(database, embeddingBuffer, nodeId, model, limit, threshold);
				break;
			}
			case "link-targets": {
				results = findLinkTargets(database, embeddingBuffer, nodeId, model, limit, threshold);
				break;
			}
		}

		const response: RelatedResponse = {results};
		return ok(jsonOf(response));
	},
});
