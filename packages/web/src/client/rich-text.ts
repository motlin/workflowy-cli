// Pure helpers for splitting and joining Workflowy rich-text names at plain-text offsets.
// Inline formatting tags survive a split (closed in `before`, reopened in `after`) and
// identical tags meeting at a join are merged back together.

const FORMAT_TAGS = new Set(["b", "i", "u", "s", "code", "a", "span"]);

type Token =
	| {kind: "open"; name: string; raw: string}
	| {kind: "close"; name: string; raw: string}
	| {kind: "other"; raw: string}
	| {kind: "char"; raw: string};

const TOKEN_PATTERN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);|[\s\S]/gu;

function tokenize(html: string): Token[] {
	const tokens: Token[] = [];
	for (const match of html.matchAll(TOKEN_PATTERN)) {
		const raw = match[0];
		const name = match[2]?.toLowerCase();
		if (name === undefined) {
			tokens.push({kind: "char", raw});
		} else if (!FORMAT_TAGS.has(name)) {
			tokens.push({kind: "other", raw});
		} else if (match[1] === "/") {
			tokens.push({kind: "close", name, raw});
		} else {
			tokens.push({kind: "open", name, raw});
		}
	}
	return tokens;
}

interface OpenTag {
	name: string;
	raw: string;
}

function applyTag(stack: OpenTag[], token: Token): void {
	if (token.kind === "open") {
		stack.push({name: token.name, raw: token.raw});
	} else if (token.kind === "close") {
		const index = stack.findLastIndex((open) => open.name === token.name);
		if (index !== -1) {
			stack.splice(index, 1);
		}
	}
}

// Walks tokens until the plain-text character at `offset`, returning that token index and
// the tags open at that point.
function walkTo(tokens: Token[], offset: number): {index: number; stack: OpenTag[]} {
	const stack: OpenTag[] = [];
	let count = 0;
	for (const [index, token] of tokens.entries()) {
		if (token.kind === "char") {
			if (count === offset) {
				return {index, stack};
			}
			count++;
		}
		applyTag(stack, token);
	}
	return {index: tokens.length, stack};
}

const EMPTY_PAIR = /<(b|i|u|s|code|a|span)(?:\s[^>]*)?><\/\1>/giu;

function stripEmptyTags(html: string): string {
	let previous: string;
	let current = html;
	do {
		previous = current;
		current = current.replace(EMPTY_PAIR, "");
	} while (current !== previous);
	return current;
}

function joinRaw(tokens: Token[]): string {
	return tokens.map((token) => token.raw).join("");
}

export function plainLength(html: string): number {
	return tokenize(html).filter((token) => token.kind === "char").length;
}

// Splits `html` at plain-text offsets; the text between `start` and `end` is dropped.
export function splitHtml(html: string, start: number, end: number): {before: string; after: string} {
	const tokens = tokenize(html);
	const head = walkTo(tokens, start);
	const tail = walkTo(tokens, end);
	const closes = head.stack
		.toReversed()
		.map((open) => `</${open.name}>`)
		.join("");
	const opens = tail.stack.map((open) => open.raw).join("");
	return {
		before: stripEmptyTags(joinRaw(tokens.slice(0, head.index)) + closes),
		after: stripEmptyTags(opens + joinRaw(tokens.slice(tail.index))),
	};
}

// Joins two rich-text strings, merging tags that close at the end of `a` and reopen
// identically at the start of `b`.
export function concatHtml(a: string, b: string): string {
	const left = tokenize(a);
	const right = tokenize(b);
	for (;;) {
		const last = left.at(-1);
		const first = right[0];
		if (last?.kind !== "close" || first?.kind !== "open" || last.name !== first.name) {
			break;
		}
		const stack: OpenTag[] = [];
		for (const token of left.slice(0, -1)) {
			applyTag(stack, token);
		}
		const matching = stack.findLast((open) => open.name === last.name);
		if (matching?.raw !== first.raw) {
			break;
		}
		left.pop();
		right.shift();
	}
	return joinRaw(left) + joinRaw(right);
}
