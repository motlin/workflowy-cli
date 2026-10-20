import {referencesRoots} from "@workflowy/shared/db";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {sql} from "drizzle-orm";
import type {MiddlewareHandler} from "hono";
import type {getDatabase} from "./db.js";
import type {TreeSearchRow} from "./tree-search.js";

export type Database = ReturnType<typeof getDatabase>;

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

interface TreeSnapshot {
	dataVersion: string;
	changes: number;
	rows: TreeSearchRow[];
	byId: Map<string, TreeSearchRow>;
	children: Map<string | null, TreeSearchRow[]>;
}

/** How long after the last write the background rebuild waits, so a burst of edits costs one reload. */
const REBUILD_DEBOUNCE_MS = 500;

const snapshots = new WeakMap<Database, TreeSnapshot>();
const rebuildTimers = new WeakMap<Database, ReturnType<typeof setTimeout>>();

interface ChangeState {
	/** Bumped by commits from any other connection (another process's cache refresh). */
	dataVersion: string;
	/** Rows this connection has written, so this server's own edits. */
	changes: number;
}

function changeState(database: Database): ChangeState {
	const dataVersion: unknown = database.$client.pragma("data_version", {simple: true});
	const {changes} = database.get<{changes: number}>(sql`SELECT total_changes() AS changes`);
	return {dataVersion: String(dataVersion), changes};
}

/**
 * Changes whenever any connection commits to the file (`data_version`) or this connection writes
 * (`total_changes()`), so a snapshot never outlives a write however it was made.
 */
export function changeToken(database: Database): string {
	const {dataVersion, changes} = changeState(database);
	return `${dataVersion}:${changes}`;
}

const ROW_FIELDS = [
	"id",
	"parentId",
	"priority",
	"name",
	"note",
	"createdAt",
	"modifiedAt",
	"completedAt",
	"layoutMode",
	"isMirror",
] as const satisfies readonly (keyof TreeSearchRow)[];

/** The previous snapshot's object for `row` when every field is unchanged, keeping caches keyed on it warm. */
function unchangedRow(previous: TreeSnapshot | undefined, row: TreeSearchRow): TreeSearchRow | undefined {
	const old = previous?.byId.get(row.id);
	if (old === undefined) {
		return undefined;
	}
	return ROW_FIELDS.every((field) => old[field] === row[field]) ? old : undefined;
}

function isCurrent(snapshot: TreeSnapshot, state: ChangeState): boolean {
	return snapshot.dataVersion === state.dataVersion && snapshot.changes === state.changes;
}

function rebuildSnapshot(database: Database, state: ChangeState): TreeSnapshot {
	clearTimeout(rebuildTimers.get(database));
	rebuildTimers.delete(database);
	const previous = snapshots.get(database);
	const rows = loadTreeSearchRows(database, null).map((row) => unchangedRow(previous, row) ?? row);
	const children = new Map<string | null, TreeSearchRow[]>();
	for (const row of rows) {
		const siblings = children.get(row.parentId);
		if (siblings) {
			siblings.push(row);
		} else {
			children.set(row.parentId, [row]);
		}
	}
	const snapshot = {...state, rows, byId: new Map(rows.map((row) => [row.id, row])), children};
	snapshots.set(database, snapshot);
	return snapshot;
}

/** Rebuild the snapshot now unless it is already current. Called at server start so the first search is warm. */
export function warmTreeSnapshot(database: Database): void {
	const state = changeState(database);
	const cached = snapshots.get(database);
	if (cached === undefined || !isCurrent(cached, state)) {
		rebuildSnapshot(database, state);
	}
}

/**
 * Rebuild the snapshot {@link REBUILD_DEBOUNCE_MS} after the last call, off the request path.
 * `restart: false` keeps an already pending rebuild's deadline, so repeated stale reads cannot postpone it forever.
 */
export function scheduleTreeSnapshotRebuild(database: Database, {restart = true}: {restart?: boolean} = {}): void {
	const pending = rebuildTimers.get(database);
	if (pending !== undefined) {
		if (!restart) {
			return;
		}
		clearTimeout(pending);
	}
	const timer = setTimeout(() => {
		rebuildTimers.delete(database);
		if (database.$client.open) {
			warmTreeSnapshot(database);
		}
	}, REBUILD_DEBOUNCE_MS);
	timer.unref();
	rebuildTimers.set(database, timer);
}

/** The current snapshot's rows without checking for writes or rebuilding, for tests. */
export function peekTreeSnapshotRows(database: Database): TreeSearchRow[] | undefined {
	return snapshots.get(database)?.rows;
}

/**
 * Middleware scheduling a background rebuild after every request that wrote through this server,
 * so the next search usually finds the snapshot already warm.
 */
export function rebuildTreeSnapshotAfterWrites(getDatabase: () => Database): MiddlewareHandler {
	return async (c, next) => {
		if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
			await next();
			return;
		}
		const database = getDatabase();
		const before = changeState(database).changes;
		await next();
		if (changeState(database).changes !== before) {
			scheduleTreeSnapshotRebuild(database);
		}
	};
}

/**
 * The snapshot a request may read. A write this server made since the snapshot rebuilds it right away
 * (read-your-writes for the edited node); a write only from another connection, such as the background cache
 * refresh, serves the previous snapshot while a debounced rebuild runs off the request path.
 */
function wholeTreeSnapshot(database: Database): TreeSnapshot {
	const state = changeState(database);
	const cached = snapshots.get(database);
	if (cached === undefined || cached.changes !== state.changes) {
		return rebuildSnapshot(database, state);
	}
	if (cached.dataVersion !== state.dataVersion) {
		scheduleTreeSnapshotRebuild(database, {restart: false});
	}
	return cached;
}

/**
 * {@link loadTreeSearchRows} served from one whole-tree snapshot per database, reloaded only after a write
 * (see {@link wholeTreeSnapshot} for when a request may read the previous one).
 * A subtree is the root plus the snapshot rows reachable from it, in snapshot order; a root outside the snapshot
 * (a references root, or a node cut off from Home) falls back to the SQL subtree query.
 */
export function loadTreeRows(database: Database, rootId: string | null): TreeSearchRow[] {
	const snapshot = wholeTreeSnapshot(database);
	if (rootId === null) {
		return snapshot.rows;
	}
	const root = snapshot.byId.get(rootId);
	if (root === undefined) {
		return loadTreeSearchRows(database, rootId);
	}
	const members = new Set([root]);
	for (const member of members) {
		for (const child of snapshot.children.get(member.id) ?? []) {
			members.add(child);
		}
	}
	// Keep the whole-tree row order, which matches the SQL subtree query's (first-seen tag casing depends on it).
	return snapshot.rows.filter((row) => members.has(row));
}
