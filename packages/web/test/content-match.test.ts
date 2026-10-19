import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vite-plus/test";
import {highlightHtml, highlightSearchMatches} from "../src/client/highlight-html.js";
import {cssBlock} from "./helpers/css-block.js";

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");

describe("highlightHtml", () => {
	it("wraps a plain-text range", () => {
		expect(highlightHtml("Green apple pie", [[6, 11]])).toBe('Green <span class="contentMatch">apple</span> pie');
	});

	it("keeps existing markup around the range", () => {
		expect(highlightHtml("a <b>apple</b> b", [[2, 7]])).toBe('a <b><span class="contentMatch">apple</span></b> b');
	});

	it("splits a range that crosses element boundaries", () => {
		expect(highlightHtml("a<b>pp</b>le", [[0, 5]])).toBe(
			'<span class="contentMatch">a</span><b><span class="contentMatch">pp</span></b><span class="contentMatch">le</span>',
		);
	});

	it("counts an entity as one plain character", () => {
		expect(highlightHtml("a &amp; apple", [[4, 9]])).toBe('a &amp; <span class="contentMatch">apple</span>');
	});

	it("wraps several ranges and leaves html without ranges untouched", () => {
		expect({
			several: highlightHtml("apple and apple", [
				[0, 5],
				[10, 15],
			]),
			none: highlightHtml("a <b>b</b>", []),
		}).toStrictEqual({
			several: '<span class="contentMatch">apple</span> and <span class="contentMatch">apple</span>',
			none: "a <b>b</b>",
		});
	});
});

describe("highlightSearchMatches", () => {
	it("highlights the query's text matches on the rendered html's plain text", () => {
		expect({
			term: highlightSearchMatches('Green <span class="contentTag">#apple</span> pie', "apple"),
			empty: highlightSearchMatches("Green apple", ""),
			metaOnly: highlightSearchMatches("Green apple", "is:complete"),
		}).toStrictEqual({
			term: 'Green <span class="contentTag">#<span class="contentMatch">apple</span></span> pie',
			empty: "Green apple",
			metaOnly: "Green apple",
		});
	});
});

describe("contentMatch styles", () => {
	it("colors matches only inside full matches and meta-only matches", () => {
		expect({
			fullMatch: cssBlock(styles, ".fullMatch :is(.content .contentMatch)"),
			doneFullMatch: cssBlock(styles, ".done .fullMatch :is(.content .contentMatch)"),
			selected: cssBlock(styles, ".project.addedToSelection .content .contentMatch"),
			tagDelete: cssBlock(styles, ".content .contentTag.contentTagDelete:hover .contentMatch"),
			meta: cssBlock(styles, ".project.metaMatches > .name > .content > .innerContentContainer"),
		}).toStrictEqual({
			fullMatch: {"background-color": "var(--wf-background-found)"},
			doneFullMatch: {"background-color": "var(--wf-background-found)"},
			selected: {"background-color": "transparent"},
			tagDelete: {"background-color": "transparent"},
			meta: {"background-color": "var(--wf-background-found)"},
		});
	});
});
