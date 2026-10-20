import {describe, expect, it} from "vite-plus/test";
import {renderLinks} from "../src/client/link-render.js";

describe("renderLinks", () => {
	it("renders a stored anchor with upstream's contentLink markup", () => {
		expect(renderLinks('See <a href="https://example.com/a?b=1&amp;c=2">site</a> now')).toBe(
			'See <a class="contentLink" target="_blank" rel="noreferrer" href="https://example.com/a?b=1&amp;c=2">site</a> now',
		);
	});

	it("replaces stored attributes other than href", () => {
		expect(renderLinks("<a target='_self' class=\"x\" href='https://example.com/'>x</a>")).toBe(
			'<a class="contentLink" target="_blank" rel="noreferrer" href="https://example.com/">x</a>',
		);
	});

	it("keeps formatting nested inside the link", () => {
		expect(renderLinks('<a href="mailto:a@example.com"><b>mail</b></a>')).toBe(
			'<a class="contentLink" target="_blank" rel="noreferrer" href="mailto:a@example.com"><b>mail</b></a>',
		);
	});

	it("renders a javascript: link's text as plain text without the anchor", () => {
		expect(renderLinks('a <a href=" JavaScript:alert(1)">bad <b>x</b></a> b <a href="https://x.test/">y</a>')).toBe(
			'a bad <b>x</b> b <a class="contentLink" target="_blank" rel="noreferrer" href="https://x.test/">y</a>',
		);
	});

	it("leaves text without anchors untouched", () => {
		const html = "Plain <b>bold</b> &amp; <abbr>abbr</abbr>";
		expect(renderLinks(html)).toBe(html);
	});
});
