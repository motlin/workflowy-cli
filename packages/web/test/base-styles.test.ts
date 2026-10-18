import {describe, expect, it} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {cssBlock} from "./helpers/css-block.js";

function readSource(relative: string): string {
	return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const styles = readSource("../src/client/styles.css");
const indexHtml = readSource("../src/client/index.html");

const SYSTEM_FONT_STACK =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, var(--emoji-font, "Apple Color Emoji"), "Segoe UI Emoji", "Segoe UI Symbol"';

const CHROME_LINKS = ".wf-header a, .leftBar a, .wf-menu a, .wf-helper a";
const CHROME_LINKS_HOVER = ".wf-header a:hover, .leftBar a:hover, .wf-menu a:hover, .wf-helper a:hover";

// Element list from upstream media/css/reset.css (Eric Meyer reset), which upstream loads before tailwind.
const RESET_ELEMENTS = [
	"html, body, div, span, applet, object, iframe,",
	"h1, h2, h3, h4, h5, h6, p, blockquote, pre,",
	"a, abbr, acronym, address, big, cite, code,",
	"del, dfn, em, font, img, ins, kbd, q, s, samp,",
	"small, strike, strong, sub, sup, tt, var,",
	"b, u, i, center,",
	"dl, dt, dd, ol, ul, li,",
	"fieldset, form, label, legend,",
	"table, caption, tbody, tfoot, thead, tr, th, td",
].join(" ");

function stripComments(css: string): string {
	return css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
}

describe("upstream base styles", () => {
	it("uses upstream's system font stack on body and --wf-font-family", () => {
		expect(cssBlock(styles, "body")["font-family"]).toBe(SYSTEM_FONT_STACK);
		expect(cssBlock(styles, ":root")["--wf-font-family"]).toBe(SYSTEM_FONT_STACK);
	});

	it("keeps the local body line-height", () => {
		expect(cssBlock(styles, "body")["line-height"]).toBe("1.5");
	});

	it("defines the font-custom variable scope verbatim", () => {
		expect(cssBlock(styles, ".font-system .font-custom, .font-default .font-custom")).toStrictEqual({
			"--font-default-line-height": "24px",
			"--font-descendant-padding-top": "4px",
			"--expand-collapse--top": "6px",
			"--bullet--top": "7px",
			"--item-menu--top": "4px",
			"--item-menu-root--top": "7px",
			"--font-ui-font-size": "13px",
			"--font-default-font-size": "16px",
			"--font-descendant-note-font-size": "13px",
			"--font-selected-name-font-size": "27px",
			"--font-selected-name-line-height": "34px",
			"--font-minimal-document-height": "27px",
			"--font-help-text-font-size": "12px",
		});
	});

	it("resets anchors inside chrome only", () => {
		expect(cssBlock(styles, CHROME_LINKS)).toStrictEqual({
			"text-decoration": "none",
			color: "inherit",
			cursor: "pointer",
		});
		expect(cssBlock(styles, CHROME_LINKS_HOVER)).toStrictEqual({"text-decoration": "underline"});
	});

	it("ports FontAwesome svg-core sizing", () => {
		expect(cssBlock(styles, ".svg-inline--fa")).toStrictEqual({
			display: "inline-block",
			height: "1em",
			overflow: "visible",
			"vertical-align": "-0.125em",
		});
		expect(cssBlock(styles, ".fa-1x")).toStrictEqual({"font-size": "1em"});
		expect(cssBlock(styles, ".fa-lg")).toStrictEqual({
			"font-size": "1.25em",
			"line-height": "0.05em",
			"vertical-align": "-0.075em",
		});
		expect(cssBlock(styles, ".fa-xs")).toStrictEqual({
			"font-size": "0.75em",
			"line-height": "0.0833333337em",
			"vertical-align": "0.125em",
		});
		expect(cssBlock(styles, ".fa-sm")).toStrictEqual({
			"font-size": "0.875em",
			"line-height": "0.0714285718em",
			"vertical-align": "0.0535714295em",
		});
		expect(cssBlock(styles, ".svg-inline--fa.fa-lg")).toStrictEqual({"vertical-align": "-0.2em"});
		expect(cssBlock(styles, ".svg-inline--fa.fa-xs")).toStrictEqual({"vertical-align": "0"});
		expect(cssBlock(styles, ".svg-inline--fa.fa-sm")).toStrictEqual({"vertical-align": "-0.0714285705em"});
		expect(cssBlock(styles, ".fa-fw")).toStrictEqual({"text-align": "center", width: "1.25em"});
		expect(cssBlock(styles, ".svg-inline--fa.fa-fw")).toStrictEqual({width: "1.25em"});
	});

	it("ports upstream .button", () => {
		expect(cssBlock(styles, ".button")).toStrictEqual({
			display: "inline-block",
			position: "relative",
			"-webkit-appearance": "none",
			appearance: "none",
			border: "none",
			outline: "none",
			"box-sizing": "border-box",
			"border-radius": "var(--wf-radius-pill)",
			padding: "var(--wf-space-s) var(--wf-space-l)",
			"font-weight": "var(--wf-font-weight-regular)",
			"line-height": "var(--wf-line-height-s)",
			"font-family": "inherit",
			"font-size": "var(--wf-font-size-s)",
			background: "var(--wf-background-tertiary)",
			"text-align": "center",
			"text-decoration": "none",
			color: "var(--wf-text-primary)",
			cursor: "pointer",
			"-webkit-tap-highlight-color": "transparent",
		});
		expect(cssBlock(styles, ".button:focus, .button:hover, .button:active")).toStrictEqual({
			"text-decoration": "none",
			"background-color": "color-mix(in srgb, var(--wf-background-quaternary) 85%, black)",
		});
	});

	it("does not add a bare button rule", () => {
		// A selector that starts with `button` would restyle every local <button>; descendants like `.x button` are fine.
		expect(/(^|[{},;])\s*button\s*[,{:]/u.test(stripComments(styles))).toBe(false);
	});

	it("ports upstream scrollbar styling", () => {
		expect(cssBlock(styles, "::-webkit-scrollbar")).toStrictEqual({width: "7px", height: "7px"});
		expect(cssBlock(styles, "::-webkit-scrollbar-track")).toStrictEqual({"background-color": "unset"});
		expect(cssBlock(styles, "::-webkit-scrollbar-thumb")).toStrictEqual({
			"background-color": "color-mix(in srgb, currentColor 20%, transparent)",
			"border-radius": "4px",
		});
		expect(cssBlock(styles, "::-webkit-scrollbar-thumb:hover")).toStrictEqual({
			"background-color": "color-mix(in srgb, currentColor 30%, transparent)",
		});
	});

	it("ports the border part of upstream reset.css so border-solid utilities draw only their sized sides", () => {
		expect(cssBlock(styles, RESET_ELEMENTS)).toStrictEqual({border: "0"});
	});

	it("ports upstream .content word-break so long URLs wrap", () => {
		expect(cssBlock(styles, ".content")).toStrictEqual({
			"word-break": "break-word",
			position: "relative",
			"-webkit-user-select": "text",
			"user-select": "text",
			"min-width": "0",
		});
	});

	it("colors content links with upstream's .contentLink tint", () => {
		expect(cssBlock(styles, ".contentLink, .content a")).toStrictEqual({
			color: "var(--wf-text-tint)",
			cursor: "pointer",
			"text-decoration": "underline",
		});
	});

	it("colors internal workflowy.com and localhost links tertiary gray like upstream", () => {
		const prefixes = [
			"https://workflowy.com",
			"https://dev.workflowy.com",
			"https://beta.workflowy.com",
			"http://workflowy.com",
			"http://dev.workflowy.com",
			"http://beta.workflowy.com",
			"http://localhost",
		];
		const selector = [".contentLink", ".content a"]
			.flatMap((base) => prefixes.map((prefix) => `${base}[href^="${prefix}"]`))
			.join(", ");
		expect(cssBlock(styles, selector)).toStrictEqual({color: "var(--wf-text-tertiary)"});
	});

	it("colors links in search matches sky like upstream", () => {
		expect(
			cssBlock(
				styles,
				".fullMatch .contentLink, .project.metaMatches .contentLink, .fullMatch .content a, .project.metaMatches .content a",
			),
		).toStrictEqual({color: "var(--wf-text-sky)"});
	});

	it("marks the body as a desktop system-font page", () => {
		expect(indexHtml).toContain('<body class="is-desktop font-system">');
	});
});
