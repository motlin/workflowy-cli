// @vitest-environment happy-dom
import {describe, expect, it} from "vite-plus/test";
import {formatToString, linkParents} from "../src/client/export-format.js";
import type {ExportFormatType, ExportItem} from "../src/client/export-format.js";
import expected from "./fixtures/export-format-mock-expected.json" with {type: "json"};

let counter = 0;

interface Options {
	note?: string;
	layoutMode?: string;
	completed?: boolean;
}

/** Same builder as the upstream mock: ids end in `counter % 10` so the short ids match the dump. */
function mk(name: string, options: Options = {}, children: ExportItem[] = []): ExportItem {
	counter += 1;
	return {
		id: `mock${String(counter).padStart(8, "0")}-0000-0000-0000-00000000000${counter % 10}`,
		name,
		note: options.note ?? "",
		layoutMode: options.layoutMode ?? null,
		numberedStart: null,
		completed: options.completed ?? false,
		parent: null,
		children,
	};
}

function fixture(): ExportItem {
	counter = 0;
	const root = mk("Export fixture", {note: "Root note line"}, [
		mk("<b>Bold</b> and <i>italic</i> &amp; <u>under</u> #tag", {note: "child note"}, [
			mk("Grandchild A"),
			mk("Grandchild <code>code</code>"),
		]),
		mk('Second <a href="https://example.com">link</a> "quoted" &lt;x&gt;'),
		mk("Todo list", {layoutMode: "todo"}, [mk("Task one"), mk("Task two", {completed: true})]),
		mk("Heading one", {layoutMode: "h1"}),
		mk("", {layoutMode: "divider"}),
		mk("Quote", {layoutMode: "quote-block"}),
		mk("Numbered A", {layoutMode: "numbered"}),
		mk("Numbered B", {layoutMode: "numbered"}),
		mk("Done plain", {completed: true}),
	]);
	linkParents([root]);
	return root;
}

function pair(): ExportItem[] {
	counter = 0;
	return linkParents([mk("Alpha", {note: "a note"}, [mk("Alpha child")]), mk("Beta")]);
}

function leaf(): ExportItem[] {
	counter = 0;
	return linkParents([mk("Leaf only")]);
}

const formats: ExportFormatType[] = ["html", "markdown", "text", "opml"];
const options = {ownerEmail: "user@example.com"};

describe.each(formats)("export formatters against the upstream mock fixture: %s", (format) => {
	it("formats a single root", () => {
		expect(formatToString(format, [fixture()], undefined, options)).toStrictEqual(expected[`single_${format}`]);
	});
	it("formats two roots", () => {
		expect(formatToString(format, pair(), undefined, options)).toStrictEqual(expected[`multi_${format}`]);
	});
	it("formats a single leaf", () => {
		expect(formatToString(format, leaf(), undefined, options)).toStrictEqual(expected[`leaf_${format}`]);
	});
});

describe("export formatters keep text that looks like a tag", () => {
	it("keeps a note with a literal angle-bracket word in opml", () => {
		counter = 0;
		const items = linkParents([mk("Row", {note: "line two & <three>"})]);
		expect(formatToString("opml", items)).toContain('_note="line two &amp; &lt;three&gt;"');
	});
});
