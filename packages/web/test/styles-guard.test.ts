import {describe, expect, it} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");
const uncommented = styles.replaceAll(/\/\*[\s\S]*?\*\//gu, "");

function hasSelector(css: string, pattern: RegExp): boolean {
	const preludes = css.replaceAll(/\/\*[\s\S]*?\*\//gu, "").match(/[^{}]+(?=\{)/gu) ?? [];
	return preludes.some((prelude) => pattern.test(prelude));
}

function declarationsFor(selectorPattern: RegExp): string[] {
	return [...uncommented.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
		.filter((match) => selectorPattern.test(match[1]))
		.map((match) => match[2].trim());
}

describe("breadcrumb styles guard", () => {
	it("drops the old local breadcrumb rules", () => {
		expect(
			hasSelector(
				styles,
				/\.breadcrumb-(back|home-icon|path-segment|separator|current)\b|\.breadcrumbs-loading|\.top-bar \.breadcrumbs/u,
			),
		).toBe(false);
	});

	it("has no top-level .breadcrumbs rule", () => {
		expect(hasSelector(styles, /^\.breadcrumbs\s*\{/mu)).toBe(false);
		expect(hasSelector(styles, /^\s*\.breadcrumbs\s*$/mu)).toBe(false);
	});

	it("never sets opacity on .breadcrumb-item", () => {
		expect(
			declarationsFor(/\.breadcrumb-item\b/u).filter((body) => /(^|[;\s])opacity\s*:/u.test(body)),
		).toStrictEqual([]);
	});

	it("keeps only the header color rule for crumbs", () => {
		expect(declarationsFor(/\.breadcrumbs?\b|\.breadcrumb-item\b/u)).toStrictEqual([
			"color: var(--wf-text-primary) !important;",
		]);
	});
});

describe("top bar styles guard", () => {
	it("drops the leftover local-only top-bar rules", () => {
		expect(
			hasSelector(
				styles,
				/\.top-bar-(button|star|menu|separator|avatar|dropdown|calendar-container|completed-container|layout-container|left|right|nav-buttons)\b/u,
			),
		).toBe(false);
	});

	it("keeps the search box rules until search filtering replaces them", () => {
		expect(hasSelector(styles, /\.top-bar-search-box\b/u)).toBe(true);
	});
});
