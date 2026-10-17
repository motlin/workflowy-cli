import {describe, expect, it} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {themeBodyClass} from "../src/client/theme-body-class.js";
import {cssBlock, cssBlockText} from "./helpers/css-block.js";

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");

// Values copied verbatim from upstream themes_design / themes_default / themes_dark (2026-10-01 dumps);
// hex case and rgba() spacing follow the formatter, which normalises both in styles.css.
const PALETTE: Record<string, string> = {
	"--wf-red-300": "#fdcacf",
	"--wf-red-500": "#f74e5d",
	"--wf-red-700": "#de4854",
	"--wf-red-800": "#cd5c5c",
	"--wf-blue-200": "#c1e1f2",
	"--wf-blue-300": "#49baf2",
	"--wf-blue-400": "#4baddf",
	"--wf-blue-500": "#3a97c5",
	"--wf-dark-blue-100": "#006699",
	"--wf-dark-blue-300": "#336677",
	"--wf-dark-blue-400": "#3c88af",
	"--wf-dark-blue-500": "#18475f",
	"--wf-green-300": "#d5f3e5",
	"--wf-green-500": "#72d7a7",
	"--wf-green-700": "#6ace9f",
	"--wf-yellow-100": "#ffff99",
	"--wf-yellow-200": "#f8c476",
	"--wf-yellow-300": "#df9f2e",
	"--wf-yellow-700": "#7c623b",
	"--wf-dark-gray-100": "#ffffff",
	"--wf-dark-gray-200": "#d9dbdb",
	"--wf-dark-gray-300": "#9ea1a2",
	"--wf-dark-gray-400": "#7c7f81",
	"--wf-dark-gray-500": "#5c6062",
	"--wf-dark-gray-600": "#42484b",
	"--wf-dark-gray-700": "#353c3f",
	"--wf-dark-gray-800": "#2a3135",
	"--wf-white-opaque-10": "rgba(255, 255, 255, 0.1)",
	"--wf-white-opaque-20": "rgba(255, 255, 255, 0.2)",
	"--wf-black-opaque-5": "rgba(0, 0, 0, 0.05)",
	"--wf-black-opaque-20": "rgba(0, 0, 0, 0.2)",
	"--wf-black-opaque-30": "rgba(0, 0, 0, 0.3)",
	"--wf-black-opaque-60": "rgba(0, 0, 0, 0.6)",
	"--wf-black-opaque-70": "rgba(0, 0, 0, 0.7)",
	"--wf-shadow-elevated":
		"0px 3px 3px -2px rgba(0, 0, 0, 0.2), 0px 3px 4px 0px rgba(0, 0, 0, 0.2), 0px 1px 8px 0px rgba(0, 0, 0, 0.2)",
	"--wf-drop-line-z-index": "400",
	"--safe-area-inset-top": "env(safe-area-inset-top, 0px)",
	"--safe-area-inset-right": "env(safe-area-inset-right, 0px)",
	"--safe-area-inset-bottom": "env(safe-area-inset-bottom, 0px)",
	"--safe-area-inset-left": "env(safe-area-inset-left, 0px)",
};

const LIGHT_SEMANTIC: Record<string, string> = {
	"--wf-background-primary": "var(--wf-gray-0)",
	"--wf-background-secondary": "var(--wf-gray-100)",
	"--wf-background-tertiary": "var(--wf-gray-300)",
	"--wf-background-quaternary": "var(--wf-gray-300)",
	"--wf-background-tint": "var(--wf-blue-300)",
	"--wf-background-danger": "var(--wf-red-500)",
	"--wf-background-warning": "var(--wf-yellow-200)",
	"--wf-background-success": "var(--wf-green-700)",
	"--wf-background-info": "var(--wf-blue-200)",
	"--wf-background-selected": "var(--wf-blue-200)",
	"--wf-background-shared": "var(--wf-blue-200)",
	"--wf-background-found": "var(--wf-yellow-100)",
	"--wf-background-ambient": "var(--wf-gray-0)",
	"--wf-background-mentioned": "#eefaff",
	"--wf-background-added": "#bcf0db",
	"--wf-background-moved": "#dcd7fe",
	"--wf-background-completed": "#e2e8f0",
	"--wf-background-edited": "#fef6bc",
	"--wf-background-red": "#fbd5d5",
	"--wf-background-orange": "#fcd9bd",
	"--wf-background-yellow": "#fce96a",
	"--wf-background-green": "#bcf0da",
	"--wf-background-blue": "#c3ddfd",
	"--wf-background-purple": "#dcd7fe",
	"--wf-background-gray": "#e2e8f0",
	"--wf-background-teal": "#bcf0f0",
	"--wf-background-sky": "#bae6fd",
	"--wf-background-pink": "#fbd7fe",
	"--wf-text-primary": "var(--wf-gray-800)",
	"--wf-text-secondary": "var(--wf-gray-700)",
	"--wf-text-tertiary": "var(--wf-gray-500)",
	"--wf-text-quaternary": "var(--wf-gray-700)",
	"--wf-text-quinary": "var(--wf-gray-300)",
	"--wf-text-on-color": "var(--wf-gray-0)",
	"--wf-text-tint": "var(--wf-blue-300)",
	"--wf-text-success": "var(--wf-green-700)",
	"--wf-text-danger": "var(--wf-red-500)",
	"--wf-text-warning": "var(--wf-yellow-200)",
	"--wf-text-spark": "var(--wf-yellow-200)",
	"--wf-text-mentioned": "#38bdf8",
	"--wf-text-added": "#31c48d",
	"--wf-text-moved": "#ac94fa",
	"--wf-text-completed": "#97a6ba",
	"--wf-text-edited": "#e3a008",
	"--wf-text-red": "#e02424",
	"--wf-text-orange": "#d03801",
	"--wf-text-yellow": "#9f580a",
	"--wf-text-green": "#057a55",
	"--wf-text-blue": "#1c64f2",
	"--wf-text-purple": "#7e3af2",
	"--wf-text-gray": "#64748b",
	"--wf-text-teal": "#108190",
	"--wf-text-sky": "#007ab8",
	"--wf-text-pink": "#d60bc1",
	"--wf-border-primary": "var(--wf-gray-300)",
	"--wf-border-secondary": "var(--wf-gray-200)",
	"--wf-border-tint": "var(--wf-blue-300)",
	"--wf-border-danger": "var(--wf-red-500)",
	"--wf-border-warning": "var(--wf-yellow-200)",
	"--wf-border-success": "var(--wf-green-700)",
};

const DARK_SEMANTIC: Record<string, string> = {
	"--wf-background-primary": "var(--wf-dark-gray-800)",
	"--wf-background-secondary": "var(--wf-dark-gray-700)",
	"--wf-background-tertiary": "var(--wf-dark-gray-500)",
	"--wf-background-quaternary": "var(--wf-dark-gray-600)",
	"--wf-background-tint": "var(--wf-dark-blue-400)",
	"--wf-background-danger": "var(--wf-red-500)",
	"--wf-background-warning": "var(--wf-yellow-200)",
	"--wf-background-success": "var(--wf-green-700)",
	"--wf-background-info": "var(--wf-dark-blue-300)",
	"--wf-background-selected": "var(--wf-dark-blue-300)",
	"--wf-background-shared": "var(--wf-dark-blue-300)",
	"--wf-background-found": "var(--wf-dark-blue-100)",
	"--wf-background-ambient": "var(--wf-dark-gray-800)",
	"--wf-background-mentioned": "#28424d",
	"--wf-background-added": "#2e6046",
	"--wf-background-moved": "#584080",
	"--wf-background-completed": "#475569",
	"--wf-background-edited": "#534b2f",
	"--wf-background-red": "#773b3b",
	"--wf-background-orange": "#784c3c",
	"--wf-background-yellow": "#8c7146",
	"--wf-background-green": "#40806b",
	"--wf-background-blue": "#405580",
	"--wf-background-purple": "#584080",
	"--wf-background-gray": "#475569",
	"--wf-background-teal": "#397886",
	"--wf-background-sky": "#496b92",
	"--wf-background-pink": "#7f4080",
	"--wf-text-primary": "var(--wf-dark-gray-100)",
	"--wf-text-secondary": "var(--wf-dark-gray-200)",
	"--wf-text-tertiary": "var(--wf-dark-gray-300)",
	"--wf-text-quaternary": "var(--wf-dark-gray-200)",
	"--wf-text-quinary": "var(--wf-dark-gray-500)",
	"--wf-text-on-color": "var(--wf-dark-gray-100)",
	"--wf-text-tint": "var(--wf-dark-blue-400)",
	"--wf-text-success": "var(--wf-green-700)",
	"--wf-text-danger": "var(--wf-red-500)",
	"--wf-text-warning": "var(--wf-yellow-200)",
	"--wf-text-spark": "var(--wf-yellow-200)",
	"--wf-text-mentioned": "#007ab8",
	"--wf-text-added": "#057a55",
	"--wf-text-moved": "#9f580a",
	"--wf-text-completed": "#64748b",
	"--wf-text-edited": "#9f580a",
	"--wf-text-red": "#f98080",
	"--wf-text-orange": "#ff8a4c",
	"--wf-text-yellow": "#e3a008",
	"--wf-text-green": "#31c48d",
	"--wf-text-blue": "#76a9fa",
	"--wf-text-purple": "#ac94fa",
	"--wf-text-gray": "#97a6ba",
	"--wf-text-teal": "#2dd4bf",
	"--wf-text-sky": "#38bdf8",
	"--wf-text-pink": "#f472b6",
	"--wf-border-primary": "var(--wf-dark-gray-500)",
	"--wf-border-secondary": "var(--wf-dark-gray-600)",
	"--wf-border-tint": "var(--wf-dark-blue-400)",
	"--wf-border-danger": "var(--wf-red-500)",
	"--wf-border-warning": "var(--wf-yellow-200)",
	"--wf-border-success": "var(--wf-green-700)",
};

function pick(block: Record<string, string>, keys: string[]): Record<string, string> {
	return Object.fromEntries(keys.filter((key) => key in block).map((key) => [key, block[key]]));
}

describe("design tokens", () => {
	it("defines the upstream palette and light semantic tokens on :root", () => {
		const expected = {...PALETTE, ...LIGHT_SEMANTIC};
		expect(pick(cssBlock(styles, ":root"), Object.keys(expected))).toStrictEqual(expected);
	});

	it("defines the upstream dark semantic tokens on [data-theme=dark]", () => {
		expect(pick(cssBlock(styles, '[data-theme="dark"]'), Object.keys(DARK_SEMANTIC))).toStrictEqual(DARK_SEMANTIC);
	});

	it("declares --wf-background-tertiary exactly once on :root", () => {
		expect(cssBlockText(styles, ":root").match(/--wf-background-tertiary\s*:/gu)?.length).toBe(1);
	});

	it.each([
		[
			':root:not([data-theme="dark"]) .wf-header',
			{
				"--wf-background-primary": "var(--wf-gray-0)",
				"--wf-text-primary": "var(--wf-gray-500)",
				"--wf-border-primary": "var(--wf-gray-200)",
			},
		],
		[
			':root:not([data-theme="dark"]) .wf-menu',
			{"--wf-text-primary": "var(--wf-gray-700)", "--wf-border-secondary": "var(--wf-gray-400)"},
		],
		[':root:not([data-theme="dark"]) .wf-helper', {"--wf-background-primary": "var(--wf-gray-100)"}],
		[
			'[data-theme="dark"] .wf-header',
			{"--wf-text-primary": "var(--wf-dark-gray-300)", "--wf-border-primary": "var(--wf-dark-gray-600)"},
		],
		[
			'[data-theme="dark"] .wf-menu',
			{
				"--wf-text-primary": "var(--wf-dark-gray-200)",
				"--wf-border-primary": "var(--wf-dark-gray-600)",
				"--wf-border-secondary": "var(--wf-dark-gray-500)",
			},
		],
		['[data-theme="dark"] .wf-helper', {"--wf-background-primary": "var(--wf-gray-700)"}],
		[".wf-menu, .wf-header, .wf-helper", {color: "var(--wf-text-primary)"}],
	])("scopes %s overrides like upstream", (selector, expected) => {
		expect(cssBlock(styles, selector)).toStrictEqual(expected);
	});

	it("maps the effective theme to upstream's body theme class", () => {
		expect([themeBodyClass("dark"), themeBodyClass("light")]).toStrictEqual(["_theme-dark", "_theme-default"]);
	});
});
