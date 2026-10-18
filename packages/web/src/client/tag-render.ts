import {findTags} from "@workflowy/shared/tags";

const ENTITIES: Readonly<Record<string, string>> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&nbsp;": " ",
};

const ENTITY_PATTERN = /^&(?:amp|lt|gt|quot|#39|nbsp);/u;
const HTML_TAG_PATTERN = /<[^>]*>/gu;
const UNTAGGABLE_ELEMENT_PATTERN = /^<(\/?)(a|code)(?=[\s>/])/iu;

interface TextSegment {
	html: string;
	/** Offset of this segment's first plain character within the concatenated plain text. */
	plainStart: number;
	/** `htmlOffsets[i]` is the html offset of plain character i; one extra entry marks the end. */
	htmlOffsets: number[];
	taggable: boolean;
}

type Token = {kind: "markup"; html: string} | {kind: "text"; segment: TextSegment};

function decodeSegment(html: string): {plain: string; htmlOffsets: number[]} {
	let plain = "";
	const htmlOffsets: number[] = [];
	let index = 0;
	while (index < html.length) {
		const entity = ENTITY_PATTERN.exec(html.slice(index))?.[0];
		htmlOffsets.push(index);
		if (entity === undefined) {
			plain += html.charAt(index);
			index += 1;
		} else {
			plain += ENTITIES[entity] ?? entity;
			index += entity.length;
		}
	}
	htmlOffsets.push(index);
	return {plain, htmlOffsets};
}

function tokenize(html: string): {tokens: Token[]; plain: string} {
	const tokens: Token[] = [];
	let plain = "";
	let untaggableDepth = 0;
	let cursor = 0;
	const pushText = (text: string): void => {
		if (text === "") {
			return;
		}
		const decoded = decodeSegment(text);
		tokens.push({
			kind: "text",
			segment: {
				html: text,
				plainStart: plain.length,
				htmlOffsets: decoded.htmlOffsets,
				taggable: untaggableDepth === 0,
			},
		});
		plain += decoded.plain;
	};
	for (const match of html.matchAll(HTML_TAG_PATTERN)) {
		pushText(html.slice(cursor, match.index));
		tokens.push({kind: "markup", html: match[0]});
		const element = UNTAGGABLE_ELEMENT_PATTERN.exec(match[0]);
		if (element) {
			untaggableDepth = element[1] === "/" ? Math.max(0, untaggableDepth - 1) : untaggableDepth + 1;
		}
		cursor = match.index + match[0].length;
	}
	pushText(html.slice(cursor));
	return {tokens, plain};
}

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function renderSegment(segment: TextSegment, tags: readonly {index: number; tag: string}[]): string {
	const plainLength = segment.htmlOffsets.length - 1;
	let out = "";
	let htmlCursor = 0;
	for (const {index, tag} of tags) {
		const start = index - segment.plainStart;
		const end = start + tag.length;
		if (start < 0 || end > plainLength) {
			continue;
		}
		const htmlStart = segment.htmlOffsets[start] ?? 0;
		const htmlAfterFirst = segment.htmlOffsets[start + 1] ?? htmlStart;
		const htmlEnd = segment.htmlOffsets[end] ?? htmlAfterFirst;
		out += `${segment.html.slice(
			htmlCursor,
			htmlStart,
		)}<span class="contentTag explosive" title="Filter ${escapeAttribute(tag)}" data-val="${escapeAttribute(tag.toLowerCase())}">${segment.html.slice(
			htmlStart,
			htmlAfterFirst,
		)}<span class="contentTagText">${segment.html.slice(htmlAfterFirst, htmlEnd)}</span><span class="contentTagNub"></span></span>`;
		htmlCursor = htmlEnd;
	}
	return out + segment.html.slice(htmlCursor);
}

/**
 * Wrap every #tag and @mention in stored rich-text HTML with upstream's
 * `.contentTag` markup. Text inside `<a>` and `<code>` is never tagged, and a
 * tag split across formatting elements is left as-is.
 */
export function renderTags(html: string): string {
	const {tokens, plain} = tokenize(html);
	const tags = findTags(plain);
	if (tags.length === 0) {
		return html;
	}
	return tokens
		.map((token) => {
			if (token.kind === "markup") {
				return token.html;
			}
			return token.segment.taggable ? renderSegment(token.segment, tags) : token.segment.html;
		})
		.join("");
}

/** The tag in plain text whose span covers `offset` (inclusive of its end), if any. */
export function tagAtOffset(plainText: string, offset: number): string | undefined {
	return findTags(plainText).find(({index, tag}) => offset >= index && offset <= index + tag.length)?.tag;
}
