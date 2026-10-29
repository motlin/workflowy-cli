import {readdirSync, readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const CLIENT_DIR = new URL("../src/client/", import.meta.url);

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

/** Each type name imported from another client module: anything relative except `node-types.js` and the server. */
function clientImportedTypes(source: string): Set<string> {
	const names = new Set<string>();
	for (const [, list = "", from = ""] of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/gu)) {
		if (!from.startsWith(".") || /node-types\.js$|\/server\//u.test(from)) {
			continue;
		}
		for (const specifier of list.split(",")) {
			const name = specifier
				.replace(/^\s*type\s+/u, "")
				.split(/\s+as\s+/u)
				.at(-1)
				?.trim();
			if (name) {
				names.add(name);
			}
		}
	}
	return names;
}

/**
 * `file: Name` for every response type a client module declares itself, or imports from another client module, and
 * `file: readJson<{...}>` for every inline object type. Such a copy drifts silently from the op's output schema (the
 * useMoveNode bug); infer the type from the schema in `node-types.ts` instead.
 */
function handTypedResponses(): string[] {
	const found = new Set<string>();
	// oxlint-disable-next-line unicorn/no-array-sort -- the test tsconfig lib has no toSorted
	for (const file of readdirSync(CLIENT_DIR, {recursive: true, encoding: "utf8"}).sort()) {
		if (!/\.tsx?$/u.test(file) || file === "read-json.ts") {
			continue;
		}
		const source = readFileSync(new URL(file, CLIENT_DIR), "utf8");
		const local = new Set([...source.matchAll(/^\s*(?:export\s+)?(?:interface|type)\s+(\w+)/gmu)].map((m) => m[1]));
		const copied = clientImportedTypes(source);
		for (const arg of readJsonTypeArgs(source)) {
			if (arg.includes("{")) {
				found.add(`${file}: readJson<${arg}>`);
			}
			for (const name of arg.match(/\b[A-Z]\w*\b/gu) ?? []) {
				if (local.has(name) || copied.has(name)) {
					found.add(`${file}: ${name}`);
				}
			}
		}
	}
	// oxlint-disable-next-line unicorn/no-array-sort -- the test tsconfig lib has no toSorted
	return [...found].sort();
}

/**
 * Reads whose route has no op output schema yet, or whose op has not been wired to an inferred type. Remove each entry
 * when its read switches to a type from `node-types.ts`; never add one.
 */
const NOT_YET_INFERRED = [
	"cache-verify.ts: readJson<{children: Record<string, NodeResponse[]>}>",
	"cache-verify.ts: readJson<{node: NodeResponse}>",
	"cache-verify.ts: readJson<{nodes: NodeResponse[]}>",
	"components/calendar-strip.tsx: readJson<{dateIds: number[]}>",
	"components/changes-view.tsx: ChangesResponse",
	"components/decisions-view.tsx: readJson<{error: string}>",
	"components/export-dialog.tsx: readJson<{email?: string}>",
	"components/ladder-view.tsx: Ladders",
	"components/ladder-view.tsx: readJson<{error?: string; reconcile?: boolean}>",
	"components/ladder-view.tsx: readJson<{event: LadderEvent}>",
	"components/ladder-view.tsx: readJson<{ladders: Ladders}>",
	"components/location-picker-host.tsx: RelatedHit",
	"components/location-picker-host.tsx: SearchHit",
	"components/location-picker-host.tsx: readJson<{results: RelatedHit[]}>",
	"components/location-picker-host.tsx: readJson<{results: SearchHit[]}>",
	"components/main-menu-rows.tsx: readJson<{nodes: {id: string}[]}>",
	"components/mobile-more-menu.tsx: readJson<{nodes: {id: string}[]}>",
	"components/related-nodes-panel.tsx: RelatedResponse",
	"components/related-nodes-panel.tsx: readJson<{error?: string}>",
	"components/search-box.tsx: HelperTagLists",
	"components/search-box.tsx: readJson<{tags: {tag: string}[]}>",
	"hooks/use-calendar-event-days.ts: readJson<{days: number[]}>",
	"hooks/use-calendar-settings.ts: CalendarSettings",
	"hooks/use-calendar-settings.ts: readJson<{error?: unknown}>",
	"hooks/use-customize-commands.ts: readJson<{node: {id: string}}>",
	"hooks/use-hash-location-zoom.ts: readJson<{node: NodeResponse}>",
	"hooks/use-mention-menu.tsx: readJson<{tags: {tag: string}[]}>",
	"hooks/use-mirror-menu.tsx: MirrorHit",
	"hooks/use-mirror-menu.tsx: readJson<{results: MirrorHit[]}>",
	"hooks/use-nodes.ts: readJson<{ancestors: NodeResponse[]}>",
	"hooks/use-nodes.ts: readJson<{children: Record<string, NodeResponse[]>}>",
	"hooks/use-nodes.ts: readJson<{ids: string[]}>",
	"hooks/use-nodes.ts: readJson<{items: SubtreeItem[]}>",
	"hooks/use-nodes.ts: readJson<{node: NodeResponse | null}>",
	"hooks/use-nodes.ts: readJson<{node: NodeResponse}>",
	"hooks/use-nodes.ts: readJson<{nodes: NodeResponse[]}>",
	"hooks/use-nodes.ts: readJson<{warning?: string}>",
	"hooks/use-starred.ts: readJson<{stars: Star[]; nodes?: NodeResponse[]}>",
	"hooks/use-tag-autocomplete.tsx: AutocompleteResult",
	"hooks/use-tag-autocomplete.tsx: readJson<{tags: AutocompleteResult[]}>",
	"notes-location.ts: readJson<{node: NodeResponse}>",
	"paste/create-trees.ts: readJson<{ids: string[]}>",
	"today.ts: readJson<{dayId: string; firstChildId: string | null}>",
	"today.ts: readJson<{id: string; firstChildId: string | null}>",
];

describe("client modules read op responses as schema-inferred types", () => {
	it("declares, copies or inlines no response type beyond the known, shrinking list", () => {
		expect(handTypedResponses()).toStrictEqual(NOT_YET_INFERRED);
	});

	it("finds a locally declared type inside a readJson type argument", () => {
		expect(
			readJsonTypeArgs(
				"interface Local {a: string}\nreadJson<Partial<Local> & {error?: string}>(r); readJson<{f: () => X}>(r);",
			),
		).toStrictEqual(["Partial<Local> & {error?: string}", "{f: () => X}"]);
	});

	it("treats types imported from client modules as copies, but not node-types or server types", () => {
		expect([
			...clientImportedTypes(
				[
					'import type {Copy, Other as Renamed} from "../calendar-layout-model.js";',
					'import {type Mixed, value} from "./mirror-menu.js";',
					'import type {NodeResponse} from "../../node-types.js";',
					'import type {SwitcherResponse} from "../../server/switcher-search.js";',
					'import type {Star} from "@workflowy/shared";',
				].join("\n"),
			),
		]).toStrictEqual(["Copy", "Renamed", "Mixed", "value"]);
	});
});
