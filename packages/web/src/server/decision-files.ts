/**
 * The Node host's {@link DecisionStore}: `<slug>.json` and `<slug>.answers.json`
 * in one directory, the repo's `.llm/gtd/review/decisions` unless
 * `WORKFLOWY_DECISIONS_DIR` points elsewhere.
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {DECISION_SLUG} from "./decisions.js";
import type {DecisionStore} from "./decisions.js";

/** src/server and dist/server both sit four levels below the repo root. */
const DEFAULT_DIRECTORY = join(import.meta.dirname, "../../../../.llm/gtd/review/decisions");

export function decisionsDirectory(env: {WORKFLOWY_DECISIONS_DIR?: string | undefined}): string {
	return env.WORKFLOWY_DECISIONS_DIR ?? DEFAULT_DIRECTORY;
}

export function fileDecisionStore(directory: string): DecisionStore {
	const path = (slug: string, suffix: string): string => {
		if (!DECISION_SLUG.test(slug)) {
			throw new Error(`Decision slug must match [a-z0-9-]+, got "${slug}"`);
		}
		return join(directory, `${slug}${suffix}`);
	};
	return {
		readDocument: async (slug) => readIfPresent(path(slug, ".json")),
		readAnswers: async (slug) => readIfPresent(path(slug, ".answers.json")),
		writeAnswers: async (slug, text) => {
			const destination = path(slug, ".answers.json");
			await mkdir(directory, {recursive: true});
			const temporary = `${destination}.${randomUUID()}.tmp`;
			await writeFile(temporary, text);
			await rename(temporary, destination);
		},
	};
}

async function readIfPresent(file: string): Promise<string | null> {
	try {
		return await readFile(file, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}
