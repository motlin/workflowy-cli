import {skipToken, useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import type {BacklinksResponse, NodeResponse} from "../../node-types.js";
import {nodeKeys} from "../node-cache.js";
import {useOutlineStore} from "../stores/outline.js";
import {readJson} from "../read-json.js";
import {priorityAtIndex} from "../tree-position.js";

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
				priority: newNode.position ?? priorityAtIndex(previousChildren ?? [], newNode.index),
				data: {layoutMode: newNode.layoutMode ?? null},
				createdAt: Math.floor(Date.now() / 1000),
				modifiedAt: Math.floor(Date.now() / 1000),
				completedAt: null,
			};

			queryClient.setQueryData<NodeResponse[]>(nodeKeys.children(parentId), (old) =>
				old ? [...old, optimisticNode] : [optimisticNode],
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
 * Moves a node to a new parent with optimistic update.
 */
export function useMoveNode() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);
	const beginMutation = useOutlineStore((state) => state.beginMutation);
	const endMutation = useOutlineStore((state) => state.endMutation);

	return useMutation({
		mutationFn: async ({nodeId, ...request}: MoveNodeRequest & {nodeId: string}) => moveNode(nodeId, request),
		async onMutate({nodeId, parent_id: newParentId}) {
			beginMutation();
			// Cancel outgoing refetches for all nodes
			await queryClient.cancelQueries({queryKey: nodeKeys.all});

			// Get the node to find its current parent
			const node = queryClient.getQueryData<NodeResponse>(nodeKeys.detail(nodeId));
			const oldParentId = node?.parent_id ?? null;

			// Snapshot previous children lists
			const previousOldParentChildren = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(oldParentId));
			const previousNewParentChildren = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(newParentId));

			// Optimistically remove from old parent
			if (previousOldParentChildren) {
				queryClient.setQueryData<NodeResponse[]>(
					nodeKeys.children(oldParentId),
					previousOldParentChildren.filter((n) => n.id !== nodeId),
				);
			}

			// Optimistically add to new parent
			if (node && previousNewParentChildren) {
				const movedNode = {...node, parent_id: newParentId};
				queryClient.setQueryData<NodeResponse[]>(nodeKeys.children(newParentId), [
					...previousNewParentChildren,
					movedNode,
				]);
			}

			// Update node detail cache
			if (node) {
				queryClient.setQueryData<NodeResponse>(nodeKeys.detail(nodeId), {
					...node,
					parent_id: newParentId,
				});
			}

			return {
				nodeId,
				oldParentId,
				newParentId,
				previousOldParentChildren,
				previousNewParentChildren,
				previousNode: node,
			};
		},
		onError(error, _variables, context) {
			// Roll back to previous values on error
			if (context) {
				if (context.previousOldParentChildren !== undefined) {
					queryClient.setQueryData(nodeKeys.children(context.oldParentId), context.previousOldParentChildren);
				}
				if (context.previousNewParentChildren !== undefined) {
					queryClient.setQueryData(nodeKeys.children(context.newParentId), context.previousNewParentChildren);
				}
				if (context.previousNode !== undefined) {
					queryClient.setQueryData(nodeKeys.detail(context.nodeId), context.previousNode);
				}
			}
			addErrorNotification(`Failed to move node: ${error.message}`);
		},
		async onSettled() {
			endMutation();
			// Refetch to get the real data from server
			await queryClient.invalidateQueries({queryKey: nodeKeys.all});
		},
	});
}

/**
 * Reorders a node among its siblings (same parent) with optimistic update.
 * Used for drag-and-drop reordering within the same level.
 */
export function useReorderNode() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);

	return useMutation({
		mutationFn: async ({nodeId, parentId, position}: {nodeId: string; parentId: string | null; position: number}) =>
			moveNode(nodeId, {parent_id: parentId, position}),
		async onMutate({nodeId, parentId, position}) {
			// Cancel outgoing refetches for all nodes
			await queryClient.cancelQueries({queryKey: nodeKeys.all});

			// Get the node
			const node = queryClient.getQueryData<NodeResponse>(nodeKeys.detail(nodeId));

			// Snapshot previous children list
			const previousChildren = queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(parentId));

			// Optimistically reorder within the same parent
			if (node && previousChildren) {
				const otherChildren = previousChildren.filter((n) => n.id !== nodeId);
				const reorderedNode = {...node, priority: position};

				// Insert at new position and update priorities
				const newChildren = [...otherChildren, reorderedNode].toSorted((a, b) => a.priority - b.priority);

				queryClient.setQueryData<NodeResponse[]>(nodeKeys.children(parentId), newChildren);
			}

			// Update node detail cache with new priority
			if (node) {
				queryClient.setQueryData<NodeResponse>(nodeKeys.detail(nodeId), {
					...node,
					priority: position,
				});
			}

			return {
				nodeId,
				parentId,
				previousChildren,
				previousNode: node,
			};
		},
		onError(error, _variables, context) {
			// Roll back to previous values on error
			if (context) {
				if (context.previousChildren !== undefined) {
					queryClient.setQueryData(nodeKeys.children(context.parentId), context.previousChildren);
				}
				if (context.previousNode !== undefined) {
					queryClient.setQueryData(nodeKeys.detail(context.nodeId), context.previousNode);
				}
			}
			addErrorNotification(`Failed to reorder node: ${error.message}`);
		},
		async onSettled() {
			// Refetch to get the real data from server
			await queryClient.invalidateQueries({queryKey: nodeKeys.all});
		},
	});
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
