import {skipToken, useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useCallback} from "react";
import {HOME_TARGET} from "@workflowy/shared/types";
import type {MutateOptions, QueryClient} from "@tanstack/react-query";
import type {BacklinksResponse, NodeResponse} from "../../node-types.js";
import {expandOrCollapseAll} from "../expansion.js";
import type {TreeIndex} from "../expansion.js";
import {nodeKeys, patchCachedNode, readNode, snapshotCachedNode, spliceBlock, spliceChildren} from "../node-cache.js";
import {useOutlineStore} from "../stores/outline.js";
import {readJson} from "../read-json.js";
import {pendingCreates} from "../pending-creates.js";
import {toUndoOps} from "../tree-ops.js";
import type {UndoableMutation} from "../tree-ops.js";
import {RequestStatusError, holdUndoSlot} from "../undo-batch.js";
import type {UndoAdapter, UndoSlot} from "../undo-batch.js";
import type {UndoOp} from "../undo-history.js";

interface CreateNodeRequest {
	/** A client-generated UUID: the optimistic row carries it, so it can be edited before the reply. */
	id?: string;
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
	/** The first number of a numbered list; null clears it. */
	numberedStart?: number | null;
}

export async function fetchChildren(parentId: string | null): Promise<NodeResponse[]> {
	const url = parentId === null ? "/api/v1/nodes" : `/api/v1/nodes?parent_id=${encodeURIComponent(parentId)}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch children: ${response.statusText}`);
	}
	const data = await readJson<{nodes: NodeResponse[]}>(response);
	return pendingCreates.withPending(parentId, data.nodes);
}

export async function fetchNode(nodeId: string): Promise<NodeResponse> {
	await pendingCreates.settled([nodeId]);
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch node: ${response.statusText}`);
	}
	const data = await readJson<{node: NodeResponse}>(response);
	return data.node;
}

export async function fetchAncestors(nodeId: string): Promise<NodeResponse[]> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/ancestors`);
	if (!response.ok) {
		throw new Error(`Failed to fetch ancestors: ${response.statusText}`);
	}
	const data = await readJson<{ancestors: NodeResponse[]}>(response);
	return data.ancestors;
}

async function createNode(request: CreateNodeRequest): Promise<NodeResponse> {
	await pendingCreates.prior(request.id);
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
	await pendingCreates.settled([nodeId]);
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}`, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(request),
	});
	if (!response.ok) {
		throw new RequestStatusError(response.status, `Failed to update node: ${response.statusText}`);
	}
	const data = await readJson<{node: NodeResponse}>(response);
	return data.node;
}

/** Home's own metadata: its layoutMode ("bullets" when unset). */
interface HomeResponse {
	layoutMode: string;
}

async function fetchHome(): Promise<HomeResponse> {
	const response = await fetch("/api/v1/home");
	if (!response.ok) {
		throw new RequestStatusError(response.status, `Failed to fetch home: ${response.statusText}`);
	}
	return readJson<HomeResponse>(response);
}

/** Home accepts only a layoutMode (Bullets or Board). */
async function updateHome(layoutMode: string): Promise<HomeResponse> {
	const response = await fetch(`/api/v1/nodes/${HOME_TARGET}`, {
		method: "PATCH",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({layoutMode}),
	});
	if (!response.ok) {
		throw new RequestStatusError(response.status, `Failed to update home: ${response.statusText}`);
	}
	return readJson<HomeResponse>(response);
}

async function deleteNode(nodeId: string): Promise<void> {
	await pendingCreates.settled([nodeId]);
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}`, {
		method: "DELETE",
	});
	if (!response.ok) {
		throw new RequestStatusError(response.status, `Failed to delete node: ${response.statusText}`);
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
	await pendingCreates.settled([nodeId, request.parent_id]);
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/move`, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(request),
	});
	if (!response.ok) {
		throw new RequestStatusError(response.status, `Failed to move node: ${response.statusText}`);
	}
	return readJson<MoveNodeResponse>(response);
}

interface RestoreNodeRequest {
	parent_id: string | null;
	/** Exact slot among the parent's children (completed included). */
	index: number;
}

/**
 * Brings a deleted node back under its ORIGINAL id (subtree, note and completion as the server kept
 * them). Needs the Workflowy internal API: the server answers 503 without it, kept as `status`.
 */
export async function restoreNode(nodeId: string, request: RestoreNodeRequest): Promise<NodeResponse> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/restore`, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(request),
	});
	if (!response.ok) {
		throw new RequestStatusError(response.status, `Failed to restore node: ${response.statusText}`);
	}
	const data = await readJson<{node: NodeResponse}>(response);
	return data.node;
}

async function completeNode(nodeId: string): Promise<NodeResponse> {
	await pendingCreates.settled([nodeId]);
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/complete`, {
		method: "POST",
	});
	if (!response.ok) {
		throw new RequestStatusError(response.status, `Failed to complete node: ${response.statusText}`);
	}
	const data = await readJson<{node: NodeResponse}>(response);
	return data.node;
}

async function uncompleteNode(nodeId: string): Promise<NodeResponse> {
	await pendingCreates.settled([nodeId]);
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/uncomplete`, {
		method: "POST",
	});
	if (!response.ok) {
		throw new RequestStatusError(response.status, `Failed to uncomplete node: ${response.statusText}`);
	}
	const data = await readJson<{node: NodeResponse}>(response);
	return data.node;
}

/** The raw server calls `applyOps` replays an undo step through (no optimistic cache writes). */
export const undoAdapter: UndoAdapter = {
	updateNode,
	deleteNode,
	restoreNode,
	moveNode,
	completeNode,
	uncompleteNode,
};

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

/** Home's layoutMode from `GET /api/v1/home` (the zoom root's layout when not zoomed). */
export function useHome() {
	return useQuery({queryKey: nodeKeys.home(), queryFn: fetchHome});
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

/** The exact `index` a create/move asks for, or undefined for the bottom (see `requestedIndex`). */
function exactIndex(request: {index?: number; position?: number}): number | undefined {
	return request.index ?? (request.position !== undefined && request.position < 0 ? 0 : undefined);
}

type Mutate<TData, TVariables, TContext> = (
	variables: TVariables,
	options?: MutateOptions<TData, Error, TVariables, TContext>,
) => void;

interface HeldUndo<TData> {
	slot: UndoSlot;
	finish(data: TData): UndoOp[];
}

/** One hook's undo slots of mutations in flight, keyed by their variables (first in, first out). */
class HeldUndos<TData, TVariables> {
	readonly #held = new Map<TVariables, HeldUndo<TData>[]>();

	hold(variables: TVariables, finish: (data: TData) => UndoOp[]): void {
		const held = this.#held.get(variables) ?? [];
		held.push({slot: holdUndoSlot(), finish});
		this.#held.set(variables, held);
	}

	/** Settles the oldest slot for `variables`: its ops on success, none on failure. */
	settle(variables: TVariables, outcome: {data: TData} | "failed"): void {
		const held = this.#held.get(variables);
		const next = held?.shift();
		if (held?.length === 0) {
			this.#held.delete(variables);
		}
		next?.slot.settle(outcome === "failed" ? [] : next.finish(outcome.data));
	}
}

/**
 * Wraps `mutate` so each call reserves its undo slot NOW, reading the before-values from the
 * cache before any optimistic write; the hook's `onSuccess`/`onError` settle it through `held`.
 */
function useUndoableMutate<TData, TVariables, TContext>(
	mutate: Mutate<TData, TVariables, TContext>,
	held: HeldUndos<TData, TVariables>,
	plan: (variables: TVariables) => (data: TData) => UndoOp[],
): Mutate<TData, TVariables, TContext> {
	return useCallback<Mutate<TData, TVariables, TContext>>(
		(variables, options) => {
			held.hold(variables, plan(variables));
			mutate(variables, options);
		},
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- `plan` reads only its arguments and the stable query client
		[mutate, held],
	);
}

/** A plan for mutations whose ops are fully known from the cache before they run. */
function cachedOps(queryClient: QueryClient, mutation: UndoableMutation): () => UndoOp[] {
	const ops = toUndoOps(mutation, queryClient);
	return () => ops;
}

const createUndos = new HeldUndos<NodeResponse, CreateNodeRequest>();

/**
 * Creates a new node with optimistic update.
 */
export function useCreateNode() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);
	const beginMutation = useOutlineStore((state) => state.beginMutation);
	const endMutation = useOutlineStore((state) => state.endMutation);

	const mutation = useMutation({
		mutationFn: createNode,
		async onMutate(newNode) {
			beginMutation();
			const early = earlyCreates.get(newNode);
			if (early) {
				return early;
			}
			// Cancel outgoing refetches to avoid overwriting optimistic update
			await queryClient.cancelQueries({queryKey: nodeKeys.children(newNode.parent_id ?? null)});
			return insertOptimisticCreate(queryClient, newNode);
		},
		onSuccess(createdNode, variables) {
			createUndos.settle(variables, {data: createdNode});
			// The public-API fallback cannot honor a client id: follow the caret to the real one.
			const {editingId, startEditing, markCreatedForSearch} = useOutlineStore.getState();
			markCreatedForSearch(createdNode.id);
			if (variables.id !== undefined && createdNode.id !== variables.id && editingId === variables.id) {
				startEditing(createdNode.id);
			}
		},
		onError(error, variables, context) {
			createUndos.settle(variables, "failed");
			// Roll back to previous value on error
			if (context?.previousChildren !== undefined) {
				queryClient.setQueryData(nodeKeys.children(context.parentId), context.previousChildren);
			}
			addErrorNotification(`Failed to create node: ${error.message}`);
		},
		async onSettled(_data, _error, variables) {
			endMutation();
			if (variables.id !== undefined) {
				pendingCreates.end(variables.id);
			}
			// Refetch to get the real data from server
			const parentId = variables.parent_id ?? null;
			await queryClient.invalidateQueries({queryKey: nodeKeys.children(parentId)});
		},
	});
	const {mutate} = mutation;

	/**
	 * A create under a client id inserts its optimistic row synchronously, in the same
	 * render as the caller's startEditing, so the row's editor mounts at once (no keystroke
	 * gap) and the edited node's reads already wait on pendingCreates.
	 */
	const mutateNow = useCallback<typeof mutate>(
		(request, options) => {
			if (request.id !== undefined) {
				earlyCreates.set(request, insertOptimisticCreate(queryClient, request));
			}
			mutate(request, options);
		},
		[mutate, queryClient],
	);
	// Outermost, so the slot is read before `mutateNow`'s optimistic insert.
	const undoableMutate = useUndoableMutate(mutateNow, createUndos, (request) => {
		const parentId = request.parent_id ?? null;
		const [op] = toUndoOps({kind: "create", nodeId: "", parentId, index: exactIndex(request)}, queryClient);
		// The public-API fallback may answer another id than the client one.
		return (created) => (op === undefined ? [] : [{...op, nodeId: created.id}]);
	});
	return {...mutation, mutate: undoableMutate};
}

interface CreateContext {
	previousChildren: NodeResponse[] | undefined;
	parentId: string | null;
}

/** Optimistic inserts `mutate` already made, handed to `onMutate` by request identity. */
const earlyCreates = new WeakMap<CreateNodeRequest, CreateContext>();

/** Splice the optimistic row for `newNode` into its parent's cached children (tracking it when it has a client id). */
function insertOptimisticCreate(queryClient: QueryClient, newNode: CreateNodeRequest): CreateContext {
	const parentId = newNode.parent_id ?? null;
	const previousChildren = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(parentId));
	const now = Math.floor(Date.now() / 1000);
	const optimisticNode: NodeResponse = {
		id: newNode.id ?? `temp-${Date.now()}`,
		parent_id: parentId,
		name: newNode.name,
		note: newNode.note ?? null,
		priority: 0,
		data: {layoutMode: newNode.layoutMode ?? null},
		createdAt: now,
		modifiedAt: now,
		completedAt: null,
	};
	const siblings = previousChildren ?? [];
	const index = requestedIndex(newNode, siblings.length);
	if (newNode.id !== undefined) {
		pendingCreates.begin(optimisticNode, index);
		// The editor mounts on this row at once, so a search must show it before the server answers.
		useOutlineStore.getState().markCreatedForSearch(newNode.id);
	}
	queryClient.setQueryData<NodeResponse[]>(
		nodeKeys.children(parentId),
		spliceChildren(siblings, optimisticNode, index),
	);
	return {previousChildren, parentId};
}

const updateUndos = new HeldUndos<NodeResponse, UpdateNodeRequest & {nodeId: string}>();

/**
 * The cache as it stood when `mutate` was called, keyed by its variables. `onMutate` runs a
 * tick later, after callers may already have previewed the edit in the cache (tag explode does),
 * so a snapshot taken there would roll a failed save back to the edited value.
 */
const preEditSnapshots = new WeakMap<UpdateNodeRequest & {nodeId: string}, () => void>();

/**
 * Updates a node with optimistic update.
 */
export function useUpdateNode() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);

	const mutation = useMutation({
		mutationFn: async ({nodeId, ...request}: UpdateNodeRequest & {nodeId: string}) => updateNode(nodeId, request),
		async onMutate(variables) {
			const {nodeId, ...updates} = variables;
			// Cancel outgoing refetches
			await queryClient.cancelQueries({queryKey: nodeKeys.detail(nodeId)});
			// Patch the row in its parent's list too: an empty row's name drives whether its editor stays mounted.
			const restorePatched = patchCachedNode(queryClient, nodeId, (node) => ({
				...node,
				name: updates.name ?? node.name,
				note: updates.note ?? node.note,
				data: {...node.data, layoutMode: updates.layoutMode ?? node.data.layoutMode},
				...(updates.numberedStart === undefined ? {} : {numberedStart: updates.numberedStart}),
				modifiedAt: Math.floor(Date.now() / 1000),
			}));
			const restorePreEdit = preEditSnapshots.get(variables);
			preEditSnapshots.delete(variables);
			return {
				restore() {
					restorePatched();
					restorePreEdit?.();
				},
			};
		},
		onSuccess(data, variables) {
			updateUndos.settle(variables, {data});
		},
		onError(error, variables, context) {
			updateUndos.settle(variables, "failed");
			// Roll back to previous value on error
			context?.restore();
			addErrorNotification(`Failed to update node: ${error.message}`);
		},
		async onSettled(_data, _error, variables) {
			// Refetch to get the real data from server
			await queryClient.invalidateQueries({queryKey: nodeKeys.detail(variables.nodeId)});
			// Also invalidate any children queries that might contain this node
			await queryClient.invalidateQueries({queryKey: nodeKeys.all});
		},
	});
	const nodeMutate = useUndoableMutate(mutation.mutate, updateUndos, ({nodeId, name, note}) =>
		cachedOps(queryClient, {kind: "edit", nodeId, name, note}),
	);
	const homeMutation = useMutation({
		mutationFn: updateHome,
		async onMutate(layoutMode) {
			await queryClient.cancelQueries({queryKey: nodeKeys.home()});
			const previous = queryClient.getQueryData<HomeResponse>(nodeKeys.home());
			queryClient.setQueryData<HomeResponse>(nodeKeys.home(), {layoutMode});
			return {previous};
		},
		onError(error, _layoutMode, context) {
			queryClient.setQueryData(nodeKeys.home(), context?.previous);
			addErrorNotification(`Failed to update home: ${error.message}`);
		},
		async onSettled() {
			await queryClient.invalidateQueries({queryKey: nodeKeys.home()});
		},
	});
	const homeMutate = homeMutation.mutate;
	// `nodeId: "home"` writes Home's layoutMode, the only field Home has.
	const mutate = useCallback<typeof nodeMutate>(
		(variables, options) => {
			if (variables.nodeId === HOME_TARGET) {
				if (variables.layoutMode !== undefined) {
					homeMutate(variables.layoutMode);
				}
				return;
			}
			preEditSnapshots.set(variables, snapshotCachedNode(queryClient, variables.nodeId));
			nodeMutate(variables, options);
		},
		[homeMutate, nodeMutate, queryClient],
	);
	return {...mutation, mutate};
}

const deleteUndos = new HeldUndos<void, string>();

/**
 * Deletes a node with optimistic update.
 */
export function useDeleteNode() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);
	const beginMutation = useOutlineStore((state) => state.beginMutation);
	const endMutation = useOutlineStore((state) => state.endMutation);

	const mutation = useMutation({
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
		onSuccess(data, nodeId) {
			deleteUndos.settle(nodeId, {data});
		},
		async onError(error, nodeId, context) {
			deleteUndos.settle(nodeId, "failed");
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
	const mutate = useUndoableMutate(mutation.mutate, deleteUndos, (nodeId) =>
		cachedOps(queryClient, {kind: "delete", nodeId}),
	);
	return {...mutation, mutate};
}

const moveUndos = new HeldUndos<MoveNodeResponse, MoveNodeRequest & {nodeId: string}>();

/**
 * Moves a node to `index` under `parent_id` (same parent or another) with an
 * optimistic splice: the row is removed then inserted at the index, never duplicated.
 */
export function useMoveNode() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);
	const beginMutation = useOutlineStore((state) => state.beginMutation);
	const endMutation = useOutlineStore((state) => state.endMutation);

	const mutation = useMutation({
		mutationFn: async ({nodeId, ...request}: MoveNodeRequest & {nodeId: string}) => moveNode(nodeId, request),
		async onMutate(request) {
			beginMutation();
			await queryClient.cancelQueries({queryKey: nodeKeys.all});
			const node = readNode(queryClient, request.nodeId);
			return node
				? spliceMovedRows(queryClient, [node], request.parent_id, (count) => requestedIndex(request, count))
				: [];
		},
		onSuccess(data, variables) {
			moveUndos.settle(variables, {data});
		},
		onError(error, variables, snapshots) {
			moveUndos.settle(variables, "failed");
			restoreSnapshots(queryClient, snapshots);
			addErrorNotification(`Failed to move node: ${error.message}`);
		},
		async onSettled() {
			endMutation();
			await queryClient.invalidateQueries({queryKey: nodeKeys.all});
		},
	});
	const mutate = useUndoableMutate(mutation.mutate, moveUndos, (request) =>
		cachedOps(queryClient, {
			kind: "move",
			ids: [request.nodeId],
			parentId: request.parent_id,
			index: exactIndex(request),
		}),
	);
	return {...mutation, mutate};
}

interface MoveNodesRequest {
	ids: string[];
	parent_id: string | null;
	/** Slot among ALL of the new parent's children, moved ones included (see `spliceBlock`); omitted = bottom. */
	index?: number;
}

async function moveNodes(request: MoveNodesRequest): Promise<NodeResponse[]> {
	await pendingCreates.settled([...request.ids, request.parent_id]);
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

const moveNodesUndos = new HeldUndos<NodeResponse[], MoveNodesRequest>();

/**
 * Moves a contiguous block of nodes, in the given order, to `index` under `parent_id`
 * in one call (multi-select, drag, Sort). Splices optimistically, then applies the
 * server's sibling lists for every touched parent.
 */
export function useMoveNodes() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);
	const beginMutation = useOutlineStore((state) => state.beginMutation);
	const endMutation = useOutlineStore((state) => state.endMutation);

	const mutation = useMutation({
		mutationFn: moveNodes,
		async onMutate(request) {
			beginMutation();
			await queryClient.cancelQueries({queryKey: nodeKeys.all});
			const rows = request.ids
				.map((id) => readNode(queryClient, id))
				.filter((row): row is NodeResponse => row !== undefined);
			return spliceMovedRows(queryClient, rows, request.parent_id, (count) => request.index ?? count);
		},
		onSuccess(nodes, variables, snapshots) {
			moveNodesUndos.settle(variables, {data: nodes});
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
		async onError(error, variables, snapshots) {
			moveNodesUndos.settle(variables, "failed");
			restoreSnapshots(queryClient, snapshots);
			addErrorNotification(`Failed to move nodes: ${error.message}`);
			await queryClient.invalidateQueries({queryKey: nodeKeys.all});
		},
		onSettled() {
			endMutation();
		},
	});
	const mutate = useUndoableMutate(mutation.mutate, moveNodesUndos, ({ids, parent_id: parentId, index}) =>
		cachedOps(queryClient, {kind: "move", ids, parentId, index}),
	);
	return {...mutation, mutate};
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

const toggleUndos = new HeldUndos<NodeResponse, {nodeId: string; isCurrentlyCompleted: boolean}>();

/**
 * Toggles node completion status with optimistic update.
 * If completed, uncompletes. If not completed, completes.
 */
export function useToggleComplete() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);

	const mutation = useMutation({
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
		onSuccess(data, variables) {
			toggleUndos.settle(variables, {data});
		},
		onError(error, variables, context) {
			toggleUndos.settle(variables, "failed");
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
	const mutate = useUndoableMutate(mutation.mutate, toggleUndos, ({nodeId, isCurrentlyCompleted}) =>
		cachedOps(queryClient, {kind: isCurrentlyCompleted ? "uncomplete" : "complete", nodeId}),
	);
	return {...mutation, mutate};
}

const restoreUndos = new HeldUndos<NodeResponse, RestoreNodeRequest & {nodeId: string}>();

/** Restores a deleted node under its original id, then refetches every node query. */
// fallow-ignore-next-line unused-export -- callers land with undo/redo commands (M2-60, M2-61)
export function useRestoreNode() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);
	const beginMutation = useOutlineStore((state) => state.beginMutation);
	const endMutation = useOutlineStore((state) => state.endMutation);

	const mutation = useMutation({
		mutationFn: async ({nodeId, ...request}: RestoreNodeRequest & {nodeId: string}) => restoreNode(nodeId, request),
		onMutate() {
			beginMutation();
		},
		onSuccess(data, variables) {
			restoreUndos.settle(variables, {data});
		},
		onError(error, variables) {
			restoreUndos.settle(variables, "failed");
			addErrorNotification(error.message);
		},
		async onSettled() {
			endMutation();
			await queryClient.invalidateQueries({queryKey: nodeKeys.all});
		},
	});
	const mutate = useUndoableMutate(mutation.mutate, restoreUndos, ({nodeId, parent_id: parentId, index}) =>
		cachedOps(queryClient, {kind: "restore", nodeId, parentId, index}),
	);
	return {...mutation, mutate};
}

/** One descendant row from `GET /api/v1/nodes/:id/subtree-ids`. */
interface SubtreeItem {
	id: string;
	parentId: string | null;
	completed: boolean;
	hasChildren: boolean;
}

/** The whole cached subtree of `rootId` (Home's tree for null), independent of what the client has loaded. */
async function fetchSubtreeItems(rootId: string | null): Promise<SubtreeItem[]> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(rootId ?? HOME_TARGET)}/subtree-ids`);
	if (!response.ok) {
		throw new Error(`Failed to fetch subtree: ${response.statusText}`);
	}
	const data = await readJson<{items: SubtreeItem[]}>(response);
	return data.items;
}

/** A `TreeIndex` over the subtree rows; Home's top-level rows sit under the `home` key. */
function subtreeIndex(items: readonly SubtreeItem[], showCompleted: boolean): TreeIndex {
	const children = new Map<string, string[]>();
	const completed = new Set<string>();
	for (const item of items) {
		const key = item.parentId ?? HOME_TARGET;
		children.set(key, [...(children.get(key) ?? []), item.id]);
		if (item.completed) {
			completed.add(item.id);
		}
	}
	const isVisible = (id: string) => showCompleted || !completed.has(id);
	return {
		children: (id) => children.get(id) ?? [],
		isVisible,
		hasVisibleChildren: (id) => (children.get(id) ?? []).some(isVisible),
	};
}

/**
 * Upstream Expand all / Collapse all on `rootId` (the whole page for Home): fetches the full subtree so
 * descendants the client never loaded are covered, then sets their expansion; hidden completed subtrees are skipped.
 */
export async function expandOrCollapseSubtree(rootId: string | null, open: boolean): Promise<void> {
	const items = await fetchSubtreeItems(rootId);
	const {expandedIds, showCompleted, replaceExpanded} = useOutlineStore.getState();
	const index = subtreeIndex(items, showCompleted);
	const roots = rootId === null ? index.children(HOME_TARGET).filter((id) => index.isVisible(id)) : [rootId];
	let next = new Set<string>(expandedIds);
	for (const root of roots) {
		next = expandOrCollapseAll(next, index, root, open);
	}
	replaceExpanded(next);
}

/** `expandOrCollapseSubtree` that reports a failed subtree fetch as an error notification. */
export function useExpandAll(): (rootId: string | null, open: boolean) => void {
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);
	return useCallback(
		(rootId, open) => {
			expandOrCollapseSubtree(rootId, open).catch((error: unknown) => {
				addErrorNotification(error instanceof Error ? error.message : String(error));
			});
		},
		[addErrorNotification],
	);
}
