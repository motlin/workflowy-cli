import {beforeEach, describe, expect, it} from "vite-plus/test";
import * as latestColor from "../src/client/latest-color.js";

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		values,
	};
}

describe("latest color store", () => {
	beforeEach(() => {
		latestColor.resetLatestColorForTests(memoryStorage());
	});

	it("starts empty", () => {
		expect([latestColor.get(), latestColor.swatchClass()]).toStrictEqual([undefined, ""]);
	});

	it("names the swatch class after the latest kind and color", () => {
		latestColor.change("highlight", "yellow");
		expect(latestColor.swatchClass()).toBe("bc-yellow");
		latestColor.change("text", "red");
		expect(latestColor.swatchClass()).toBe("c-red");
	});

	it("persists the latest color across loads", () => {
		const storage = memoryStorage();
		latestColor.resetLatestColorForTests(storage);
		latestColor.change("highlight", "yellow");
		latestColor.resetLatestColorForTests(storage);
		expect(latestColor.get()).toStrictEqual({kind: "highlight", color: "yellow"});
	});

	it("removes the color once after a null change, keeping the latest", () => {
		latestColor.change("highlight", "yellow");
		latestColor.change("text", null);
		const html = 'a <span class="colored bc-yellow">bc</span> d';
		expect([
			latestColor.get(),
			latestColor.planApply(html, 2, 4),
			latestColor.planApply("a bc d", 2, 4),
		]).toStrictEqual([
			{kind: "highlight", color: "yellow"},
			"a bc d",
			'a <span class="colored bc-yellow">bc</span> d',
		]);
	});

	it("toggles the latest color on a selection and back, keeping other formats", () => {
		latestColor.change("highlight", "yellow");
		const once = latestColor.planApply("TFT <b>text</b>", 4, 8);
		expect([once, latestColor.planApply(once, 4, 8)]).toStrictEqual([
			'TFT <span class="colored bc-yellow"><b>text</b></span>',
			"TFT <b>text</b>",
		]);
	});

	it("leaves the html alone when nothing was picked", () => {
		expect(latestColor.planApply("a bc d", 2, 4)).toBe("a bc d");
	});

	it("does not throw when storage throws", () => {
		latestColor.resetLatestColorForTests({
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
		});
		expect(latestColor.get()).toBeUndefined();
		latestColor.change("text", "blue");
		expect(latestColor.swatchClass()).toBe("c-blue");
	});
});
