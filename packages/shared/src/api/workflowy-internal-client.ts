import {z} from "zod";

/**
 * Workflowy internal API client for session-based authentication.
 *
 * This client is used to access internal Workflowy endpoints that are not
 * available through the official Bearer token API: the user's
 * `dateJoinedTimestampInSeconds` (for converting backup file timestamps to Unix
 * timestamps) and the session bootstrap a `/push_and_poll` write path needs.
 *
 * Authentication flow:
 * 1. POST to /ajax_login with username/password
 * 2. Receive session cookie
 * 3. Use session cookie for subsequent requests
 */

const WORKFLOWY_URL = "https://workflowy.com";

/**
 * The subset of `/get_initialization_data` this client reads. Every other field
 * passes through untouched so upstream additions never break parsing.
 */
const TransactionIdSchema = z.union([z.string(), z.number()]).transform((value) => String(value));
const ClientVersionSchema = TransactionIdSchema;

const InitializationDataSchema = z
	.object({
		projectTreeData: z
			.object({
				mainProjectTreeInfo: z
					.object({
						dateJoinedTimestampInSeconds: z.number(),
						initialMostRecentOperationTransactionId: TransactionIdSchema.optional(),
						serverExpandedProjectsList: z.array(z.string()).optional(),
						ownerId: z.number().optional(),
						isReadOnly: z.boolean().optional(),
					})
					.loose(),
				rootProjectMetadata: z.record(z.string(), z.unknown()).optional(),
			})
			.loose(),
		settings: z.record(z.string(), z.unknown()).optional(),
		user: z.object({id: z.number()}).loose().optional(),
		globals: z.array(z.tuple([z.string(), z.unknown()])).optional(),
	})
	.loose();

const TreeDataSchema = z
	.object({
		most_recent_operation_transaction_id: TransactionIdSchema,
	})
	.loose();

const LoggedOutSchema = z.object({logged_out: z.literal(true)}).loose();

/**
 * Schema for the login response.
 */
const LoginResponseSchema = z.object({
	success: z.boolean().optional(),
	errors: z.record(z.string(), z.array(z.string())).optional(),
});

export interface WorkflowyCredentials {
	username: string;
	password: string;
}

/** Both `WORKFLOWY_USERNAME` and `WORKFLOWY_PASSWORD` from the environment, or undefined if either is unset. */
export function readWorkflowyCredentials(env: NodeJS.ProcessEnv = process.env): WorkflowyCredentials | undefined {
	const username = env.WORKFLOWY_USERNAME;
	const password = env.WORKFLOWY_PASSWORD;
	return username && password ? {username, password} : undefined;
}

export interface WorkflowyInternalClientOptions {
	credentials: WorkflowyCredentials;
	/** Defaults to the global `fetch`. */
	fetch?: typeof fetch;
	/** Defaults to `https://workflowy.com`. */
	baseUrl?: string;
	/** The `WF-TRANSIENT-ID` header value; defaults to a random UUID per client instance. */
	transientId?: string;
}

/** Everything a write path needs from `/get_initialization_data`, parsed once per bootstrap. */
export interface InternalSession {
	/** The `wfclientid` response header, sent back as `client_id` on `/push_and_poll`. */
	clientId: string;
	/** The `CLIENT_VERSION` global, sent back as `client_version`. */
	clientVersion: string;
	userId: number;
	ownerId: number;
	dateJoinedSec: number;
	/** The main tree's most recent operation transaction id: an integer string, `"None"` meaning -1. */
	txId: string;
	/** Root (Home) metadata: stars, tag colors, date formats. */
	rootMetadata: Record<string, unknown>;
	settings: Record<string, unknown>;
	/** Short ids of the nodes the server records as expanded. */
	expandedKeys: string[];
}

/** The `client_version` sent before the server has told us its `CLIENT_VERSION`. */
const DEFAULT_CLIENT_VERSION = "21";
const CLIENT_VERSION_V2 = "28";

function initializationPath(clientVersion: string): string {
	const query = new URLSearchParams({
		client_version: clientVersion,
		client_version_v2: CLIENT_VERSION_V2,
		no_root_children: "1",
	});
	return `/get_initialization_data?${query.toString()}`;
}

/** The server refused the session cookie (a redirect to the login page, or a `logged_out` body). */
export class SessionRejectedError extends Error {
	constructor(readonly reason: string) {
		super(`Workflowy session rejected (${reason})`);
	}
}

/**
 * Client for Workflowy's internal API (session-based authentication).
 */
export class WorkflowyInternalClient {
	private sessionCookie: string | null = null;
	private readonly credentials: WorkflowyCredentials;
	private readonly fetchImpl: typeof fetch;
	private readonly baseUrl: string;
	private readonly transientId: string;
	private currentSession: InternalSession | undefined;

	constructor(options: WorkflowyInternalClientOptions) {
		this.credentials = options.credentials;
		this.fetchImpl = options.fetch ?? (async (input, init) => fetch(input, init));
		this.baseUrl = options.baseUrl ?? WORKFLOWY_URL;
		this.transientId = options.transientId ?? crypto.randomUUID();
	}

	/** The session parsed by the most recent `bootstrap()`, if any. */
	get session(): InternalSession | undefined {
		return this.currentSession;
	}

	/**
	 * Authenticate with Workflowy using username/password.
	 * Stores the session cookie for subsequent requests.
	 */
	async login(): Promise<void> {
		const url = `${this.baseUrl}/ajax_login`;

		const formData = new URLSearchParams();
		formData.append("username", this.credentials.username);
		formData.append("password", this.credentials.password);

		this.sessionCookie = null;
		const response = await this.fetchImpl(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: formData.toString(),
			redirect: "manual",
		});

		// Extract session cookie from Set-Cookie header
		const setCookie = response.headers.get("set-cookie");
		if (setCookie) {
			// Parse the session cookie (sessionid=...)
			const sessionMatch = setCookie.match(/sessionid=([^;]+)/u);
			if (sessionMatch) {
				this.sessionCookie = `sessionid=${sessionMatch[1]}`;
			}
		}

		// Check response for errors
		if (response.ok || response.status === 302) {
			const text = await response.text();
			if (text) {
				try {
					const data: unknown = JSON.parse(text);
					const parsed = LoginResponseSchema.safeParse(data);
					if (parsed.success && parsed.data.errors) {
						const errorMessages = Object.values(parsed.data.errors).flat().join(", ");
						throw new Error(`Login failed: ${errorMessages}`);
					}
				} catch {
					// Response might not be JSON on success redirect
				}
			}
		}

		if (!this.sessionCookie) {
			throw new Error("Login failed: No session cookie received");
		}
	}

	/**
	 * Log in (only when no session cookie is held yet), fetch initialization
	 * data, and fall back to `/get_tree_data/` for the transaction id when init
	 * omits it. A rejected session (302 to login, or `logged_out`) triggers
	 * exactly one re-login.
	 */
	async bootstrap(): Promise<InternalSession> {
		if (!this.sessionCookie) {
			await this.login();
		}
		let session: InternalSession;
		try {
			session = await this.fetchSession();
		} catch (error) {
			if (!(error instanceof SessionRejectedError)) {
				throw error;
			}
			await this.login();
			// A second rejection right after a fresh login propagates: re-login exactly once.
			session = await this.fetchSession();
		}
		this.currentSession = session;
		return session;
	}

	private async fetchSession(): Promise<InternalSession> {
		const clientVersion = this.currentSession?.clientVersion ?? DEFAULT_CLIENT_VERSION;
		const {response, body} = await this.getJson(initializationPath(clientVersion));
		const init = InitializationDataSchema.parse(body);
		const tree = init.projectTreeData.mainProjectTreeInfo;

		let txId = tree.initialMostRecentOperationTransactionId;
		if (txId === undefined) {
			const treeData = TreeDataSchema.parse((await this.getJson("/get_tree_data/")).body);
			txId = treeData.most_recent_operation_transaction_id;
		}

		const userId = init.user?.id;
		if (userId === undefined) {
			throw new Error("Initialization data has no user id");
		}
		const globalVersion = ClientVersionSchema.safeParse(
			init.globals?.find(([name]) => name === "CLIENT_VERSION")?.[1],
		);

		return {
			clientId: response.headers.get("wfclientid") ?? "",
			clientVersion: globalVersion.success ? globalVersion.data : clientVersion,
			userId,
			ownerId: tree.ownerId ?? userId,
			dateJoinedSec: tree.dateJoinedTimestampInSeconds,
			txId,
			rootMetadata: init.projectTreeData.rootProjectMetadata ?? {},
			settings: init.settings ?? {},
			expandedKeys: tree.serverExpandedProjectsList ?? [],
		};
	}

	/** An authenticated GET; throws `SessionRejectedError` on a login redirect or `logged_out` body. */
	private async getJson(pathAndQuery: string): Promise<{response: Response; body: unknown}> {
		if (!this.sessionCookie) {
			throw new Error("Not authenticated. Call login() first.");
		}
		const response = await this.fetchImpl(`${this.baseUrl}${pathAndQuery}`, {
			headers: {
				Cookie: this.sessionCookie,
				Accept: "application/json",
				"X-Requested-With": "XMLHttpRequest",
				"WF-TRANSIENT-ID": this.transientId,
			},
			redirect: "manual",
		});
		if (response.status >= 300 && response.status < 400) {
			throw new SessionRejectedError(`redirect to ${response.headers.get("location") ?? "unknown"}`);
		}
		if (!response.ok) {
			throw new Error(`Failed to GET ${pathAndQuery}: ${response.status} ${response.statusText}`);
		}
		const body: unknown = await response.json();
		if (LoggedOutSchema.safeParse(body).success) {
			throw new SessionRejectedError("logged_out");
		}
		return {response, body};
	}

	/**
	 * An authenticated form POST, returning the raw response (redirects are not
	 * followed). Like upstream's HTTP layer, it appends `crosscheck_user_id` once
	 * a bootstrap has learned the user id.
	 */
	async postForm(pathAndQuery: string, form: URLSearchParams): Promise<Response> {
		if (!this.sessionCookie) {
			throw new Error("Not authenticated. Call login() first.");
		}
		const body = new URLSearchParams(form);
		if (this.currentSession) {
			body.append("crosscheck_user_id", String(this.currentSession.userId));
		}
		return this.fetchImpl(`${this.baseUrl}${pathAndQuery}`, {
			method: "POST",
			headers: {
				Cookie: this.sessionCookie,
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
				"X-Requested-With": "XMLHttpRequest",
				"WF-TRANSIENT-ID": this.transientId,
			},
			body: body.toString(),
			redirect: "manual",
		});
	}

	/**
	 * Fetch the initialization data which contains the user's epoch timestamp.
	 * Requires authentication via login() first.
	 */
	async getInitializationData(): Promise<{dateJoinedTimestampInSeconds: number}> {
		const {body} = await this.getJson(initializationPath(DEFAULT_CLIENT_VERSION));
		const parsed = InitializationDataSchema.parse(body);

		return {
			dateJoinedTimestampInSeconds: parsed.projectTreeData.mainProjectTreeInfo.dateJoinedTimestampInSeconds,
		};
	}

	/**
	 * Get the user's Workflowy epoch (dateJoinedTimestampInSeconds).
	 * This is a convenience method that handles login and data fetching.
	 */
	async getEpoch(): Promise<number> {
		await this.login();
		const data = await this.getInitializationData();
		return data.dateJoinedTimestampInSeconds;
	}
}

/**
 * Fetch the Workflowy epoch for a user using their credentials.
 * This is a standalone function for one-off usage.
 *
 * The internal API returns `dateJoinedTimestampInSeconds` which is the epoch
 * value needed for converting backup file timestamps to Unix timestamps.
 *
 * Formula: unixTimestamp = backupTimestamp + epoch
 *
 * This epoch produces timestamps that match what the Workflowy Export API returns.
 *
 * @param credentials - Username and password for Workflowy
 * @returns The user's epoch for backup timestamp conversion
 */
export async function fetchWorkflowyEpoch(credentials: WorkflowyCredentials): Promise<number> {
	const client = new WorkflowyInternalClient({credentials});
	return client.getEpoch();
}
