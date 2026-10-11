/**
 * Read a response body typed as the shape the API route promises.
 *
 * Like Hono's `c.req.json<T>()`, the type parameter is a contract with our own
 * server, not a runtime check. Parse with zod instead when the body comes from
 * somewhere we do not control.
 */
export async function readJson<T>(response: Response): Promise<T> {
	const body: T = await response.json();
	return body;
}
