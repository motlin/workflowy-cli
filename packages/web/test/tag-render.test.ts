import {describe, expect, it} from "vite-plus/test";
import {renderTags, tagAtOffset, teaserPosition, toggleTagInQuery} from "../src/client/tag-render.js";

function tagSpan(tag: string): string {
	return `<span class="contentTag explosive" title="Filter ${tag}" data-val="${tag.toLowerCase()}">${tag.slice(0, 1)}<span class="contentTagText">${tag.slice(1)}</span><span class="contentTagNub"></span></span>`;
}

describe("renderTags", () => {
	it("wraps a tag in the upstream contentTag markup", () => {
		expect(renderTags("Alpha #taZebra item")).toBe(
			'Alpha <span class="contentTag explosive" title="Filter #taZebra" data-val="#tazebra">#<span class="contentTagText">taZebra</span><span class="contentTagNub"></span></span> item',
		);
	});

	it("never tags text inside links, attributes, or after an entity", () => {
		const html = 'Link <a href="https://example.com/#taFrag">site #taLinked</a> and &amp;#taAmp';
		expect(renderTags(html)).toBe(html);
	});

	it("never tags text inside code", () => {
		const html = "Run <code>#taCode</code> now";
		expect(renderTags(html)).toBe(html);
	});

	it("keeps formatting that wraps the whole tag outside the span", () => {
		expect(renderTags("Bold <b>#taBold</b> tag")).toBe(
			'Bold <b><span class="contentTag explosive" title="Filter #taBold" data-val="#tabold">#<span class="contentTagText">taBold</span><span class="contentTagNub"></span></span></b> tag',
		);
	});

	it("skips short numeric tags", () => {
		expect(renderTags("Numbers #123 #1234")).toBe(`Numbers #123 ${tagSpan("#1234")}`);
	});

	it("wraps a colon-joined tag as one span", () => {
		expect(renderTags("Delta #ta:sub:key end")).toBe(`Delta ${tagSpan("#ta:sub:key")} end`);
	});

	it("wraps mentions the same way", () => {
		expect(renderTags("Ping @Alice now")).toBe(`Ping ${tagSpan("@Alice")} now`);
	});

	it("re-encodes the tag text exactly as it appeared and escapes attributes", () => {
		expect(renderTags("Amp #ta&amp;b end")).toBe(
			'Amp <span class="contentTag explosive" title="Filter #ta&amp;b" data-val="#ta&amp;b">#<span class="contentTagText">ta&amp;b</span><span class="contentTagNub"></span></span> end',
		);
	});

	it("leaves a tag split across formatting untouched", () => {
		const html = "Split #ta<b>Half</b> end";
		expect(renderTags(html)).toBe(html);
	});

	it("treats &nbsp; as a boundary", () => {
		expect(renderTags("Space&nbsp;#taNbsp end")).toBe(`Space&nbsp;${tagSpan("#taNbsp")} end`);
	});
});

describe("tagAtOffset", () => {
	it("returns the tag spanning the plain-text offset", () => {
		expect([0, 6, 10, 14, 15].map((offset) => tagAtOffset("Alpha #taZebra item", offset))).toStrictEqual([
			undefined,
			"#taZebra",
			"#taZebra",
			"#taZebra",
			undefined,
		]);
	});
});

describe("teaserPosition", () => {
	it("places the teaser at the tag's right edge, vertically centred plus the Flyout margin", () => {
		expect(teaserPosition({top: 146.5, right: 216.92, height: 19})).toStrictEqual({left: 215.92, top: 146.5});
	});
});

describe("toggleTagInQuery", () => {
	it("appends a new tag and removes one already in the query, case-insensitively, keeping one trailing space", () => {
		expect({
			empty: toggleTagInQuery("", "#taZebra"),
			append: toggleTagInQuery("#taZebra ", "#taApple"),
			removeCaseInsensitive: toggleTagInQuery("#taZebra #taApple ", "#TAAPPLE"),
			removeLast: toggleTagInQuery("#taZebra ", "#taZebra"),
			prefixIsNotMatch: toggleTagInQuery("#taZebraLong ", "#taZebra"),
			regexChars: toggleTagInQuery("#a.b ", "#a+b"),
		}).toStrictEqual({
			empty: "#taZebra ",
			append: "#taZebra #taApple ",
			removeCaseInsensitive: "#taZebra ",
			removeLast: "",
			prefixIsNotMatch: "#taZebraLong #taZebra ",
			regexChars: "#a.b #a+b ",
		});
	});
});
