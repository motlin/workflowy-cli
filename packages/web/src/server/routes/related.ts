import {Hono} from 'hono';
import {PathBuilder} from '@workflowy/shared/cache';
import {and, count, eq, ne, sql} from 'drizzle-orm';
import {nodeContent, nodeEmbeddings} from '@workflowy/shared/db';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import {stripHtmlTags} from '@workflowy/shared/html';
import {getDatabase} from '../db.js';

export const relatedRouter = new Hono();

type RelatedType = 'similar' | 'parent-candidates' | 'link-targets';

interface RelatedBody {
	nodeId: string;
	type: RelatedType;
	limit?: number;
	threshold?: number;
	model?: string;
}

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
async function fillPaths(database: ReturnType<typeof getDatabase>, nodes: RelatedNode[]): Promise<void> {
	const parts = await new PathBuilder(database).buildFullPathPartsBatch(nodes.map((n) => n.id));
	for (const node of nodes) {
		node.path = parts.get(node.id) ?? [];
	}
}

async function findSimilarNodes(
	database: ReturnType<typeof getDatabase>,
	sourceEmbedding: Buffer,
	sourceNodeId: string,
	model: string,
	limit: number,
	threshold: number,
): Promise<RelatedNode[]> {
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
	await fillPaths(database, nodes);
	return nodes;
}

async function findParentCandidates(
	database: ReturnType<typeof getDatabase>,
	sourceEmbedding: Buffer,
	sourceNodeId: string,
	model: string,
	limit: number,
	threshold: number,
): Promise<RelatedNode[]> {
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

	await fillPaths(database, candidates);
	return candidates;
}

async function findLinkTargets(
	database: ReturnType<typeof getDatabase>,
	sourceEmbedding: Buffer,
	sourceNodeId: string,
	model: string,
	limit: number,
	threshold: number,
): Promise<RelatedNode[]> {
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
		const plainName = result.name ? stripHtmlTags(result.name) : '';
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

	await fillPaths(database, targets);
	return targets;
}

// POST /api/related - Find related nodes using semantic similarity
relatedRouter.post('/', async (c) => {
	const body = (await c.req.json()) as RelatedBody;
	const {nodeId, type, limit = 10, threshold = 0.5, model = 'minilm'} = body;

	if (!nodeId) {
		return c.json({error: 'nodeId is required'}, 400);
	}

	if (!type) {
		return c.json({error: 'type is required'}, 400);
	}

	const validTypes: RelatedType[] = ['similar', 'parent-candidates', 'link-targets'];
	if (!validTypes.includes(type)) {
		return c.json({error: `type must be one of: ${validTypes.join(', ')}`}, 400);
	}

	const database = getDatabase();

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
		return c.json({error: 'Node embedding not found. Ensure embeddings have been generated.'}, 404);
	}

	const embeddingBuffer = sourceEmbedding.embedding as Buffer;

	let results: RelatedNode[];

	switch (type) {
		case 'similar': {
			results = await findSimilarNodes(database, embeddingBuffer, nodeId, model, limit, threshold);
			break;
		}
		case 'parent-candidates': {
			results = await findParentCandidates(database, embeddingBuffer, nodeId, model, limit, threshold);
			break;
		}
		case 'link-targets': {
			results = await findLinkTargets(database, embeddingBuffer, nodeId, model, limit, threshold);
			break;
		}
	}

	const response: RelatedResponse = {results};
	return c.json(response);
});
