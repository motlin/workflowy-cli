const ANCHOR_OPEN_PATTERN = /<a(?=[\s>/])[^>]*>/giu;
const ANCHOR_CLOSE_PATTERN = /<\/a\s*>/iu;
const HREF_PATTERN = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu;
const JAVASCRIPT_HREF_PATTERN = /^\s*javascript:/iu;

function escapeAttribute(value: string): string {
	return value.replaceAll('"', "&quot;");
}

/** The href of an `<a>` open tag, or "" when it has none. */
export function anchorHref(openTag: string): string {
	const match = HREF_PATTERN.exec(openTag);
	return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

/** The `<a>` open tag stored for `href`, stripped of rendering attributes. */
export function storedAnchorTag(href: string): string {
	return `<a href="${escapeAttribute(href)}">`;
}

/**
 * Render every stored `<a>` with upstream's link markup: `class="contentLink"`,
 * `target="_blank"`, `rel="noreferrer"`, and the stored href. Like upstream, a
 * `javascript:` link renders as nothing, text included.
 */
export function renderLinks(html: string): string {
	let out = "";
	let cursor = 0;
	for (const match of html.matchAll(ANCHOR_OPEN_PATTERN)) {
		if (match.index < cursor) {
			continue;
		}
		out += html.slice(cursor, match.index);
		cursor = match.index + match[0].length;
		const href = anchorHref(match[0]);
		if (JAVASCRIPT_HREF_PATTERN.test(href)) {
			const close = ANCHOR_CLOSE_PATTERN.exec(html.slice(cursor));
			cursor = close ? cursor + close.index + close[0].length : html.length;
			continue;
		}
		out += `<a class="contentLink" target="_blank" rel="noreferrer" href="${escapeAttribute(href)}">`;
	}
	return out + html.slice(cursor);
}
