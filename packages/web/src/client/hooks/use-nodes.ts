import {skipToken, useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import type {BacklinksResponse, NodeResponse} from "../../node-types.js";
import {nodeKeys, spliceBlock, spliceChildren} from "../node-cache.js";
import {useOutlineStore} from "../stores/outline.js";
import {readJson} from "../read-json.js";

interface CreateNodeRequest {
	parent_id?: string;
	name: string;
	note?: string;
	layoutMode?: string;
	/** Exact slot among all siblings (completed included); omitted = bottom. */
	index?: number;
	/** Legacy priority hint: negative = top, else bottom. */
	position?: number;
}

interface UpdateNodeRequest {
	name?: string;
	note?: string;
	layoutMode?: string;
}

async function fetchChildren(parentId: string | null): Promise<NodeResponse[]> {
	const url = parentId === null ? "/api/v1/nodes" : `/api/v1/nodes?parent_id=${encodeURIComponent(parentId)}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch children: ${response.statusText}`);
	}
	const data = await readJson<{nodes: NodeResponse[]}>(response);
	return data.nodes;
}

async function fetchNode(nodeId: string): Promise<NodeResponse> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch node: ${response.statusText}`);
	}
	const data = await readJson<{node: NodeResponse}>(response);
	return data.node;
}

async function fetchAncestors(nodeId: string): Promise<NodeResponse[]> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/ancestors`);
	if (!response.ok) {
		throw new Error(`Failed to fetch ancestors: ${response.statusText}`);
	}
	const data = await readJson<{ancestors: NodeResponse[]}>(response);
	return data.ancestors;
}

async function createNode(request: CreateNodeRequest): Promise<NodeResponse> {
	const response = await fetch("/api/v1/nodes", {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(request),
	});
	if (!response.ok) {
		throw new Error(`Failed to create node: ${response.statusText}`);
	}
	const data = await readJson<{node: NodeResponse}>(response);
	return data.node;
}

async function updateNode(nodeId: string, request: UpdateNodeRequest): Promise<NodeResponse> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}`, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(request),
	});
	if (!response.ok) {
		throw new Error(`Failed to update node: ${response.statusText}`);
	}
	const data = await readJson<{node: NodeResponse}>(response);
	return data.node;
}

async function deleteNode(nodeId: string): Promise<void> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}`, {
		method: "DELETE",
	});
	if (!response.ok) {
		throw new Error(`Failed to delete node: ${response.statusText}`);
	}
}

interface MoveNodeRequest {
	parent_id: string | null;
	/** Exact slot among the new parent's children (completed included, moved node excluded); omitted = bottom. */
	index?: number;
	/** Legacy priority hint: negative = top, else bottom. */
	position?: number;
}

interface MoveNodeResponse {
	node: NodeResponse;
	oldParentId: string | null;
}

async function moveNode(nodeId: string, request: MoveNodeRequest): Promise<MoveNodeResponse> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/move`, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(request),
	});
	if (!response.ok) {
		throw new Error(`Failed to move node: ${response.statusText}`);
	}
	return readJson<MoveNodeResponse>(response);
}

async function completeNode(nodeId: string): Promise<NodeResponse> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/complete`, {
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`Failed to complete node: ${response.statusText}`);
	}
	const data = await readJson<{node: NodeResponse}>(response);
	return data.node;
}

async function uncompleteNode(nodeId: string): Promise<NodeResponse> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/uncomplete`, {
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`Failed to uncomplete node: ${response.statusText}`);
	}
	const data = await readJson<{node: NodeResponse}>(response);
	return data.node;
}

/**
 * Fetches children of a parent node (or root nodes if parentId is null).
 */
async function fetchBacklinks(nodeId: string): Promise<BacklinksResponse> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/backlinks`);
	if (!response.ok) {
		throw new Error(`Failed to fetch backlinks: ${response.statusText}`);
	}
	return readJson<BacklinksResponse>(response);
}

/** Fetches an item's Backlinks section (disabled for the main-tree root). */
export function useBacklinks(nodeId: string | null) {
	return useQuery({
		queryKey: nodeKeys.backlinks(nodeId ?? ""),
		queryFn: nodeId === null ? skipToken : async () => fetchBacklinks(nodeId),
	});
}

export function useChildren(parentId: string | null) {
	return useQuery({
		queryKey: nodeKeys.children(parentId),
		queryFn: async () => fetchChildren(parentId),
	});
}

/**
 * Fetches a single node by ID.
 * Returns null data if nodeId is empty (disabled query).
 */
export function useNode(nodeId: string | null) {
	return useQuery({
		queryKey: nodeKeys.detail(nodeId ?? ""),
		queryFn: nodeId === null || nodeId === "" ? skipToken : async () => fetchNode(nodeId),
	});
}

/**
 * Fetches all ancestors of a node from root to the node itself.
 * Returns empty array if nodeId is null (at root level).
 */
export function useAncestors(nodeId: string | null) {
	return useQuery({
		queryKey: nodeKeys.ancestors(nodeId ?? ""),
		queryFn: nodeId === null || nodeId === "" ? skipToken : async () => fetchAncestors(nodeId),
	});
}

/** The slot a create/move lands in: the exact `index`, else the legacy hint (negative = top, else bottom). */
function requestedIndex(request: {index?: number; position?: number}, count: number): number {
	if (request.index !== undefined) {
		return request.index;
	}
	return request.position !== undefined && request.position < 0 ? 0 : count;
}

/** A node from its detail cache, else from whichever cached children list holds it. */
function findCachedNode(queryClient: QueryClient, nodeId: string): NodeResponse | undefined {
	const detail = queryClient.getQueryData<NodeResponse>(nodeKeys.detail(nodeId));
	if (detail) {
		return detail;
	}
	for (const [, children] of queryClient.getQueriesData<NodeResponse[]>({queryKey: [...nodeKeys.all, "children"]})) {
		const found = children?.find((child) => child.id === nodeId);
		if (found) {
			return found;
		}
	}
	return undefined;
}

/**
 * Creates a new node with optimistic update.
 */
export function useCreateNode() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);
	const beginMutation = useOutlineStore((state) => state.beginMutation);
	const endMutation = useOutlineStore((state) => state.endMutation);

	return useMutation({
		mutationFn: createNode,
		async onMutate(newNode) {
			beginMutation();
			const parentId = newNode.parent_id ?? null;

			// Cancel outgoing refetches to avoid overwriting optimistic update
			await queryClient.cancelQueries({queryKey: nodeKeys.children(parentId)});

			// Snapshot previous value
			const previousChildren = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(parentId));

			// Optimistically add the new node
			const optimisticNode: NodeResponse = {
				id: `temp-${Date.now()}`,
				parent_id: parentId,
				name: newNode.name,
				note: newNode.note ?? null,
				priority: 0,
				data: {layoutMode: newNode.layoutMode ?? null},
				createdAt: Math.floor(Date.now() / 1000),
				modifiedAt: Math.floor(Date.now() / 1000),
				completedAt: null,
			};

			const siblings = previousChildren ?? [];
			queryClient.setQueryData<NodeResponse[]>(
				nodeKeys.children(parentId),
				spliceChildren(siblings, optimisticNode, requestedIndex(newNode, siblings.length)),
			);

			return {previousChildren, parentId};
		},
		onError(error, variables, context) {
			// Roll back to previous value on error
			if (context?.previousChildren !== undefined) {
				queryClient.setQueryData(nodeKeys.children(context.parentId), context.previousChildren);
			}
			addErrorNotification(`Failed to create node: ${error.message}`);
		},
		async onSettled(_data, _error, variables) {
			endMutation();
			// Refetch to get the real data from server
			const parentId = variables.parent_id ?? null;
			await queryClient.invalidateQueries({queryKey: nodeKeys.children(parentId)});
		},
	});
}

/**
 * Updates a node with optimistic update.
 */
export function useUpdateNode() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);

	return useMutation({
		mutationFn: async ({nodeId, ...request}: UpdateNodeRequest & {nodeId: string}) => updateNode(nodeId, request),
		async onMutate({nodeId, ...updates}) {
			// Cancel outgoing refetches
			await queryClient.cancelQueries({queryKey: nodeKeys.detail(nodeId)});

			// Snapshot previous value
			const previousNode = queryClient.getQueryData<NodeResponse>(nodeKeys.detail(nodeId));

			// Optimistically update the node
			if (previousNode) {
				queryClient.setQueryData<NodeResponse>(nodeKeys.detail(nodeId), {
					...previousNode,
					name: updates.name ?? previousNode.name,
					note: updates.note ?? previousNode.note,
					data: {
						layoutMode: updates.layoutMode ?? previousNode.data.layoutMode,
					},
					modifiedAt: Math.floor(Date.now() / 1000),
				});
			}

			return {previousNode, nodeId};
		},
		onError(error, _variables, context) {
			// Roll back to previous value on error
			if (context?.previousNode !== undefined) {
				queryClient.setQueryData(nodeKeys.detail(context.nodeId), context.previousNode);
			}
			addErrorNotification(`Failed to update node: ${error.message}`);
		},
		async onSettled(_data, _error, variables) {
			// Refetch to get the real data from server
			await queryClient.invalidateQueries({queryKey: nodeKeys.detail(variables.nodeId)});
			// Also invalidate any children queries that might contain this node
			await queryClient.invalidateQueries({queryKey: nodeKeys.all});
		},
	});
}

/**
 * Deletes a node with optimistic update.
 */
export function useDeleteNode() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);
	const beginMutation = useOutlineStore((state) => state.beginMutation);
	const endMutation = useOutlineStore((state) => state.endMutation);

	return useMutation({
		mutationFn: deleteNode,
		async onMutate(nodeId) {
			beginMutation();
			// Get the node to find its parent
			const node = queryClient.getQueryData<NodeResponse>(nodeKeys.detail(nodeId));

			// We need to find which children query contains this node
			// Since we do not have parentId in NodeResponse, we invalidate all
			// Cancel outgoing refetches
			await queryClient.cancelQueries({queryKey: nodeKeys.all});

			return {nodeId, previousNode: node};
		},
		async onError(error, _variables, context) {
			// On error, we just refetch everything since rollback is complex
			if (context?.previousNode !== undefined) {
				await queryClient.invalidateQueries({queryKey: nodeKeys.all});
			}
			addErrorNotification(`Failed to delete node: ${error.message}`);
		},
		async onSettled() {
			endMutation();
			// Refetch all node queries to reflect deletion
			await queryClient.invalidateQueries({queryKey: nodeKeys.all});
		},
	});
}

/**
 * Moves a node to `index` under `parent_id` (same parent or another) with an
 * optimistic splice: the row is removed then inserted at the index, never duplicated.
 */
export function useMoveNode() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);
	const beginMutation = useOutlineStore((state) => state.beginMutation);
	const endMutation = useOutlineStore((state) => state.endMutation);

	return useMutation({
		mutationFn: async ({nodeId, ...request}: MoveNodeRequest & {nodeId: string}) => moveNode(nodeId, request),
		async onMutate(request) {
			beginMutation();
			await queryClient.cancelQueries({queryKey: nodeKeys.all});
			const node = findCachedNode(queryClient, request.nodeId);
			return node
				? spliceMovedRows(queryClient, [node], request.parent_id, (count) => requestedIndex(request, count))
				: [];
		},
		onError(error, _variables, snapshots) {
			restoreSnapshots(queryClient, snapshots);
			addErrorNotification(`Failed to move node: ${error.message}`);
		},
		async onSettled() {
			endMutation();
			await queryClient.invalidateQueries({queryKey: nodeKeys.all});
		},
	});
}

interface MoveNodesRequest {
	ids: string[];
	parent_id: string | null;
	/** Slot among ALL of the new parent's children, moved ones included (see `spliceBlock`); omitted = bottom. */
	index?: number;
}

async function moveNodes(request: MoveNodesRequest): Promise<NodeResponse[]> {
	const response = await fetch("/api/v1/nodes/move", {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(request),
	});
	if (!response.ok) {
		throw new Error(`Failed to move nodes: ${response.statusText}`);
	}
	const data = await readJson<{nodes: NodeResponse[]}>(response);
	return data.nodes;
}

/**
 * Moves a contiguous block of nodes, in the given order, to `index` under `parent_id`
 * in one call (multi-select, drag, Sort). Splices optimistically, then applies the
 * server's sibling lists for every touched parent.
 */
// fallow-ignore-next-line unused-export -- callers land with Sort (M2-88) and block moves (M2-108)
export function useMoveNodes() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);
	const beginMutation = useOutlineStore((state) => state.beginMutation);
	const endMutation = useOutlineStore((state) => state.endMutation);

	return useMutation({
		mutationFn: moveNodes,
		async onMutate(request) {
			beginMutation();
			await queryClient.cancelQueries({queryKey: nodeKeys.all});
			const rows = request.ids
				.map((id) => findCachedNode(queryClient, id))
				.filter((row): row is NodeResponse => row !== undefined);
			return spliceMovedRows(queryClient, rows, request.parent_id, (count) => request.index ?? count);
		},
		onSuccess(nodes, _variables, snapshots) {
			for (const {parentId} of snapshots.filter((snapshot) => snapshot.kind === "children")) {
				queryClient.setQueryData<NodeResponse[]>(
					nodeKeys.children(parentId),
					nodes.filter((node) => node.parent_id === parentId),
				);
			}
			for (const node of nodes) {
				queryClient.setQueryData<NodeResponse>(nodeKeys.detail(node.id), (old) => (old ? node : old));
			}
		},
		async onError(error, _variables, snapshots) {
			restoreSnapshots(queryClient, snapshots);
			addErrorNotification(`Failed to move nodes: ${error.message}`);
			await queryClient.invalidateQueries({queryKey: nodeKeys.all});
		},
		onSettled() {
			endMutation();
		},
	});
}

type CacheSnapshot =
	| {kind: "children"; parentId: string | null; previous: NodeResponse[] | undefined}
	| {kind: "detail"; nodeId: string; previous: NodeResponse | undefined};

/**
 * Optimistically move `rows` under `newParentId` at `indexFor(siblingCount)`: remove them
 * from their old parents' cached lists, splice them into the new parent's, and repoint
 * their detail caches. Returns snapshots of every touched entry for rollback.
 */
function spliceMovedRows(
	queryClient: QueryClient,
	rows: NodeResponse[],
	newParentId: string | null,
	indexFor: (count: number) => number,
): CacheSnapshot[] {
	const movedIds = new Set(rows.map((row) => row.id));
	const parentIds = [...new Set([...rows.map((row) => row.parent_id), newParentId])];
	const snapshots: CacheSnapshot[] = parentIds.map((parentId) => ({
		kind: "children",
		parentId,
		previous: queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(parentId)),
	}));
	for (const snapshot of snapshots) {
		if (snapshot.kind === "children" && snapshot.previous && snapshot.parentId !== newParentId) {
			queryClient.setQueryData<NodeResponse[]>(
				nodeKeys.children(snapshot.parentId),
				snapshot.previous.filter((child) => !movedIds.has(child.id)),
			);
		}
	}
	const moved = rows.map((row) => ({...row, parent_id: newParentId}));
	const target = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(newParentId));
	if (target) {
		queryClient.setQueryData<NodeResponse[]>(
			nodeKeys.children(newParentId),
			spliceBlock(target, moved, indexFor(target.length)),
		);
	}
	for (const row of moved) {
		const previous = queryClient.getQueryData<NodeResponse>(nodeKeys.detail(row.id));
		snapshots.push({kind: "detail", nodeId: row.id, previous});
		if (previous) {
			queryClient.setQueryData<NodeResponse>(nodeKeys.detail(row.id), {...previous, parent_id: newParentId});
		}
	}
	return snapshots;
}

/** Roll every snapshotted cache entry back to its pre-mutation value. */
function restoreSnapshots(queryClient: QueryClient, snapshots: CacheSnapshot[] | undefined): void {
	for (const snapshot of snapshots ?? []) {
		if (snapshot.previous === undefined) {
			continue;
		}
		const key =
			snapshot.kind === "children" ? nodeKeys.children(snapshot.parentId) : nodeKeys.detail(snapshot.nodeId);
		queryClient.setQueryData(key, snapshot.previous);
	}
}

/**
 * Toggles node completion status with optimistic update.
 * If completed, uncompletes. If not completed, completes.
 */
export function useToggleComplete() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);

	return useMutation({
		mutationFn: async ({nodeId, isCurrentlyCompleted}: {nodeId: string; isCurrentlyCompleted: boolean}) =>
			isCurrentlyCompleted ? uncompleteNode(nodeId) : completeNode(nodeId),
		async onMutate({nodeId, isCurrentlyCompleted}) {
			// Cancel outgoing refetches
			await queryClient.cancelQueries({queryKey: nodeKeys.detail(nodeId)});
			await queryClient.cancelQueries({queryKey: nodeKeys.all});

			// Snapshot previous values
			const previousNode = queryClient.getQueryData<NodeResponse>(nodeKeys.detail(nodeId));

			// Optimistically update the node
			const newCompletedAt = isCurrentlyCompleted ? null : Math.floor(Date.now() / 1000);

			if (previousNode) {
				queryClient.setQueryData<NodeResponse>(nodeKeys.detail(nodeId), {
					...previousNode,
					completedAt: newCompletedAt,
					modifiedAt: Math.floor(Date.now() / 1000),
				});
			}

			// Also update the node in its parent's children list
			const parentId = previousNode?.parent_id ?? null;
			const previousChildren = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(parentId));
			if (previousChildren) {
				queryClient.setQueryData<NodeResponse[]>(
					nodeKeys.children(parentId),
					previousChildren.map((node) =>
						node.id === nodeId
							? {...node, completedAt: newCompletedAt, modifiedAt: Math.floor(Date.now() / 1000)}
							: node,
					),
				);
			}

			return {nodeId, previousNode, parentId, previousChildren};
		},
		onError(error, _variables, context) {
			// Roll back to previous values on error
			if (context?.previousNode !== undefined) {
				queryClient.setQueryData(nodeKeys.detail(context.nodeId), context.previousNode);
			}
			if (context?.previousChildren !== undefined) {
				queryClient.setQueryData(nodeKeys.children(context.parentId), context.previousChildren);
			}
			addErrorNotification(`Failed to toggle completion: ${error.message}`);
		},
		async onSettled(_data, _error, variables) {
			// Refetch to get the real data from server
			await queryClient.invalidateQueries({queryKey: nodeKeys.detail(variables.nodeId)});
			await queryClient.invalidateQueries({queryKey: nodeKeys.all});
		},
	});
}
