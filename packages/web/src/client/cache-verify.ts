import type {QueryClient, QueryKey} from "@tanstack/react-query";
import type {NodeResponse} from "../node-types.js";
import {nodeKeys} from "./node-cache.js";
import {readJson} from "./read-json.js";

/** What a row renders from, the part an optimistic write and the server's answer must agree on. */
export interface ComparableRow {
	id: string;
	parent_id: string | null;
	/** Blank text is "" whether it is stored as null or as an empty string: both render the same row. */
	name: string;
	note: string;
	completed: boolean;
	hasChildren: boolean | undefined;
	hasUncompletedChildren: boolean | undefined;
	isMirror: boolean;
	originalNodeId: string | null;
}

function comparableRow(node: NodeResponse): ComparableRow {
	return {
		id: node.id,
		parent_id: node.parent_id,
		name: node.name ?? "",
		note: node.note ?? "",
		completed: node.completedAt !== null,
		hasChildren: node.hasChildren,
		hasUncompletedChildren: node.hasUncompletedChildren,
		isMirror: node.isMirror ?? false,
		originalNodeId: node.originalNodeId ?? null,
	};
}

export type ComparableEntry = ComparableRow[] | ComparableRow;

/** The cached value of `key` in comparable form; undefined when it is not cached. */
function comparableEntry(queryClient: QueryClient, key: QueryKey): ComparableEntry | undefined {
	const data = queryClient.getQueryData<NodeResponse[] | NodeResponse>(key);
	if (data === undefined) {
		return undefined;
	}
	return Array.isArray(data) ? data.map(comparableRow) : comparableRow(data);
}

/** The keys of every cached children list (its array order is what the outline renders) and node detail entry. */
export function verifiedKeys(queryClient: QueryClient): QueryKey[] {
	return [
		...queryClient.getQueriesData({queryKey: [...nodeKeys.all, "children"]}),
		...queryClient.getQueriesData({queryKey: [...nodeKeys.all, "detail"]}),
	].map(([key]) => key);
}

/** The cached, comparable value of each of `keys` that is cached, by JSON key. */
export function snapshotEntries(queryClient: QueryClient, keys: readonly QueryKey[]): Map<string, ComparableEntry> {
	const entries = new Map<string, ComparableEntry>();
	for (const key of keys) {
		const entry = comparableEntry(queryClient, key);
		if (entry !== undefined) {
			entries.set(JSON.stringify(key), entry);
		}
	}
	return entries;
}

async function fetchDetail(nodeId: string): Promise<NodeResponse | undefined> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}`);
	if (response.status === 404) {
		return undefined;
	}
	if (!response.ok) {
		throw new Error(`Failed to fetch node: ${response.statusText}`);
	}
	return (await readJson<{node: NodeResponse}>(response)).node;
}

async function fetchList(parentId: string | null): Promise<NodeResponse[] | undefined> {
	if (parentId === null) {
		const response = await fetch("/api/v1/nodes");
		if (!response.ok) {
			throw new Error(`Failed to fetch children: ${response.statusText}`);
		}
		return (await readJson<{nodes: NodeResponse[]}>(response)).nodes;
	}
	// A deleted node's leftover list renders nowhere: only a live parent's list is compared.
	if ((await fetchDetail(parentId)) === undefined) {
		return undefined;
	}
	const response = await fetch("/api/v1/nodes/children", {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({parentIds: [parentId]}),
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch children: ${response.statusText}`);
	}
	return (await readJson<{children: Record<string, NodeResponse[]>}>(response)).children[parentId];
}

/** The server's answer for a children-list or detail key; undefined for any other key or a node the server lacks. */
async function fetchServerData(key: QueryKey): Promise<NodeResponse[] | NodeResponse | undefined> {
	const [, kind, id] = key;
	if (kind === "children" && (typeof id === "string" || id === null)) {
		return fetchList(id);
	}
	return kind === "detail" && typeof id === "string" ? fetchDetail(id) : undefined;
}

/**
 * The server's answer for each key, straight from the API (no pending-write waits), in comparable form by JSON key. A
 * key whose node is gone from the server is left out: its cached entry is unreachable.
 */
export async function fetchServerEntries(keys: readonly QueryKey[]): Promise<Map<string, ComparableEntry>> {
	const entries = await Promise.all(
		keys.map(async (key): Promise<[string, ComparableEntry][]> => {
			const data = await fetchServerData(key);
			if (data === undefined) {
				return [];
			}
			return [[JSON.stringify(key), Array.isArray(data) ? data.map(comparableRow) : comparableRow(data)]];
		}),
	);
	return new Map(entries.flat());
}

export interface CacheMismatch {
	key: string;
	/** Each difference, cached value first: `order: a,b -> b,a` or `<id>.<field>: <cached> -> <server>`. */
	differences: string[];
}

const FIELDS = [
	"id",
	"parent_id",
	"name",
	"note",
	"completed",
	"hasChildren",
	"hasUncompletedChildren",
	"isMirror",
	"originalNodeId",
] as const satisfies readonly (keyof ComparableRow)[];

function rowDifferences(cached: ComparableRow, server: ComparableRow): string[] {
	return FIELDS.filter((field) => cached[field] !== server[field]).map(
		(field) => `${cached.id}.${field}: ${JSON.stringify(cached[field])} -> ${JSON.stringify(server[field])}`,
	);
}

function idOrder(rows: ComparableRow[]): string {
	return rows.map((row) => row.id).join(",");
}

function entryDifferences(cached: ComparableEntry, server: ComparableEntry): string[] {
	if (!Array.isArray(cached) || !Array.isArray(server)) {
		return Array.isArray(cached) || Array.isArray(server)
			? ["shape: list -> detail"]
			: rowDifferences(cached, server);
	}
	if (idOrder(cached) !== idOrder(server)) {
		return [`order: ${idOrder(cached)} -> ${idOrder(server)}`];
	}
	return cached.flatMap((row, index) => {
		const answer = server[index];
		return answer === undefined ? [] : rowDifferences(row, answer);
	});
}

/** Every key whose cached value differs from the server's (keys the server left out are skipped). */
export function diffEntries(
	cached: ReadonlyMap<string, ComparableEntry>,
	server: ReadonlyMap<string, ComparableEntry>,
): CacheMismatch[] {
	const mismatches: CacheMismatch[] = [];
	for (const [key, entry] of cached) {
		const answer = server.get(key);
		const differences = answer === undefined ? [] : entryDifferences(entry, answer);
		if (differences.length > 0) {
			mismatches.push({key, differences});
		}
	}
	return mismatches;
}

/**
 * The keys a write to `nodeIds` under `parentIds` can change: each parent's children list, every cached list holding
 * one of those rows (a parent's row carries its children flags), and their detail entries.
 */
export function affectedKeys(
	queryClient: QueryClient,
	nodeIds: readonly string[],
	parentIds: readonly (string | null)[],
): QueryKey[] {
	const touched = new Set<string | null>([...nodeIds, ...parentIds]);
	const keys: QueryKey[] = parentIds.map((parentId) => nodeKeys.children(parentId));
	for (const [key, rows] of queryClient.getQueriesData<NodeResponse[]>({queryKey: [...nodeKeys.all, "children"]})) {
		if (rows?.some((row) => touched.has(row.id)) === true) {
			keys.push(key);
		}
	}
	for (const id of touched) {
		if (id !== null) {
			keys.push(nodeKeys.detail(id));
		}
	}
	return [...new Map(keys.map((key) => [JSON.stringify(key), key])).values()];
}

/** Whether the dev-only runtime check runs: a dev build, never under the test runner. */
const VERIFY = import.meta.env.DEV && import.meta.env.MODE !== "test";

/**
 * Dev only: compare what a mutation left in the cache for `keys` (read now, before its settle refetch) with the
 * server's lists, and console.error each difference. Skipped when another mutation is in flight or starts before the
 * server answers: the server has not seen its optimistic rows yet.
 */
export function verifyAgainstServer(queryClient: QueryClient, label: string, keys: readonly QueryKey[]): void {
	if (!VERIFY || queryClient.isMutating() > 1) {
		return;
	}
	let started = false;
	const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
		started ||= event.type === "added";
	});
	void reportMismatches(label, keys, snapshotEntries(queryClient, keys), () => started).finally(unsubscribe);
}

/**
 * Fetch the server's side of `keys` and console.error every difference from `cached` (their snapshot) unless
 * `stale()` by then. Never throws.
 */
export async function reportMismatches(
	label: string,
	keys: readonly QueryKey[],
	cached: ReadonlyMap<string, ComparableEntry>,
	stale: () => boolean = () => false,
): Promise<void> {
	try {
		const server = await fetchServerEntries(keys);
		if (stale()) {
			return;
		}
		for (const mismatch of diffEntries(cached, server)) {
			console.error(
				`[cache-verify] ${label}: cache differs from the server for ${mismatch.key}`,
				mismatch.differences,
			);
		}
	} catch (error) {
		console.error(`[cache-verify] ${label}: could not fetch the server's lists`, error);
	}
}
