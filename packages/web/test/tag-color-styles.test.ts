import {describe, expect, it} from "vite-plus/test";
import {buildTagColorCss, normalizeTagColors} from "../src/client/tag-color-styles.js";

describe("buildTagColorCss", () => {
	it("emits upstream's rule set once per color group, selectors joined with commas", () => {
		const groupRules = (selectors: (suffix: string, prefix?: string) => string, color: string) =>
			[
				`${selectors("")} {\n    background-color: var(--wf-tag-bg-${color})!important;\n    color: var(--wf-text-primary)!important;\n}`,
				`${selectors(" span")} {\n    background: none;\n}`,
				`${selectors(":hover")} {\n    background-color: inherit;\n    text-decoration: underline;\n}`,
				`${selectors(".contentTag .contentTagText")} {\n    text-decoration: none;\n}`,
				`${selectors("", ".notes ")} {\n}`,
				`${selectors("", ".done ")} {\n    opacity: 0.5;\n}`,
			].join("\n");
		const green = (suffix: string, prefix = "") =>
			`${prefix}.contentTag[data-val="#tazebra"]${suffix},${prefix}.contentTag[data-val="#taapple"]${suffix}`;
		const red = (suffix: string, prefix = "") => `${prefix}.contentTag[data-val="#x"]${suffix}`;

		expect(buildTagColorCss({"#tazebra": "green", "#taapple": "green", "#x": "red"})).toBe(
			`${groupRules(green, "green")}\n${groupRules(red, "red")}\n`,
		);
	});

	it("is empty without colors", () => {
		expect(buildTagColorCss({})).toBe("");
	});

	it("escapes quotes and backslashes in the attribute value", () => {
		expect(buildTagColorCss({'#a"b\\c': "red"}).split("\n")[0]).toBe(
			String.raw`.contentTag[data-val="#a\"b\\c"] {`,
		);
	});
});

describe("normalizeTagColors", () => {
	it("lowercases keys", () => {
		expect(normalizeTagColors({"#TaZebra": "green", "@Alice": "red"})).toStrictEqual({
			"#tazebra": "green",
			"@alice": "red",
		});
	});
});
