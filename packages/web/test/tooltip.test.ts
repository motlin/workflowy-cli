import {describe, expect, it} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {TooltipBox, tooltipPosition} from "../src/client/components/tooltip.js";
import {cssBlock} from "./helpers/css-block.js";

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");

function hasSelector(css: string, pattern: RegExp): boolean {
	const preludes = css.replaceAll(/\/\*[\s\S]*?\*\//gu, "").match(/[^{}]+(?=\{)/gu) ?? [];
	return preludes.some((prelude) => pattern.test(prelude));
}

describe("TooltipBox", () => {
	it("renders upstream's tippy box with content and shortcut as one text node", () => {
		expect(
			renderToStaticMarkup(createElement(TooltipBox, {content: "Today", shortcut: "⌃T", state: "visible"})),
		).toBe(
			'<div class="tippy-box wf-helper tooltip text-xs shadow-md" data-placement="bottom" data-state="visible" role="tooltip" style="max-width:350px;transition-duration:300ms"><div class="tippy-content"><div>Today ⌃T</div></div></div>',
		);
	});

	it("omits the shortcut suffix when there is none", () => {
		expect(renderToStaticMarkup(createElement(TooltipBox, {content: "Present", state: "hidden"}))).toBe(
			'<div class="tippy-box wf-helper tooltip text-xs shadow-md" data-placement="bottom" data-state="hidden" role="tooltip" style="max-width:350px;transition-duration:300ms"><div class="tippy-content"><div>Present</div></div></div>',
		);
	});
});

describe("tooltipPosition", () => {
	it("centers the box 10px below the trigger", () => {
		expect(tooltipPosition({left: 971, width: 36, bottom: 42}, 60, 1272)).toStrictEqual({top: 52, left: 989});
	});

	it("clamps to the left viewport edge", () => {
		expect(tooltipPosition({left: 0, width: 36, bottom: 42}, 100, 1272)).toStrictEqual({top: 52, left: 58});
	});

	it("clamps to the right viewport edge", () => {
		expect(tooltipPosition({left: 1250, width: 20, bottom: 42}, 100, 1272)).toStrictEqual({top: 52, left: 1214});
	});
});

describe("tooltip CSS", () => {
	it("uses upstream's .tooltip rule verbatim", () => {
		expect(cssBlock(styles, ".tooltip")).toStrictEqual({
			padding: "var(--wf-space-s) var(--wf-space-m)",
			"border-radius": "var(--wf-radius-s)",
			background: "var(--wf-background-primary)",
		});
	});

	it("defines local tippy basics", () => {
		expect(cssBlock(styles, ".tippy-box")).toStrictEqual({
			position: "relative",
			color: "var(--wf-text-primary)",
			"line-height": "1",
			"white-space": "nowrap",
			"transition-property": "opacity",
		});
		expect(cssBlock(styles, '.tippy-box[data-state="hidden"]')).toStrictEqual({opacity: "0"});
	});

	it("drops the old arrow, shortcut, content, and trigger rules", () => {
		expect(hasSelector(styles, /\.tooltip-(arrow|shortcut|content|trigger)\b/u)).toBe(false);
	});
});
