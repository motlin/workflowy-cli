import {Hono} from "hono";
import {PathBuilder} from "@workflowy/shared/cache";
import {nodeContent, nodeMetadata, referencesRoots} from "@workflowy/shared/db";
import {buildSearchConditions, getScoringTerms, parseSearchQuery} from "@workflowy/shared/search";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {stripHtmlTags} from "@workflowy/shared/html";
import {and, eq, inArray, sql} from "drizzle-orm";
import {notReferencesContent} from "../backlinks.js";
import {getDatabase} from "../db.js";
import {collectHelperTags} from "../helper-tags.js";
import type {HelperTags} from "../helper-tags.js";
import {computeTreeSearch} from "../tree-search.js";
import type {TreeSearchRow} from "../tree-search.js";

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
function getDescendantIds(database: ReturnType<typeof getDatabase>, parentId: string): string[] {
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

interface TreeSearchBody {
	query: string;
	rootId: string | null;
}

interface TreeSearchSqlRow {
	id: string;
	parentId: string | null;
	priority: number | null;
	name: string | null;
	note: string | null;
	createdAt: number | null;
	modifiedAt: number | null;
	completedAt: number | null;
	layoutMode: string | null;
	isMirror: number;
}

/** Epoch seconds as stored by drizzle's timestamp mode, to milliseconds. */
function toMillis(seconds: number | null): number | null {
	return seconds === null ? null : seconds * 1000;
}

/**
 * The live subtree under `rootId` (including the root; every top-level tree when null) for tree search.
 * References roots and their backlink items are skipped. A mirror takes its text from its live original.
 */
export function loadTreeSearchRows(database: ReturnType<typeof getDatabase>, rootId: string | null): TreeSearchRow[] {
	const rows = database.all<TreeSearchSqlRow>(sql`
		WITH RECURSIVE subtree(id) AS (
			SELECT id FROM node_content
			WHERE ${rootId === null ? sql`parent_id IS NULL` : sql`id = ${rootId}`}
			AND system_to = ${FAR_FUTURE_DATE}
			UNION ALL
			SELECT n.id FROM node_content n
			INNER JOIN subtree s ON n.parent_id = s.id
			WHERE n.system_to = ${FAR_FUTURE_DATE}
		)
		SELECT
			c.id AS id,
			c.parent_id AS parentId,
			m.priority AS priority,
			CASE WHEN o.id IS NULL THEN c.name ELSE o.name END AS name,
			CASE WHEN o.id IS NULL THEN c.note ELSE o.note END AS note,
			m.created_at AS createdAt,
			m.modified_at AS modifiedAt,
			m.completed_at AS completedAt,
			m.layout_mode AS layoutMode,
			mi.mirror_id IS NOT NULL AS isMirror
		FROM subtree s
		INNER JOIN node_content c ON c.id = s.id AND c.system_to = ${FAR_FUTURE_DATE}
		LEFT JOIN node_metadata m ON m.node_id = c.id AND m.system_to = ${FAR_FUTURE_DATE}
		LEFT JOIN mirrors mi ON mi.mirror_id = c.id AND mi.system_to = ${FAR_FUTURE_DATE}
		LEFT JOIN node_content o ON o.id = mi.original_id AND o.system_to = ${FAR_FUTURE_DATE}
		WHERE c.id NOT IN (SELECT node_id FROM ${referencesRoots} WHERE system_to = ${FAR_FUTURE_DATE})
		AND (c.parent_id IS NULL OR c.parent_id NOT IN (SELECT node_id FROM ${referencesRoots} WHERE system_to = ${FAR_FUTURE_DATE}))
	`);
	return rows.map((row) => ({
		...row,
		createdAt: toMillis(row.createdAt),
		modifiedAt: toMillis(row.modifiedAt),
		completedAt: toMillis(row.completedAt),
		isMirror: row.isMirror === 1,
	}));
}

/** Search helper #tags/@tags of the live descendants of `rootId`, excluding the root (whole tree when empty). */
export function loadHelperTags(database: ReturnType<typeof getDatabase>, rootId: string): HelperTags {
	const rows = loadTreeSearchRows(database, rootId === "" ? null : rootId);
	return collectHelperTags(rows.filter((row) => row.id !== rootId));
}

// GET /api/search/helpers?rootId= - Subtree tags for the search helper's #TAGS / @TAGS sections
searchRouter.get("/helpers", (c) => c.json(loadHelperTags(getDatabase(), c.req.query("rootId") ?? "")));

// POST /api/search/tree - In-place search of the zoomed subtree, driven by the upstream query AST
searchRouter.post("/tree", async (c) => {
	const {query, rootId} = await c.req.json<TreeSearchBody>();
	const rows = loadTreeSearchRows(getDatabase(), rootId);
	return c.json(computeTreeSearch(rows, rootId, query, Date.now()));
});

// POST /api/search - Text-based search with operators
searchRouter.post("/", async (c) => {
	const body = await c.req.json<SearchBody>();
	const {query, limit = 10, offset = 0, parentId} = body;

	if (!query || query.trim().length === 0) {
		return c.json({results: [], totalCount: 0});
	}

	const database = getDatabase();
	const parsed = parseSearchQuery(query);
	const {contentConditions, metadataConditions, needsMetadataJoin} = buildSearchConditions(parsed);
	// References roots and their backlink items are never search or jump hits.
	contentConditions.push(notReferencesContent());

	// If parentId is provided, limit search to descendants of that node
	if (parentId) {
		const descendantIds = getDescendantIds(database, parentId);
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
		const namePlain = result.name ? stripHtmlTags(result.name).toLowerCase() : "";
		const notePlain = result.note ? stripHtmlTags(result.note).toLowerCase() : "";

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
	const pathByParent = new PathBuilder(database).buildFullPathsBatch(parentIds);

	const results: SearchResult[] = paginatedResults.map(({id, name, note}) => {
		const nodeParentId = parentIdOf.get(id) ?? null;
		return {id, name, note, parentPath: nodeParentId ? (pathByParent.get(nodeParentId) ?? "") : ""};
	});

	return c.json({results, totalCount});
});
