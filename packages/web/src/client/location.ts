/** Upstream item URLs use the last 12 characters of the uuid. */
const SHORT_ID_LENGTH = 12;

export interface Location {
	id: string | null;
	query: string | null;
	fragments: Record<string, string>;
}

export interface LocationInput {
	id: string | null;
	query?: string | null;
	fragments?: Record<string, string>;
}

export function shortId(id: string): string {
	return id.slice(-SHORT_ID_LENGTH);
}

/** Home is `/`; an item is `/#/<shortId>`; params follow `?` as `q=<query>` then fragments joined by `&`. */
export function locationUrl({id, query, fragments = {}}: LocationInput): string {
	const params = [
		...(query ? [`q=${encodeURIComponent(query)}`] : []),
		...Object.entries(fragments).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`),
	];
	const path = id === null ? "" : `/${shortId(id)}`;
	if (params.length === 0) {
		return path === "" ? "/" : `/#${path}`;
	}
	return `/#${path}?${params.join("&")}`;
}

/** Mirrors upstream's parser: strip `#` or `#/`, split on the first `?`, empty id means home. */
export function parseLocationHash(hash: string): Location {
	const body = hash.replace(/^#\/?/u, "");
	const separator = body.indexOf("?");
	const rawId = separator === -1 ? body : body.slice(0, separator);
	const search = separator === -1 ? "" : body.slice(separator + 1);
	let query: string | null = null;
	const fragments: Record<string, string> = {};
	for (const [key, value] of new URLSearchParams(search.replaceAll("+", "%2B"))) {
		if (key === "q") {
			query = value === "" ? null : value;
		} else {
			fragments[key] = value;
		}
	}
	return {id: rawId === "" ? null : rawId, query, fragments};
}
