import {referencesRoots} from "@workflowy/shared/db";
import {FAR_FUTURE_DATE} from "@workflowy/shared/temporal";
import {sql} from "drizzle-orm";
import type {getDatabase} from "./db.js";
import type {TreeSearchRow} from "./tree-search.js";

type Database = ReturnType<typeof getDatabase>;

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
	token: string;
	rows: TreeSearchRow[];
	byId: Map<string, TreeSearchRow>;
	children: Map<string | null, TreeSearchRow[]>;
}

const snapshots = new WeakMap<Database, TreeSnapshot>();

/**
 * Changes whenever any connection commits to the file (`data_version`) or this connection writes
 * (`total_changes()`), so a snapshot never outlives a write however it was made.
 */
function changeToken(database: Database): string {
	const dataVersion: unknown = database.$client.pragma("data_version", {simple: true});
	const {changes} = database.get<{changes: number}>(sql`SELECT total_changes() AS changes`);
	return `${String(dataVersion)}:${changes}`;
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

function wholeTreeSnapshot(database: Database): TreeSnapshot {
	const token = changeToken(database);
	const cached = snapshots.get(database);
	if (cached?.token === token) {
		return cached;
	}
	const rows = loadTreeSearchRows(database, null).map((row) => unchangedRow(cached, row) ?? row);
	const children = new Map<string | null, TreeSearchRow[]>();
	for (const row of rows) {
		const siblings = children.get(row.parentId);
		if (siblings) {
			siblings.push(row);
		} else {
			children.set(row.parentId, [row]);
		}
	}
	const snapshot = {token, rows, byId: new Map(rows.map((row) => [row.id, row])), children};
	snapshots.set(database, snapshot);
	return snapshot;
}

/**
 * {@link loadTreeSearchRows} served from one whole-tree snapshot per database, reloaded only after a write.
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
