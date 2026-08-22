import {TargetsResponseSchema} from '../types/targets.js';
import type {WorkflowyTarget} from '../types/targets.js';
import {
	ApiResponseSchema,
	CompletionStatusResponseSchema,
	CreateNodeResponseSchema,
	GetNodeResponseSchema,
} from '../types/workflowy.js';
import type {WorkflowyNode} from '../types/workflowy.js';

/**
 * Optional logger interface for API request/response logging.
 * Implement this interface to enable verbose logging.
 */
export interface ApiLogger {
	logRequest(url: string, method: string, body?: unknown): void;
	logResponse(url: string, method: string, status: number, statusText: string, data: unknown, duration: number): void;
	logError(url: string, method: string, error: Error, duration: number): void;
}

/**
 * Retry behavior for requests throttled with HTTP 429.
 */
export interface RetryOptions {
	/** Maximum number of retries after the initial attempt. */
	maxRetries?: number;
	/** Base delay for exponential backoff, in milliseconds. */
	baseDelayMs?: number;
	/** Upper bound for a single exponential-backoff delay, in milliseconds. */
	maxDelayMs?: number;
}

/**
 * Cap on how much of an error response body is quoted back. Enough for
 * Workflowy's block notice, short of pasting an HTML error page into a stack
 * trace.
 */
const MAX_ERROR_BODY_CHARS = 500;

const DEFAULT_MAX_RETRIES = 8;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Request object for creating a new node.
 */
export interface CreateNodeRequest {
	/**
	 * The parent node ID. Can be either:
	 * - A UUID (e.g., "a5408f02-03aa-4735-a886-4ccd128d1ad7")
	 * - A system target key (e.g., "inbox")
	 *
	 * Use isSystemTarget() to check if a string is a valid target key.
	 */
	parent_id: string;
	name: string;
	note?: string;
	layoutMode?: string;
	position?: 'top' | 'bottom';
}

/**
 * Request object for updating an existing node.
 */
export interface UpdateNodeRequest {
	name?: string;
	note?: string;
	layoutMode?: string;
}

/**
 * Unified Workflowy API client for interacting with the Workflowy API.
 *
 * Supports optional logging via dependency injection.
 */
export class WorkflowyApiClient {
	private logger?: ApiLogger;
	private baseUrl: string;
	private maxRetries: number;
	private baseDelayMs: number;
	private maxDelayMs: number;

	constructor(
		private apiKey: string,
		logger?: ApiLogger,
		baseUrl?: string,
		retryOptions?: RetryOptions,
	) {
		this.logger = logger;
		this.baseUrl = baseUrl ?? 'https://workflowy.com';
		this.maxRetries = retryOptions?.maxRetries ?? DEFAULT_MAX_RETRIES;
		this.baseDelayMs = retryOptions?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
		this.maxDelayMs = retryOptions?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
	}

	/**
	 * Build an error carrying the server's own explanation, not just the status
	 * line. Workflowy puts the only actionable detail in the response body -- an
	 * abuse-protection 403 names the support address, the blocked IP, and a
	 * reference code. Reporting a bare "403" makes an IP block indistinguishable
	 * from a bad key, an expired token, or an exhausted quota.
	 */
	private async describeFailure(prefix: string, response: Response): Promise<Error> {
		const statusLine = `${prefix}: ${response.status} ${response.statusText}`;

		let body: string;
		try {
			body = (await response.text()).trim();
		} catch {
			return new Error(statusLine);
		}

		if (!body) {
			return new Error(statusLine);
		}

		return new Error(`${statusLine}\n${body.slice(0, MAX_ERROR_BODY_CHARS)}`);
	}

	private getHeaders(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.apiKey}`,
			'Content-Type': 'application/json',
		};
	}

	/**
	 * Delay before the next retry: the Retry-After header if the server sent one,
	 * otherwise exponential backoff from baseDelayMs, capped at maxDelayMs.
	 */
	private retryDelayMs(response: Response, attempt: number): number {
		const retryAfter = response.headers?.get('retry-after');
		if (retryAfter !== null && retryAfter !== undefined) {
			const seconds = Number(retryAfter);
			if (Number.isFinite(seconds)) {
				return seconds * 1000;
			}
		}
		return Math.min(this.baseDelayMs * 2 ** attempt, this.maxDelayMs);
	}

	/**
	 * Perform a fetch, retrying on HTTP 429 with exponential backoff.
	 *
	 * Workflowy throttles per-endpoint; a recursive traversal can otherwise abort
	 * on the first 429. Non-429 responses are returned as-is for the caller to
	 * validate.
	 */
	private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
		let attempt = 0;
		for (;;) {
			const response = await fetch(url, init);
			if (response.status !== 429 || attempt >= this.maxRetries) {
				return response;
			}

			await sleep(this.retryDelayMs(response, attempt));
			attempt += 1;
		}
	}

	private async fetchNodes(url: string): Promise<WorkflowyNode[]> {
		const startTime = performance.now();
		this.logger?.logRequest(url, 'GET');

		try {
			const response = await this.fetchWithRetry(url, {
				headers: this.getHeaders(),
			});

			if (!response.ok) {
				throw await this.describeFailure('API request failed', response);
			}

			const data = await response.json();
			const duration = performance.now() - startTime;
			this.logger?.logResponse(url, 'GET', response.status, response.statusText, data, duration);

			const validatedResponse = ApiResponseSchema.parse(data);
			return validatedResponse.nodes ?? [];
		} catch (error) {
			const duration = performance.now() - startTime;
			this.logger?.logError(url, 'GET', error as Error, duration);
			throw error;
		}
	}

	/**
	 * Get all root-level nodes.
	 */
	async getRootNodes(): Promise<WorkflowyNode[]> {
		return this.fetchNodes(`${this.baseUrl}/api/v1/nodes`);
	}

	/**
	 * Get all child nodes of a given parent.
	 *
	 * @param parentId - The parent ID (UUID or system target key like "inbox")
	 */
	async getChildNodes(parentId: string): Promise<WorkflowyNode[]> {
		return this.fetchNodes(`${this.baseUrl}/api/v1/nodes?parent_id=${parentId}`);
	}

	/**
	 * Get a single child node by exact name match.
	 * Note: API still fetches all children (no server-side filtering available),
	 * but filters with exact match for consistency with CacheService.
	 * @param parentId The parent ID (null for root nodes)
	 * @param name The exact name to match
	 */
	async getChildByName(parentId: string | null, name: string): Promise<WorkflowyNode | null> {
		const children = parentId ? await this.getChildNodes(parentId) : await this.getRootNodes();

		return children.find((child) => child.name === name) ?? null;
	}

	/**
	 * Get a single node by ID.
	 */
	async getNode(nodeId: string): Promise<WorkflowyNode> {
		const url = `${this.baseUrl}/api/v1/nodes/${nodeId}`;
		const startTime = performance.now();
		this.logger?.logRequest(url, 'GET');

		try {
			const response = await fetch(url, {
				headers: this.getHeaders(),
			});

			if (!response.ok) {
				throw await this.describeFailure('Failed to get node', response);
			}

			const data = await response.json();
			const duration = performance.now() - startTime;
			this.logger?.logResponse(url, 'GET', response.status, response.statusText, data, duration);

			const getResponse = GetNodeResponseSchema.parse(data);
			return getResponse.node;
		} catch (error) {
			const duration = performance.now() - startTime;
			this.logger?.logError(url, 'GET', error as Error, duration);
			throw error;
		}
	}

	/**
	 * Create a new node.
	 *
	 * @param request - The node creation request. The parent_id can be a UUID or
	 *   a system target key like "inbox". Use isSystemTarget() to check if a
	 *   string is a valid target key.
	 * @returns The created node (constructed from request data, no additional GET required)
	 */
	async createNode(request: CreateNodeRequest): Promise<WorkflowyNode> {
		const url = `${this.baseUrl}/api/v1/nodes/`;
		const startTime = performance.now();
		this.logger?.logRequest(url, 'POST', request);

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: this.getHeaders(),
				body: JSON.stringify(request),
			});

			if (!response.ok) {
				throw await this.describeFailure('Failed to create node', response);
			}

			const data = await response.json();
			const duration = performance.now() - startTime;
			this.logger?.logResponse(url, 'POST', response.status, response.statusText, data, duration);

			const createResponse = CreateNodeResponseSchema.parse(data);
			const now = Math.floor(Date.now() / 1000);

			// Construct node from request data (no GET needed)
			// For multiline input, API creates parent + children; we return the parent info
			const nodeName = request.name.split('\n')[0].replace(/^- /, '');

			return {
				id: createResponse.item_id,
				name: nodeName,
				note: request.note ?? null,
				parent_id: request.parent_id,
				priority: request.position === 'top' ? -1 : 0,
				completed: false,
				data: request.layoutMode ? {layoutMode: request.layoutMode} : undefined,
				createdAt: now,
				modifiedAt: now,
				completedAt: null,
			};
		} catch (error) {
			const duration = performance.now() - startTime;
			this.logger?.logError(url, 'POST', error as Error, duration);
			throw error;
		}
	}

	/**
	 * Update an existing node.
	 *
	 * @param id - The node ID to update
	 * @param request - The fields to update (name, note, layoutMode)
	 */
	async updateNode(id: string, request: UpdateNodeRequest): Promise<void> {
		const url = `${this.baseUrl}/api/v1/nodes/${id}`;
		const startTime = performance.now();
		this.logger?.logRequest(url, 'POST', request);

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: this.getHeaders(),
				body: JSON.stringify(request),
			});

			if (!response.ok) {
				throw await this.describeFailure('Failed to update node', response);
			}

			const data = await response.json();
			const duration = performance.now() - startTime;
			this.logger?.logResponse(url, 'POST', response.status, response.statusText, data, duration);

			CompletionStatusResponseSchema.parse(data);
		} catch (error) {
			const duration = performance.now() - startTime;
			this.logger?.logError(url, 'POST', error as Error, duration);
			throw error;
		}
	}

	/**
	 * Delete a node.
	 *
	 * @param id - The node ID to delete
	 */
	async deleteNode(id: string): Promise<void> {
		const url = `${this.baseUrl}/api/v1/nodes/${id}`;
		const startTime = performance.now();
		this.logger?.logRequest(url, 'DELETE');

		try {
			const response = await fetch(url, {
				method: 'DELETE',
				headers: this.getHeaders(),
			});

			if (!response.ok) {
				throw await this.describeFailure('Failed to delete node', response);
			}

			const duration = performance.now() - startTime;
			this.logger?.logResponse(url, 'DELETE', response.status, response.statusText, null, duration);
		} catch (error) {
			const duration = performance.now() - startTime;
			this.logger?.logError(url, 'DELETE', error as Error, duration);
			throw error;
		}
	}

	/**
	 * Mark a node as completed.
	 *
	 * @param id - The node ID to complete
	 */
	async completeNode(id: string): Promise<void> {
		const url = `${this.baseUrl}/api/v1/nodes/${id}/complete`;
		const startTime = performance.now();
		this.logger?.logRequest(url, 'POST');

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: this.getHeaders(),
			});

			if (!response.ok) {
				throw await this.describeFailure('Failed to complete node', response);
			}

			const data = await response.json();
			const duration = performance.now() - startTime;
			this.logger?.logResponse(url, 'POST', response.status, response.statusText, data, duration);

			CompletionStatusResponseSchema.parse(data);
		} catch (error) {
			const duration = performance.now() - startTime;
			this.logger?.logError(url, 'POST', error as Error, duration);
			throw error;
		}
	}

	/**
	 * Mark a node as not completed.
	 *
	 * @param id - The node ID to uncomplete
	 */
	async uncompleteNode(id: string): Promise<void> {
		const url = `${this.baseUrl}/api/v1/nodes/${id}/uncomplete`;
		const startTime = performance.now();
		this.logger?.logRequest(url, 'POST');

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: this.getHeaders(),
			});

			if (!response.ok) {
				throw await this.describeFailure('Failed to uncomplete node', response);
			}

			const data = await response.json();
			const duration = performance.now() - startTime;
			this.logger?.logResponse(url, 'POST', response.status, response.statusText, data, duration);

			CompletionStatusResponseSchema.parse(data);
		} catch (error) {
			const duration = performance.now() - startTime;
			this.logger?.logError(url, 'POST', error as Error, duration);
			throw error;
		}
	}

	/**
	 * Move a node to a new parent.
	 *
	 * @param id - The node ID to move
	 * @param newParentId - The target parent ID (null for root level)
	 * @param position - Optional position ('top' for -1, 'bottom' for >= 0)
	 */
	async moveNode(id: string, newParentId: string | null, position?: number): Promise<void> {
		const url = `${this.baseUrl}/api/v1/nodes/${id}/move`;
		const body: {parent_id: string | null; position?: string} = {
			parent_id: newParentId,
		};
		if (position !== undefined) {
			body.position = position < 0 ? 'top' : 'bottom';
		}

		const startTime = performance.now();
		this.logger?.logRequest(url, 'POST', body);

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: this.getHeaders(),
				body: JSON.stringify(body),
			});

			if (!response.ok) {
				throw await this.describeFailure('Failed to move node', response);
			}

			const data = await response.text();
			const duration = performance.now() - startTime;
			this.logger?.logResponse(url, 'POST', response.status, response.statusText, data, duration);
		} catch (error) {
			const duration = performance.now() - startTime;
			this.logger?.logError(url, 'POST', error as Error, duration);
			throw error;
		}
	}

	/**
	 * Export all nodes from Workflowy.
	 *
	 * This endpoint returns a flat list of all nodes with their parent_id field populated.
	 * Note: This endpoint has a rate limit of 1 request per minute.
	 *
	 * @returns Array of all nodes in the user's Workflowy account
	 */
	async exportAllNodes(): Promise<WorkflowyNode[]> {
		const url = `${this.baseUrl}/api/v1/nodes-export`;
		const startTime = performance.now();
		this.logger?.logRequest(url, 'GET');

		try {
			const response = await this.fetchWithRetry(url, {
				headers: this.getHeaders(),
			});

			if (!response.ok) {
				throw await this.describeFailure('API request failed', response);
			}

			const data = await response.json();
			const duration = performance.now() - startTime;
			this.logger?.logResponse(url, 'GET', response.status, response.statusText, data, duration);

			const validatedResponse = ApiResponseSchema.parse(data);
			return validatedResponse.nodes ?? [];
		} catch (error) {
			const duration = performance.now() - startTime;
			this.logger?.logError(url, 'GET', error as Error, duration);
			throw error;
		}
	}

	/**
	 * Get system targets (like inbox) with their UUIDs.
	 *
	 * Note: Most operations can use target keys directly (e.g., parent_id: "inbox").
	 * This method is primarily useful for discovery or when you need the actual UUID.
	 *
	 * @returns Array of targets with name and id
	 */
	async getTargets(): Promise<WorkflowyTarget[]> {
		const url = `${this.baseUrl}/api/v1/targets`;
		const startTime = performance.now();
		this.logger?.logRequest(url, 'GET');

		try {
			const response = await fetch(url, {
				headers: this.getHeaders(),
			});

			if (!response.ok) {
				throw await this.describeFailure('API request failed', response);
			}

			const data = await response.json();
			const duration = performance.now() - startTime;
			this.logger?.logResponse(url, 'GET', response.status, response.statusText, data, duration);

			const validatedResponse = TargetsResponseSchema.parse(data);
			return validatedResponse.targets;
		} catch (error) {
			const duration = performance.now() - startTime;
			this.logger?.logError(url, 'GET', error as Error, duration);
			throw error;
		}
	}

	/**
	 * Find a node by following a path of exact node names from root or a parent.
	 * Uses exact name matching for consistency with CacheService.
	 *
	 * @param path - Array of exact node names to traverse
	 * @param parentId - Optional starting parent ID (null for root)
	 * @returns The found node or null if not found
	 */
	async findNodeByPath(path: string[], parentId: string | null = null): Promise<WorkflowyNode | null> {
		let currentParent = parentId;
		let lastFoundNode: WorkflowyNode | null = null;

		for (const nodeName of path) {
			const node = await this.getChildByName(currentParent, nodeName);

			if (!node) {
				return null;
			}

			lastFoundNode = node;
			currentParent = node.id;
		}

		return lastFoundNode;
	}
}
