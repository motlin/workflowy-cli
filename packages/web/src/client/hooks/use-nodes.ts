import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useOutlineStore} from '../stores/outline.js';

/**
 * Response format matching Workflowy API.
 * Matches NodeResponse from server/routes/nodes.ts
 */
interface NodeResponse {
	id: string;
	parent_id: string | null;
	name: string | null;
	note: string | null;
	priority: number;
	data: {layoutMode: string | null};
	createdAt: number | null;
	modifiedAt: number | null;
	completedAt: number | null;
	hasChildren?: boolean;
	isMirror?: boolean;
	attachment?: NodeAttachment | null;
}

/**
 * File attachment metadata for a node. Mirrors NodeAttachment from
 * server/routes/nodes.ts. `isDeleted` marks attachments whose underlying file
 * Workflowy has removed — the client renders these as deleted rather than live.
 */
interface NodeAttachment {
	fileName: string;
	fileType: string;
	objectFolder: string | null;
	imageOriginalWidth: number | null;
	imageOriginalHeight: number | null;
	isDeleted: boolean;
}

interface CreateNodeRequest {
	parent_id?: string;
	name: string;
	note?: string;
	layoutMode?: string;
	position?: number;
}

interface UpdateNodeRequest {
	name?: string;
	note?: string;
	layoutMode?: string;
}

const nodeKeys = {
	all: ['nodes'] as const,
	children: (parentId: string | null) => [...nodeKeys.all, 'children', parentId] as const,
	detail: (nodeId: string) => [...nodeKeys.all, 'detail', nodeId] as const,
	ancestors: (nodeId: string) => [...nodeKeys.all, 'ancestors', nodeId] as const,
};

async function fetchChildren(parentId: string | null): Promise<NodeResponse[]> {
	const url = parentId === null ? '/api/v1/nodes' : `/api/v1/nodes?parent_id=${encodeURIComponent(parentId)}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch children: ${response.statusText}`);
	}
	const data = (await response.json()) as {nodes: NodeResponse[]};
	return data.nodes;
}

async function fetchNode(nodeId: string): Promise<NodeResponse> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch node: ${response.statusText}`);
	}
	const data = (await response.json()) as {node: NodeResponse};
	return data.node;
}

async function fetchAncestors(nodeId: string): Promise<NodeResponse[]> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/ancestors`);
	if (!response.ok) {
		throw new Error(`Failed to fetch ancestors: ${response.statusText}`);
	}
	const data = (await response.json()) as {ancestors: NodeResponse[]};
	return data.ancestors;
}

async function createNode(request: CreateNodeRequest): Promise<NodeResponse> {
	const response = await fetch('/api/v1/nodes', {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify(request),
	});
	if (!response.ok) {
		throw new Error(`Failed to create node: ${response.statusText}`);
	}
	return response.json() as Promise<NodeResponse>;
}

async function updateNode(nodeId: string, request: UpdateNodeRequest): Promise<NodeResponse> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}`, {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify(request),
	});
	if (!response.ok) {
		throw new Error(`Failed to update node: ${response.statusText}`);
	}
	const data = (await response.json()) as {node: NodeResponse};
	return data.node;
}

async function deleteNode(nodeId: string): Promise<void> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}`, {
		method: 'DELETE',
	});
	if (!response.ok) {
		throw new Error(`Failed to delete node: ${response.statusText}`);
	}
}

interface MoveNodeRequest {
	parent_id: string | null;
	position?: number;
}

interface MoveNodeResponse {
	node: NodeResponse;
	oldParentId: string | null;
}

async function moveNode(nodeId: string, request: MoveNodeRequest): Promise<MoveNodeResponse> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/move`, {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify(request),
	});
	if (!response.ok) {
		throw new Error(`Failed to move node: ${response.statusText}`);
	}
	return response.json() as Promise<MoveNodeResponse>;
}

async function completeNode(nodeId: string): Promise<NodeResponse> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/complete`, {
		method: 'POST',
	});
	if (!response.ok) {
		throw new Error(`Failed to complete node: ${response.statusText}`);
	}
	const data = (await response.json()) as {node: NodeResponse};
	return data.node;
}

async function uncompleteNode(nodeId: string): Promise<NodeResponse> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/uncomplete`, {
		method: 'POST',
	});
	if (!response.ok) {
		throw new Error(`Failed to uncomplete node: ${response.statusText}`);
	}
	const data = (await response.json()) as {node: NodeResponse};
	return data.node;
}

/**
 * Fetches children of a parent node (or root nodes if parentId is null).
 */
export function useChildren(parentId: string | null) {
	return useQuery({
		queryKey: nodeKeys.children(parentId),
		queryFn: () => fetchChildren(parentId),
	});
}

/**
 * Fetches a single node by ID.
 * Returns null data if nodeId is empty (disabled query).
 */
export function useNode(nodeId: string | null) {
	return useQuery({
		queryKey: nodeKeys.detail(nodeId ?? ''),
		queryFn: () => fetchNode(nodeId!),
		enabled: nodeId !== null && nodeId !== '',
	});
}

/**
 * Fetches all ancestors of a node from root to the node itself.
 * Returns empty array if nodeId is null (at root level).
 */
export function useAncestors(nodeId: string | null) {
	return useQuery({
		queryKey: nodeKeys.ancestors(nodeId ?? ''),
		queryFn: () => fetchAncestors(nodeId!),
		enabled: nodeId !== null && nodeId !== '',
	});
}

/**
 * Creates a new node with optimistic update.
 */
export function useCreateNode() {
	const queryClient = useQueryClient();
	const addErrorNotification = useOutlineStore((state) => state.addErrorNotification);
	const setMutating = useOutlineStore((state) => state.setMutating);

	return useMutation({
		mutationFn: createNode,
		async onMutate(newNode) {
			setMutating(true);
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
				priority: newNode.position ?? 0,
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
			setMutating(false);
			// Roll back to previous value on error
			if (context?.previousChildren !== undefined) {
				queryClient.setQueryData(nodeKeys.children(context.parentId), context.previousChildren);
			}
			addErrorNotification(`Failed to create node: ${error.message}`);
		},
		async onSettled(_data, _error, variables) {
			setMutating(false);
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
		mutationFn: ({nodeId, ...request}: UpdateNodeRequest & {nodeId: string}) => updateNode(nodeId, request),
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
	const setMutating = useOutlineStore((state) => state.setMutating);

	return useMutation({
		mutationFn: deleteNode,
		async onMutate(nodeId) {
			setMutating(true);
			// Get the node to find its parent
			const node = queryClient.getQueryData<NodeResponse>(nodeKeys.detail(nodeId));

			// We need to find which children query contains this node
			// Since we do not have parentId in NodeResponse, we invalidate all
			// Cancel outgoing refetches
			await queryClient.cancelQueries({queryKey: nodeKeys.all});

			return {nodeId, previousNode: node};
		},
		async onError(error, _variables, context) {
			setMutating(false);
			// On error, we just refetch everything since rollback is complex
			if (context?.previousNode !== undefined) {
				await queryClient.invalidateQueries({queryKey: nodeKeys.all});
			}
			addErrorNotification(`Failed to delete node: ${error.message}`);
		},
		async onSettled() {
			setMutating(false);
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
	const setMutating = useOutlineStore((state) => state.setMutating);

	return useMutation({
		mutationFn: ({nodeId, ...request}: MoveNodeRequest & {nodeId: string}) => moveNode(nodeId, request),
		async onMutate({nodeId, parent_id: newParentId}) {
			setMutating(true);
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
			setMutating(false);
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
			setMutating(false);
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
		mutationFn: ({nodeId, parentId, position}: {nodeId: string; parentId: string | null; position: number}) =>
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
				const newChildren = [...otherChildren, reorderedNode].sort((a, b) => a.priority - b.priority);

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
		mutationFn: ({nodeId, isCurrentlyCompleted}: {nodeId: string; isCurrentlyCompleted: boolean}) =>
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
