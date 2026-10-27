import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {decisionsDirectory, fileDecisionStore} from "../src/server/decision-files.js";

let directory: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "decisions-"));
});

afterEach(() => {
	rmSync(directory, {recursive: true, force: true});
});

describe("fileDecisionStore", () => {
	it("reads null for a slug with no staged file or answers", async () => {
		const store = fileDecisionStore(directory);
		expect([await store.readDocument("meetings"), await store.readAnswers("meetings")]).toStrictEqual([null, null]);
	});

	it("reads the staged document and answers files by slug", async () => {
		writeFileSync(join(directory, "meetings.json"), '{"doc":1}');
		writeFileSync(join(directory, "meetings.answers.json"), '{"a":1}');
		const store = fileDecisionStore(directory);
		expect([await store.readDocument("meetings"), await store.readAnswers("meetings")]).toStrictEqual([
			'{"doc":1}',
			'{"a":1}',
		]);
	});

	it("writes answers by renaming a temp file, leaving no temp file behind", async () => {
		writeFileSync(join(directory, "meetings.answers.json"), "old");
		const store = fileDecisionStore(directory);
		await store.writeAnswers("meetings", '{"new":true}');
		expect({
			files: readdirSync(directory),
			text: readFileSync(join(directory, "meetings.answers.json"), "utf8"),
		}).toStrictEqual({files: ["meetings.answers.json"], text: '{"new":true}'});
	});

	it("refuses a slug that could escape the directory", async () => {
		const store = fileDecisionStore(directory);
		await expect(store.readDocument("../etc")).rejects.toThrow(
			new Error('Decision slug must match [a-z0-9-]+, got "../etc"'),
		);
	});
});

describe("decisionsDirectory", () => {
	it("honors WORKFLOWY_DECISIONS_DIR", () => {
		expect(decisionsDirectory({WORKFLOWY_DECISIONS_DIR: "/somewhere"})).toBe("/somewhere");
	});

	it("defaults to the repo's .llm/gtd/review/decisions", () => {
		expect(decisionsDirectory({})).toBe(join(import.meta.dirname, "../../../.llm/gtd/review/decisions"));
	});
});
