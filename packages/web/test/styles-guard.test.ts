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

	it("keeps only the header color rule and the overflow-menu line-height for crumbs", () => {
		expect(declarationsFor(/\.breadcrumbs?\b|\.breadcrumb-item\b/u)).toStrictEqual([
			"color: var(--wf-text-primary) !important;",
			"line-height: 1;",
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

const tailwind = readFileSync(fileURLToPath(new URL("../src/client/wf-tailwind.css", import.meta.url)), "utf8");

function normalizedBlocks(css: string, selector: string): string[] {
	const stripped = css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
	return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
		.filter((match) => match[1].trim() === selector)
		.map((match) =>
			match[2]
				.split(";")
				.map((declaration) => declaration.trim().replaceAll(/\s+/gu, " "))
				.filter((declaration) => declaration !== "")
				.join(";"),
		);
}

describe("flyout surface styles guard", () => {
	it("keeps the flyout content-box so max-width 240 gives a 252px border-box", () => {
		expect(normalizedBlocks(styles, ".wf-menu.flyout")).toStrictEqual(["box-sizing: content-box"]);
	});

	it("scopes the light and dark .wf-menu tokens", () => {
		expect({
			light: normalizedBlocks(styles, ':root:not([data-theme="dark"]) .wf-menu'),
			dark: normalizedBlocks(styles, '[data-theme="dark"] .wf-menu'),
		}).toStrictEqual({
			light: ["--wf-text-primary: var(--wf-gray-700);--wf-border-secondary: var(--wf-gray-400)"],
			dark: [
				"--wf-text-primary: var(--wf-dark-gray-200);--wf-border-primary: var(--wf-dark-gray-600);--wf-border-secondary: var(--wf-dark-gray-500)",
			],
		});
	});

	it("relies on the cloned tailwind utilities for the surface and scroller", () => {
		const selectors = [
			".flex",
			".flex-col",
			".border",
			".border-solid",
			".border-primary",
			".font-normal",
			".text-xs",
			".rounded-md",
			".bg-primary",
			".shadow-md",
			".overflow-x-hidden",
			String.raw`.\[transition\:200ms_opacity\]`,
			String.raw`.print\:hidden`,
			".overflow-y-auto",
			String.raw`.is-desktop .desktop\:max-h-\[min\(var\(--menu-max-h\)\2c calc\(100vh-50px\)\)\]`,
			String.raw`.\[\&\>\*\:first-child\]\:mt-xs>*:first-child`,
			String.raw`.\[\&\>\*\:last-child\]\:mb-xs>*:last-child`,
		];
		expect(
			Object.fromEntries(selectors.map((selector) => [selector, normalizedBlocks(tailwind, selector)])),
		).toStrictEqual({
			".flex": ["display: flex"],
			".flex-col": ["flex-direction: column"],
			".border": ["border-width: 1px"],
			".border-solid": ["border-style: solid"],
			".border-primary": ["border-color: var(--wf-border-primary)"],
			".font-normal": ["font-weight: 400"],
			".text-xs": ["font-size: 0.79rem"],
			".rounded-md": ["border-radius: 0.375rem"],
			".bg-primary": ["background-color: var(--wf-background-primary)"],
			".shadow-md": [
				"--tw-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);--tw-shadow-colored: 0 4px 6px -1px var(--tw-shadow-color), 0 2px 4px -2px var(--tw-shadow-color);box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow)",
			],
			".overflow-x-hidden": ["overflow-x: hidden"],
			".\\[transition\\:200ms_opacity\\]": ["transition: 200ms opacity"],
			".print\\:hidden": ["display: none"],
			".overflow-y-auto": ["overflow-y: auto"],
			".is-desktop .desktop\\:max-h-\\[min\\(var\\(--menu-max-h\\)\\2c calc\\(100vh-50px\\)\\)\\]": [
				"max-height: min(var(--menu-max-h),calc(100vh - 50px))",
			],
			".\\[\\&\\>\\*\\:first-child\\]\\:mt-xs>*:first-child": ["margin-top: 0.25rem"],
			".\\[\\&\\>\\*\\:last-child\\]\\:mb-xs>*:last-child": ["margin-bottom: 0.25rem"],
		});
	});
});

describe("menu item styles guard", () => {
	it("styles .wf-menu .menuItem rows, icons, shortcuts, separators and section headers", () => {
		const selectors = [
			".wf-menu .menuItem",
			".wf-menu .menuItem.pl-xl",
			".wf-menu .menuItem.text-tertiary",
			".wf-menu .menuItem.canHover:hover",
			".wf-menu .menuItem.active",
			".wf-menu .menuItem > span",
			".wf-menu .menuItem > span > span:first-of-type",
			".menuItemIcon",
			".wf-menu .menuItem .text.ml-l",
			".wf-menu .border-t.my-s",
			".menu-section-header",
		];
		expect(
			Object.fromEntries(selectors.map((selector) => [selector, normalizedBlocks(styles, selector)])),
		).toStrictEqual({
			".wf-menu .menuItem": [
				"display: block;padding: 4px 16px;line-height: 18.96px;white-space: nowrap;cursor: pointer;text-decoration: none !important;color: var(--wf-text-primary)",
			],
			".wf-menu .menuItem.pl-xl": ["padding-left: 24px"],
			".wf-menu .menuItem.text-tertiary": ["color: var(--wf-text-tertiary)"],
			".wf-menu .menuItem.canHover:hover": ["background: var(--wf-background-secondary)"],
			".wf-menu .menuItem.active": ["background: var(--wf-background-secondary)"],
			".wf-menu .menuItem > span": [
				"position: relative;display: flex;justify-content: space-between;align-items: center",
			],
			".wf-menu .menuItem > span > span:first-of-type": [
				"flex-grow: 1;display: flex;align-items: center;gap: 8px;overflow: hidden;text-overflow: ellipsis;white-space: nowrap;font-size: 0.79rem",
			],
			".menuItemIcon": ["display: flex;align-items: center;color: var(--wf-text-secondary)"],
			".wf-menu .menuItem .text.ml-l": [
				"margin-left: 16px;min-width: 22px;font-size: 0.79rem;color: var(--wf-text-tertiary)",
			],
			".wf-menu .border-t.my-s": ["border-top: 1px solid var(--wf-border-primary);margin: 6px 0"],
			".menu-section-header": [
				"padding: 8px 16px;font-size: 0.79rem;text-transform: uppercase;color: var(--wf-text-tertiary)",
			],
		});
	});
});
