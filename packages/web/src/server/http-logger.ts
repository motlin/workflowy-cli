/**
 * Outbound HTTP logging for the Node host: wraps `fetch` so every call the
 * server makes to workflowy.com (public API and internal API alike) is logged
 * with method, URL, request headers and body, status, elapsed time and response
 * body. Enabled by `WORKFLOWY_HTTP_LOGGING=true`. Headers are logged verbatim,
 * credentials included, so redact the output before sharing it.
 */

const DEFAULT_MAX_BODY_CHARS = 4000;

export interface LoggingFetchOptions {
	/** Response bodies longer than this are cut, with a note of how much was cut. */
	maxBodyChars?: number;
	/** Millisecond clock for elapsed time; defaults to `performance.now`. */
	now?: () => number;
}

export function httpLoggingEnabled(env: Record<string, string | undefined>): boolean {
	return env.WORKFLOWY_HTTP_LOGGING === "true";
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}... [${text.length - max} more chars]` : text;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
}

export function loggingFetch(
	inner: typeof fetch,
	log: (line: string) => void,
	options: LoggingFetchOptions = {},
): typeof fetch {
	const maxBodyChars = options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;
	const now = options.now ?? (() => performance.now());
	return async (input, init) => {
		const url = requestUrl(input);
		const method = init?.method ?? "GET";
		const headers = new Headers(init?.headers);
		log(`[HTTP] >>> ${method} ${url}`);
		for (const [name, value] of headers) {
			log(`[HTTP]     header ${name}: ${value}`);
		}
		if (typeof init?.body === "string") {
			if (headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
				for (const [name, value] of new URLSearchParams(init.body)) {
					log(`[HTTP]     form ${name}=${value}`);
				}
			} else {
				log(`[HTTP]     body ${init.body}`);
			}
		}
		const start = now();
		try {
			const response = await inner(input, init);
			const elapsed = Math.round(now() - start);
			log(`[HTTP] <<< ${response.status} ${response.statusText} ${method} ${url} (${elapsed} ms)`);
			log(`[HTTP]     body ${truncate(await response.clone().text(), maxBodyChars)}`);
			return response;
		} catch (error) {
			const elapsed = Math.round(now() - start);
			log(`[HTTP] !!! ${method} ${url} failed (${elapsed} ms): ${String(error)}`);
			throw error;
		}
	};
}
