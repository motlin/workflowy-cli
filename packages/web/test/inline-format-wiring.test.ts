import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import {insertWithPendingFormat, togglePendingAttr} from "../src/client/hooks/use-inline-format.js";

function source(path: string): string {
	return readFileSync(new URL(`../src/client/components/${path}`, import.meta.url), "utf8");
}

describe("inline format wiring", () => {
	it("routes both editors' format commands through applyInlineToggle, never execCommand", () => {
		const files = ["editable-text.tsx", "editable-note.tsx"];
		expect(
			files.map((file) => {
				const text = source(file);
				return [file, text.includes("execCommand("), text.includes("applyInlineToggle")];
			}),
		).toStrictEqual([
			["editable-text.tsx", false, true],
			["editable-note.tsx", false, true],
		]);
	});
});

describe("togglePendingAttr", () => {
	it("adds an attribute once and removes it on the second toggle", () => {
		const once = togglePendingAttr(new Set(), "b");
		const twice = togglePendingAttr(once, "b");
		expect([[...once], [...twice], [...togglePendingAttr(once, "i")]]).toStrictEqual([["b"], [], ["b", "i"]]);
	});
});

describe("insertWithPendingFormat", () => {
	it("applies pending attributes to the first typed character; the rest inherit from it", () => {
		expect([
			insertWithPendingFormat("ab", 1, new Set(["b"]), "z"),
			insertWithPendingFormat("ab", 1, new Set(["b"]), "zy"),
			insertWithPendingFormat("<b>ab</b>", 2, new Set(["b"]), "z"),
			insertWithPendingFormat("", 0, new Set(["b", "i"]), "x"),
		]).toStrictEqual(["a<b>z</b>b", "a<b>zy</b>b", "<b>ab</b>z", "<i><b>x</b></i>"]);
	});
});
