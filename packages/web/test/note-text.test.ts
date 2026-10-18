import {describe, expect, it} from "vite-plus/test";
import {editorHtmlToNote, noteToEditorHtml} from "../src/client/note-text.js";

describe("editorHtmlToNote", () => {
	it("turns <br> into a newline", () => {
		expect(editorHtmlToNote("abc<br>def")).toBe("abc\ndef");
	});

	it("turns each block after the first into a newline and drops a block's placeholder <br>", () => {
		expect(editorHtmlToNote("abc<div>def</div><div><br></div>")).toBe("abc\ndef\n");
	});

	it("keeps a blank line between paragraph blocks", () => {
		expect(editorHtmlToNote("<p>abc</p><p><br></p><p>def</p>")).toBe("abc\n\ndef");
	});

	it("unwraps innerContentContainer and keeps formatting tags", () => {
		expect(editorHtmlToNote('<span class="innerContentContainer"><b>Bold</b> and #tag</span>')).toBe(
			"<b>Bold</b> and #tag",
		);
	});

	it("keeps italic, underline, strike, code, links, colors, and dates", () => {
		const html =
			'<i>i</i><u>u</u><s>s</s><code>c</code><a href="https://x.test">x</a>' +
			'<span class="colored c-red">r</span><span class="colored bc-blue">b</span>' +
			'<time startYear="2026" startMonth="9" startDay="4">Fri, Sep 4, 2026</time>';
		expect(editorHtmlToNote(html)).toBe(html);
	});

	it("replaces tag decoration spans and unknown tags with their text", () => {
		expect(
			editorHtmlToNote(
				'<span class="contentTag"><span class="tag-link">#home</span></span> <font color="red">x</font><img src="a.png">',
			),
		).toBe("#home x");
	});

	it("turns &nbsp; and non-breaking spaces into plain spaces", () => {
		expect(editorHtmlToNote("a&nbsp;b c")).toBe("a b c");
	});

	it("keeps literal newlines and other entities", () => {
		expect(editorHtmlToNote("Line\n one &amp; two")).toBe("Line\n one &amp; two");
	});

	it("saves an emptied editor as an empty note", () => {
		expect(editorHtmlToNote("<br>")).toBe("");
	});
});

describe("noteToEditorHtml", () => {
	it("repairs legacy <br> line breaks into newlines", () => {
		expect(noteToEditorHtml("abc<br>def<br/>ghi")).toBe("abc\ndef\nghi");
	});

	it("leaves a clean note unchanged", () => {
		expect(noteToEditorHtml("<b>a</b>\nb")).toBe("<b>a</b>\nb");
	});
});
