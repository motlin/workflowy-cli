import {Hono} from "hono";
import type {Context} from "hono";
import {PathBuilder} from "@workflowy/shared/cache";
import {nodeContent, nodeMetadata} from "@workflowy/shared/db";
import type {AppDatabase} from "@workflowy/shared/db";
import {buildSearchConditions, getScoringTerms, parseSearchQuery, resolveJoinedSec} from "@workflowy/shared/search";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {stripHtmlTags} from "@workflowy/shared/html";
import {and, eq, inArray, sql} from "drizzle-orm";
import {notReferencesContent} from "../backlinks.js";
import {collectHelperTags} from "../helper-tags.js";
import type {HelperTags} from "../helper-tags.js";
import type {AppEnv} from "../context.js";
import {filterLocations} from "../location-search.js";
import {rankSwitcher} from "../switcher-search.js";
import {computeTreeSearch} from "../tree-search.js";
import type {TreeSearchRow} from "../tree-search.js";
import {loadTreeRows, loadTreeRowsWithBacklinks, loadTreeSearchRows, queryNeedsBacklinks} from "../tree-snapshot.js";

type TreeLoader = (database: AppDatabase, rootId: string | null) => TreeSearchRow[];

/** The snapshot loader, or the SQL subtree query when `features.treeSnapshot` is off (no whole tree held in memory). */
function treeLoader(c: Context<AppEnv>): TreeLoader {
	return c.get("ctx").config.features.treeSnapshot ? loadTreeRows : loadTreeSearchRows;
}

export const searchRouter = new Hono<AppEnv>();

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
function getDescendantIds(database: AppDatabase, parentId: string): string[] {
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

/** Search helper #tags/@tags of the live descendants of `rootId`, excluding the root (whole tree when empty). */
export function loadHelperTags(database: AppDatabase, rootId: string, load: TreeLoader = loadTreeRows): HelperTags {
	const rows = load(database, rootId === "" ? null : rootId);
	return collectHelperTags(rows.filter((row) => row.id !== rootId));
}

// GET /api/search/helpers?rootId= - Subtree tags for the search helper's #TAGS / @TAGS sections
searchRouter.get("/helpers", (c) =>
	c.json(loadHelperTags(c.get("ctx").db, c.req.query("rootId") ?? "", treeLoader(c))),
);

/** The account's stored date format (so strict `date:` queries parse it), or null when unset or unavailable. */
async function loadDateFormat(c: Context<AppEnv>): Promise<string | null> {
	const adapter = c.get("ctx").internalAdapter?.();
	if (!adapter) {
		return null;
	}
	try {
		const value = await adapter.getRootMeta(["dateFormat"]);
		return typeof value === "string" && value !== "" ? value : null;
	} catch {
		return null;
	}
}

/** The account's week start (Monday = 1), or null for Sunday, unset or unavailable. */
async function loadWeekStartDay(c: Context<AppEnv>): Promise<0 | 1 | null> {
	const adapter = c.get("ctx").internalAdapter?.();
	if (!adapter) {
		return null;
	}
	try {
		const value = await adapter.getRootMeta(["weekStartDay"]);
		return value === 1 ? 1 : value === 0 ? 0 : null;
	} catch {
		return null;
	}
}

// POST /api/search/tree - In-place search of the zoomed subtree, driven by the upstream query AST
searchRouter.post("/tree", async (c) => {
	const {query, rootId} = await c.req.json<TreeSearchBody>();
	const load = treeLoader(c);
	const rows = queryNeedsBacklinks(query)
		? loadTreeRowsWithBacklinks(c.get("ctx").db, rootId, load)
		: load(c.get("ctx").db, rootId);
	const dateFormat = await loadDateFormat(c);
	const weekStartDay = await loadWeekStartDay(c);
	return c.json(
		computeTreeSearch(rows, rootId, query, Date.now(), {
			...(dateFormat === null ? {} : {dateFormat}),
			...(weekStartDay === null ? {} : {weekStartDay}),
		}),
	);
});

interface SwitcherBody {
	query: string;
	offset?: number;
	limit?: number;
	starredIds?: string[];
	showCompleted?: boolean;
}

let joinedSecPromise: Promise<number> | undefined;

/** The account join date (once per server), else the earliest cached `created_at`, for switcher recency. */
async function loadJoinedSec(c: Context<AppEnv>, rows: TreeSearchRow[]): Promise<number> {
	// A loop, not Math.min(...), so a large tree cannot overflow the call stack.
	let earliestCreatedMs = Infinity;
	for (const row of rows) {
		if (row.createdAt !== null && row.createdAt < earliestCreatedMs) {
			earliestCreatedMs = row.createdAt;
		}
	}
	const earliestCreatedSec = Number.isFinite(earliestCreatedMs) ? Math.floor(earliestCreatedMs / 1000) : 0;
	const adapter = c.get("ctx").internalAdapter?.();
	if (!adapter) {
		return resolveJoinedSec({account: null, earliestCreatedSec});
	}
	joinedSecPromise ??= adapter.getAccount().then(
		({joinedAt}) => resolveJoinedSec({account: {joinedAt: joinedAt.toISOString()}, earliestCreatedSec}),
		() => {
			joinedSecPromise = undefined;
			return resolveJoinedSec({account: null, earliestCreatedSec});
		},
	);
	return joinedSecPromise;
}

// POST /api/search/switcher - Upstream jump-menu search: word-start matches ranked by staticScore x textFactor
searchRouter.post("/switcher", async (c) => {
	const {query, offset = 0, limit = 20, starredIds = [], showCompleted} = await c.req.json<SwitcherBody>();
	const rows = treeLoader(c)(c.get("ctx").db, null);
	const joinedSec = await loadJoinedSec(c, rows);
	return c.json(
		rankSwitcher(rows, query, starredIds, Math.floor(Date.now() / 1000), {joinedSec, offset, limit, showCompleted}),
	);
});

interface LocationsBody {
	query: string;
	offset?: number;
	limit?: number;
	excludeId?: string;
	starredIds?: string[];
	showCompleted?: boolean;
}

// POST /api/search/locations - Upstream move-to location picker: switcher matching without completed nodes or excludeId
searchRouter.post("/locations", async (c) => {
	const {query, offset = 0, limit = 20, excludeId, starredIds, showCompleted} = await c.req.json<LocationsBody>();
	const rows = treeLoader(c)(c.get("ctx").db, null);
	const joinedSec = await loadJoinedSec(c, rows);
	// Typing supersedes earlier keystrokes; the client aborts them, so skip ranking for a request nobody waits on.
	if (c.req.raw.signal.aborted) {
		return new Response(null, {status: 499});
	}
	return c.json(filterLocations(rows, {query, excludeId, offset, limit, joinedSec, starredIds, showCompleted}));
});

// POST /api/search - Text-based search with operators
searchRouter.post("/", async (c) => {
	const body = await c.req.json<SearchBody>();
	const {query, limit = 10, offset = 0, parentId} = body;

	if (!query || query.trim().length === 0) {
		return c.json({results: [], totalCount: 0});
	}

	const database = c.get("ctx").db;
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
