// Clipboard HTML to paste lines (upstream `oh2` with the generic bucket cleaners): lists become nesting, text runs
// become lines, and names keep only `b i u s code a[href]`. Everything else is unwrapped, so no foreign markup is stored.
import type {PasteLine} from "./lines.js";
import {escapeHtml} from "./lines.js";

const FORMAT_TAGS = /<\s*(?:b|strong|i|em|u|s|del|strike|code|a)\b/iu;
const LIST_TAGS = /<\s*(?:ul|ol|li|dt)\b/iu;
const BLOCK_TAGS = new Set([
	"p",
	"div",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"blockquote",
	"pre",
	"table",
	"tr",
	"section",
	"article",
	"header",
	"footer",
	"figure",
]);
const SKIPPED_TAGS = new Set(["script", "style", "head", "meta", "title", "template", "noscript"]);

/** The clipboard HTML carries formatting or lists, so it must go through the HTML path instead of plain text. */
export function hasRichContent(html: string): boolean {
	return FORMAT_TAGS.test(html) || LIST_TAGS.test(html);
}

function fontWeightBold(style: string): boolean {
	const weight = /font-weight\s*:\s*([\w-]+)/iu.exec(style)?.[1]?.toLowerCase();
	if (weight === undefined) {
		return false;
	}
	return weight === "bold" || weight === "bolder" || Number(weight) >= 600;
}

/** The wrapping tags an element asks for, outermost first. */
function wrappers(element: Element): string[] {
	const tag = element.tagName.toLowerCase();
	const style = element.getAttribute("style") ?? "";
	const tags: string[] = [];
	if (tag === "a" && element.getAttribute("href")) {
		tags.push(`a href="${escapeHtml(element.getAttribute("href") ?? "").replaceAll('"', "&quot;")}"`);
	}
	if (tag === "b" || tag === "strong" || fontWeightBold(style)) {
		tags.push("b");
	}
	if (tag === "i" || tag === "em" || /font-style\s*:\s*(?:italic|oblique)/iu.test(style)) {
		tags.push("i");
	}
	if (tag === "u" || /text-decoration[^;]*underline/iu.test(style)) {
		tags.push("u");
	}
	if (tag === "s" || tag === "del" || tag === "strike" || /text-decoration[^;]*line-through/iu.test(style)) {
		tags.push("s");
	}
	if (tag === "code") {
		tags.push("code");
	}
	return tags;
}

function wrap(tags: readonly string[], inner: string): string {
	if (inner === "") {
		return "";
	}
	const open = tags.map((tag) => `<${tag}>`).join("");
	const close = tags
		.toReversed()
		.map((tag) => `</${tag.split(" ")[0]}>`)
		.join("");
	return `${open}${inner}${close}`;
}

/** Inline html of a node's content, `\n` for br, whitespace collapsed; block children are not allowed in here. */
function inlineHtml(node: Node, blocks: ReadonlySet<string> = BLOCK_TAGS): string {
	if (node.nodeType === 3) {
		return escapeHtml((node.textContent ?? "").replaceAll("\xA0", " ").replaceAll(/\s+/gu, " "));
	}
	if (!(node instanceof Element)) {
		return "";
	}
	const tag = node.tagName.toLowerCase();
	if (SKIPPED_TAGS.has(tag)) {
		return "";
	}
	if (tag === "br") {
		return "\n";
	}
	const inner = [...node.childNodes].map((child) => inlineHtml(child, blocks)).join("");
	return blocks.has(tag) ? `\n${inner}\n` : wrap(wrappers(node), inner);
}

const NOTE_BLOCK_TAGS = new Set([...BLOCK_TAGS, "li", "dt", "ul", "ol"]);

/**
 * Clipboard html as note text: the allowed inline set kept, a newline at each block end, br as a newline, and runs of 3+
 * newlines collapsed to one blank line (a deliberate divergence from upstream, which keeps the extra blank lines).
 */
export function buildNoteHtml(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	return inlineHtml(doc.body, NOTE_BLOCK_TAGS)
		.replaceAll(/[ \t]*\n[ \t]*/gu, "\n")
		.replaceAll(/\n{3,}/gu, "\n\n")
		.replaceAll(/^\n+|\n+$/gu, "");
}

function linesOfRun(run: string): PasteLine[] {
	return run
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.map((name) => ({name, mdBullet: false, children: []}));
}

function isList(node: Node): node is Element {
	return node instanceof Element && ["ul", "ol"].includes(node.tagName.toLowerCase());
}

function isItem(node: Node): node is Element {
	return node instanceof Element && ["li", "dt"].includes(node.tagName.toLowerCase());
}

/** Lines of a container's children: text runs between blocks, lists as nested lines. */
function containerLines(container: Node): PasteLine[] {
	const lines: PasteLine[] = [];
	let run = "";
	const flush = (): void => {
		lines.push(...linesOfRun(run));
		run = "";
	};
	for (const child of container.childNodes) {
		if (child instanceof Element && SKIPPED_TAGS.has(child.tagName.toLowerCase())) {
			continue;
		}
		if (isList(child)) {
			flush();
			const owner = lines.at(-1);
			const items = [...child.childNodes].filter(isItem).flatMap(containerLines);
			// A list straight after item text nests under it; otherwise it is a top-level list.
			if (owner !== undefined && container instanceof Element && isItem(container)) {
				owner.children.push(...items);
			} else {
				lines.push(...items);
			}
		} else if (child instanceof Element && BLOCK_TAGS.has(child.tagName.toLowerCase()) && containsList(child)) {
			flush();
			lines.push(...containerLines(child));
		} else {
			run += inlineHtml(child);
		}
	}
	flush();
	return lines;
}

function containsList(element: Element): boolean {
	return element.querySelector("ul, ol") !== null;
}

/** Lines of clipboard HTML; empty when the HTML has no text. */
export function buildHtmlLines(html: string): PasteLine[] {
	const doc = new DOMParser().parseFromString(html, "text/html");
	return containerLines(doc.body);
}
