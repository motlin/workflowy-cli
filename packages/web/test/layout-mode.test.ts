import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vite-plus/test";
import {resolveLayoutMode} from "../src/client/components/layout-mode.js";

describe("resolveLayoutMode", () => {
	it.each([
		["bullets", {projectClass: null, isTodo: false, isMultiline: false, hidesBullet: false}],
		["h1", {projectClass: "header1", isTodo: false, isMultiline: false, hidesBullet: true}],
		["p", {projectClass: "paragraph", isTodo: false, isMultiline: false, hidesBullet: false}],
		["paragraph", {projectClass: "paragraph", isTodo: false, isMultiline: false, hidesBullet: false}],
		["todo", {projectClass: "checkmark", isTodo: true, isMultiline: false, hidesBullet: false}],
		["check", {projectClass: "checkmark", isTodo: true, isMultiline: false, hidesBullet: false}],
		["numbered", {projectClass: null, isTodo: false, isMultiline: false, hidesBullet: false}],
		["board", {projectClass: "board", isTodo: false, isMultiline: false, hidesBullet: false}],
		["table", {projectClass: null, isTodo: false, isMultiline: false, hidesBullet: false}],
		["quote-block", {projectClass: "quote-block", isTodo: false, isMultiline: true, hidesBullet: false}],
		["quote", {projectClass: "quote-block", isTodo: false, isMultiline: true, hidesBullet: false}],
		["code-block", {projectClass: "code-block", isTodo: false, isMultiline: true, hidesBullet: false}],
		["divider", {projectClass: "divider", isTodo: false, isMultiline: false, hidesBullet: true}],
	])("resolves %s", (layoutMode, expected) => {
		expect(resolveLayoutMode(layoutMode)).toStrictEqual(expected);
	});
});

const CLIENT_DIR = fileURLToPath(new URL("../src/client", import.meta.url));

function clientSources(dir: string): string[] {
	return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			return clientSources(full);
		}
		return /\.tsx?$/u.test(entry.name) ? [full] : [];
	});
}

describe("stored layoutMode writes", () => {
	it("never writes the legacy paragraph/quote values upstream ignores", () => {
		const legacyWrite =
			/layoutMode: "(paragraph|quote)"|setLayoutMode\([^)]*"(paragraph|quote)"\)|id: "(paragraph|quote)"/u;
		const offenders = clientSources(CLIENT_DIR).filter((file) => legacyWrite.test(readFileSync(file, "utf8")));
		expect(offenders).toStrictEqual([]);
	});
});
