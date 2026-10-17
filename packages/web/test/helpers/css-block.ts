function normalize(text: string): string {
	return text.replaceAll(/\s+/gu, " ").trim();
}

function stripComments(css: string): string {
	return css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
}

function splitDeclarations(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const char of body) {
		if (char === "(") {
			depth++;
		} else if (char === ")") {
			depth--;
		}
		if (char === ";" && depth === 0) {
			parts.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	parts.push(current);
	return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function findBlockBody(css: string, selector: string): string {
	const source = stripComments(css);
	const wanted = normalize(selector);
	let start = 0;
	for (let open = source.indexOf("{"); open !== -1; open = source.indexOf("{", open + 1)) {
		// A leading "}" closes an enclosing at-rule block that ended before this rule.
		const prelude = normalize(source.slice(start, open).replace(/^[\s}]*/u, ""));
		let depth = 1;
		let close = open + 1;
		while (close < source.length && depth > 0) {
			if (source[close] === "{") {
				depth++;
			} else if (source[close] === "}") {
				depth--;
			}
			close++;
		}
		if (prelude === wanted) {
			return source.slice(open + 1, close - 1);
		}
		if (prelude.startsWith("@")) {
			// Descend into at-rule blocks: the next prelude starts right after this brace.
			start = open + 1;
			continue;
		}
		start = close;
		open = close - 1;
	}
	throw new Error(`No CSS rule with selector ${selector}`);
}

/** Declarations of the first rule whose selector equals `selector`, as {property: value}. */
export function cssBlock(css: string, selector: string): Record<string, string> {
	const declarations: Record<string, string> = {};
	for (const declaration of splitDeclarations(findBlockBody(css, selector))) {
		const colon = declaration.indexOf(":");
		declarations[declaration.slice(0, colon).trim()] = normalize(declaration.slice(colon + 1));
	}
	return declarations;
}

/** Raw text of the first rule whose selector equals `selector`, comments stripped. */
export function cssBlockText(css: string, selector: string): string {
	return findBlockBody(css, selector);
}
