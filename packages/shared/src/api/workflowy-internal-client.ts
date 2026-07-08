import {z} from 'zod';

/**
 * Workflowy internal API client for session-based authentication.
 *
 * This client is used to access internal Workflowy endpoints that are not
 * available through the official Bearer token API. Specifically, it's used
 * to fetch the user's `dateJoinedTimestampInSeconds` which is required for
 * converting backup file timestamps to Unix timestamps.
 *
 * Authentication flow:
 * 1. POST to /ajax_login with username/password
 * 2. Receive session cookie
 * 3. Use session cookie for subsequent requests
 */

const WORKFLOWY_URL = 'https://workflowy.com';

/**
 * Schema for the initialization data response.
 * We only extract the fields we need.
 */
const InitializationDataSchema = z.object({
	projectTreeData: z.object({
		mainProjectTreeInfo: z.object({
			dateJoinedTimestampInSeconds: z.number(),
		}),
	}),
});

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

export interface WorkflowyInternalClientOptions {
	credentials: WorkflowyCredentials;
}

/**
 * Client for Workflowy's internal API (session-based authentication).
 */
export class WorkflowyInternalClient {
	private sessionCookie: string | null = null;
	private credentials: WorkflowyCredentials;

	constructor(options: WorkflowyInternalClientOptions) {
		this.credentials = options.credentials;
	}

	/**
	 * Authenticate with Workflowy using username/password.
	 * Stores the session cookie for subsequent requests.
	 */
	async login(): Promise<void> {
		const url = `${WORKFLOWY_URL}/ajax_login`;

		const formData = new URLSearchParams();
		formData.append('username', this.credentials.username);
		formData.append('password', this.credentials.password);

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: formData.toString(),
			redirect: 'manual',
		});

		// Extract session cookie from Set-Cookie header
		const setCookie = response.headers.get('set-cookie');
		if (setCookie) {
			// Parse the session cookie (sessionid=...)
			const sessionMatch = setCookie.match(/sessionid=([^;]+)/);
			if (sessionMatch) {
				this.sessionCookie = `sessionid=${sessionMatch[1]}`;
			}
		}

		// Check response for errors
		if (response.ok || response.status === 302) {
			const text = await response.text();
			if (text) {
				try {
					const data = JSON.parse(text);
					const parsed = LoginResponseSchema.safeParse(data);
					if (parsed.success && parsed.data.errors) {
						const errorMessages = Object.values(parsed.data.errors).flat().join(', ');
						throw new Error(`Login failed: ${errorMessages}`);
					}
				} catch {
					// Response might not be JSON on success redirect
				}
			}
		}

		if (!this.sessionCookie) {
			throw new Error('Login failed: No session cookie received');
		}
	}

	/**
	 * Fetch the initialization data which contains the user's epoch timestamp.
	 * Requires authentication via login() first.
	 */
	async getInitializationData(): Promise<{dateJoinedTimestampInSeconds: number}> {
		if (!this.sessionCookie) {
			throw new Error('Not authenticated. Call login() first.');
		}

		const url = `${WORKFLOWY_URL}/get_initialization_data?client_version=21&client_version_v2=28&no_root_children=1`;

		const response = await fetch(url, {
			headers: {
				Cookie: this.sessionCookie,
			},
		});

		if (!response.ok) {
			throw new Error(`Failed to get initialization data: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		const parsed = InitializationDataSchema.parse(data);

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
