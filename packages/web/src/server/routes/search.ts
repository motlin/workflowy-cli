import {Hono} from 'hono';
import {nodeContent, nodeMetadata} from '@workflowy/shared/db';
import {type ParsedQuery, parseSearchQuery} from '@workflowy/shared/search';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import {stripHtmlTags} from '@workflowy/shared/html';
import type {SQL} from 'drizzle-orm';
import {and, eq, gte, inArray, isNotNull, isNull, like, not, or, sql} from 'drizzle-orm';
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

// 🏗️ Build SQL WHERE conditions from parsed query
// Returns conditions for nodeContent table. Metadata filters (completedAt, modifiedAt)
// require joining with nodeMetadata table.
interface SearchConditions {
	contentConditions: SQL[];
	metadataConditions: SQL[];
	needsMetadataJoin: boolean;
}

function buildSearchConditions(parsed: ParsedQuery): SearchConditions {
	const contentConditions: SQL[] = [];
	const metadataConditions: SQL[] = [];

	// Always filter for current records
	contentConditions.push(eq(nodeContent.systemTo, FAR_FUTURE_DATE));

	// Exact phrases - must appear in name or note
	for (const phrase of parsed.exactPhrases) {
		const pattern = `%${phrase}%`;
		contentConditions.push(or(like(nodeContent.name, pattern), like(nodeContent.note, pattern))!);
	}

	// Required terms (AND) - all must appear in name or note
	for (const term of parsed.requiredTerms) {
		const pattern = `%${term}%`;
		contentConditions.push(or(like(nodeContent.name, pattern), like(nodeContent.note, pattern))!);
	}

	// OR terms - at least one group must match, within each group all terms must match
	if (parsed.orTerms.length > 0) {
		const orConditions: SQL[] = [];
		for (const termGroup of parsed.orTerms) {
			const groupConditions: SQL[] = [];
			for (const term of termGroup) {
				const pattern = `%${term}%`;
				groupConditions.push(or(like(nodeContent.name, pattern), like(nodeContent.note, pattern))!);
			}
			if (groupConditions.length > 0) {
				orConditions.push(and(...groupConditions)!);
			}
		}
		if (orConditions.length > 0) {
			contentConditions.push(or(...orConditions)!);
		}
	}

	// Excluded terms - must NOT appear in name or note
	for (const term of parsed.excludedTerms) {
		const pattern = `%${term}%`;
		contentConditions.push(
			and(
				or(isNull(nodeContent.name), not(like(nodeContent.name, pattern))),
				or(isNull(nodeContent.note), not(like(nodeContent.note, pattern))),
			)!,
		);
	}

	// Completion filter - requires metadata join
	if (parsed.isComplete === true) {
		metadataConditions.push(isNotNull(nodeMetadata.completedAt));
	} else if (parsed.isComplete === false) {
		metadataConditions.push(isNull(nodeMetadata.completedAt));
	}

	// Date filter - last-changed:Nd means modifiedAt within last N days - requires metadata join
	if (parsed.lastChangedDays !== null) {
		const cutoffDate = new Date(Date.now() - parsed.lastChangedDays * 24 * 60 * 60 * 1000);
		metadataConditions.push(gte(nodeMetadata.modifiedAt, cutoffDate));
	}

	return {
		contentConditions,
		metadataConditions,
		needsMetadataJoin: metadataConditions.length > 0,
	};
}

// 🔗 Build the parent path for a node by traversing up the parentId chain
async function buildParentPath(database: ReturnType<typeof getDatabase>, nodeId: string): Promise<string> {
	const pathParts: string[] = [];
	let currentId: string | null = nodeId;

	// First, get the parent of the search result node
	const startNode = database
		.select({parentId: nodeContent.parentId})
		.from(nodeContent)
		.where(and(eq(nodeContent.id, currentId), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
		.get();

	if (!startNode) {
		return '';
	}

	currentId = startNode.parentId;

	// Traverse up the parent chain
	while (currentId !== null) {
		const parentNode = database
			.select({
				id: nodeContent.id,
				name: nodeContent.name,
				parentId: nodeContent.parentId,
			})
			.from(nodeContent)
			.where(and(eq(nodeContent.id, currentId), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
			.get();

		if (!parentNode) {
			break;
		}

		const nodeName = parentNode.name ? stripHtmlTags(parentNode.name) : 'Untitled';
		pathParts.unshift(nodeName);
		currentId = parentNode.parentId;
	}

	return pathParts.join(' > ');
}

// 📊 Extract scoring terms from parsed query for result ranking
function getScoringTerms(parsed: ParsedQuery): string[] {
	const terms: string[] = [];
	terms.push(...parsed.exactPhrases, ...parsed.requiredTerms);
	for (const group of parsed.orTerms) {
		terms.push(...group);
	}
	return terms;
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

	// Build parent paths for each result
	const results: SearchResult[] = await Promise.all(
		paginatedResults.map(async ({id, name, note}) => ({
			id,
			name,
			note,
			parentPath: await buildParentPath(database, id),
		})),
	);

	return c.json({results, totalCount});
});
