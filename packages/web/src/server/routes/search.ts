import {Hono} from 'hono';
import {PathBuilder} from '@workflowy/shared/cache';
import {nodeContent, nodeMetadata} from '@workflowy/shared/db';
import {buildSearchConditions, getScoringTerms, parseSearchQuery} from '@workflowy/shared/search';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import {stripHtmlTags} from '@workflowy/shared/html';
import {and, eq, inArray, sql} from 'drizzle-orm';
import {getDatabase} from '../db.js';

export const searchRouter = new Hono();

interface SearchBody {
	query: string;
	limit?: number;
	offset?: number;
	parentId?: string;
}

interface SearchResult {
	id: string;
	name: string | null;
	note: string | null;
	parentPath: string;
}

// Get all descendant node IDs using a recursive CTE
async function getDescendantIds(database: ReturnType<typeof getDatabase>, parentId: string): Promise<string[]> {
	const result = database.all<{id: string}>(sql`
		WITH RECURSIVE descendants(id) AS (
			SELECT id FROM node_content
			WHERE parent_id = ${parentId}
			AND system_to = ${FAR_FUTURE_DATE}
			UNION ALL
			SELECT n.id FROM node_content n
			INNER JOIN descendants d ON n.parent_id = d.id
			WHERE n.system_to = ${FAR_FUTURE_DATE}
		)
		SELECT id FROM descendants
	`);
	return result.map((row) => row.id);
}

// POST /api/search - Text-based search with operators
searchRouter.post('/', async (c) => {
	const body = (await c.req.json()) as SearchBody;
	const {query, limit = 10, offset = 0, parentId} = body;

	if (!query || query.trim().length === 0) {
		return c.json({results: [], totalCount: 0});
	}

	const database = getDatabase();
	const parsed = parseSearchQuery(query);
	const {contentConditions, metadataConditions, needsMetadataJoin} = buildSearchConditions(parsed);

	// If parentId is provided, limit search to descendants of that node
	if (parentId) {
		const descendantIds = await getDescendantIds(database, parentId);
		if (descendantIds.length === 0) {
			return c.json({results: [], totalCount: 0});
		}
		contentConditions.push(inArray(nodeContent.id, descendantIds));
	}

	// Build combined WHERE clause
	const allConditions = [...contentConditions];
	if (needsMetadataJoin) {
		// Add metadata join condition and metadata filters
		allConditions.push(
			eq(nodeMetadata.nodeId, nodeContent.id),
			eq(nodeMetadata.systemTo, FAR_FUTURE_DATE),
			...metadataConditions,
		);
	}

	let totalCount: number;
	let allResults: {id: string; name: string | null; note: string | null}[];

	if (needsMetadataJoin) {
		// Query with metadata join for completion/date filters
		const countResult = database
			.select({count: sql<number>`count(*)`})
			.from(nodeContent)
			.innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodeContent.id))
			.where(and(...allConditions))
			.get();
		totalCount = countResult?.count ?? 0;

		allResults = database
			.select({
				id: nodeContent.id,
				name: nodeContent.name,
				note: nodeContent.note,
			})
			.from(nodeContent)
			.innerJoin(nodeMetadata, eq(nodeMetadata.nodeId, nodeContent.id))
			.where(and(...allConditions))
			.all();
	} else {
		// Simple query without metadata join
		const countResult = database
			.select({count: sql<number>`count(*)`})
			.from(nodeContent)
			.where(and(...contentConditions))
			.get();
		totalCount = countResult?.count ?? 0;

		allResults = database
			.select({
				id: nodeContent.id,
				name: nodeContent.name,
				note: nodeContent.note,
			})
			.from(nodeContent)
			.where(and(...contentConditions))
			.all();
	}

	// Get terms for scoring
	const scoringTerms = getScoringTerms(parsed);

	// Score results based on match quality
	const scoredResults = allResults.map((result) => {
		const namePlain = result.name ? stripHtmlTags(result.name).toLowerCase() : '';
		const notePlain = result.note ? stripHtmlTags(result.note).toLowerCase() : '';

		let score = 0;

		if (scoringTerms.length === 0) {
			// No text terms to match, all results get base score
			score = 50;
		} else {
			// Score based on how well terms match
			for (const term of scoringTerms) {
				const termLower = term.toLowerCase();
				if (namePlain === termLower) {
					score += 100;
				} else if (namePlain.startsWith(termLower)) {
					score += 80;
				} else if (namePlain.includes(termLower)) {
					score += 60;
				} else if (notePlain.includes(termLower)) {
					score += 40;
				}
			}
		}

		return {...result, score};
	});

	// Sort by score descending
	scoredResults.sort((a, b) => b.score - a.score);

	// Apply pagination after scoring and sorting
	const paginatedResults = scoredResults.slice(offset, offset + limit);

	// Build parent paths in two batched queries (parentId lookup + PathBuilder) rather
	// than walking the ancestor chain per result. The parent path excludes the result
	// node itself, so it is the full path of the node's parent.
	const parentIdOf = new Map<string, string | null>(
		database
			.select({id: nodeContent.id, parentId: nodeContent.parentId})
			.from(nodeContent)
			.where(
				and(
					inArray(
						nodeContent.id,
						paginatedResults.map((r) => r.id),
					),
					eq(nodeContent.systemTo, FAR_FUTURE_DATE),
				),
			)
			.all()
			.map((row) => [row.id, row.parentId]),
	);
	const parentIds = [...new Set([...parentIdOf.values()].filter((id): id is string => id !== null))];
	const pathByParent = await new PathBuilder(database).buildFullPathsBatch(parentIds);

	const results: SearchResult[] = paginatedResults.map(({id, name, note}) => {
		const parentId = parentIdOf.get(id) ?? null;
		return {id, name, note, parentPath: parentId ? (pathByParent.get(parentId) ?? '') : ''};
	});

	return c.json({results, totalCount});
});
