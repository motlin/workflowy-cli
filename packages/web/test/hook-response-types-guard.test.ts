import {readdirSync, readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const HOOKS_DIR = new URL("../src/client/hooks/", import.meta.url);

/** The type argument of each `readJson<...>(` call, scanning balanced angle brackets (skipping `=>`). */
function readJsonTypeArgs(source: string): string[] {
	const args: string[] = [];
	let start = source.indexOf("readJson<");
	while (start !== -1) {
		const open = start + "readJson<".length;
		let depth = 1;
		let index = open;
		for (; index < source.length && depth > 0; index++) {
			const char = source[index];
			if (char === "<") {
				depth++;
			} else if (char === ">" && source[index - 1] !== "=") {
				depth--;
			}
		}
		args.push(source.slice(open, index - 1));
		start = source.indexOf("readJson<", index);
	}
	return args;
}

/**
 * `file: Name` for every type a hook declares itself and then reads a response as. Such a copy drifts silently from the
 * op's output schema (the useMoveNode bug); infer the type from the schema in `node-types.ts` instead.
 */
function selfTypedResponses(): string[] {
	const found: string[] = [];
	// oxlint-disable-next-line unicorn/no-array-sort -- the test tsconfig lib has no toSorted
	for (const file of readdirSync(HOOKS_DIR).sort()) {
		if (!/\.tsx?$/u.test(file)) {
			continue;
		}
		const source = readFileSync(new URL(file, HOOKS_DIR), "utf8");
		const local = new Set([...source.matchAll(/^\s*(?:export\s+)?(?:interface|type)\s+(\w+)/gmu)].map((m) => m[1]));
		const used = new Set(readJsonTypeArgs(source).flatMap((arg) => arg.match(/\b[A-Z]\w*\b/gu) ?? []));
		// oxlint-disable-next-line unicorn/no-array-sort -- the test tsconfig lib has no toSorted
		for (const name of [...used].filter((candidate) => local.has(candidate)).sort()) {
			found.push(`${file}: ${name}`);
		}
	}
	return found;
}

/** Hooks that still copy an op's response type; remove each entry when its hook switches to an inferred type. */
const BACKLOG = [
	"use-account.ts: AccountResponse",
	"use-custom-tree.ts: CustomTreeResponse",
	"use-features.ts: FeaturesState",
	"use-preferences.ts: Preferences",
	"use-tag-colors.ts: TagColors",
];

describe("client hooks read op responses as schema-inferred types", () => {
	it("declares no response type of its own beyond the known, shrinking backlog", () => {
		expect(selfTypedResponses()).toStrictEqual(BACKLOG);
	});

	it("finds a locally declared type inside a readJson type argument", () => {
		expect(
			readJsonTypeArgs(
				"interface Local {a: string}\nreadJson<Partial<Local> & {error?: string}>(r); readJson<{f: () => X}>(r);",
			),
		).toStrictEqual(["Partial<Local> & {error?: string}", "{f: () => X}"]);
	});
});
