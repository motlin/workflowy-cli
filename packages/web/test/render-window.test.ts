import {describe, expect, it} from "vite-plus/test";
import {initialMaxToRender, nextMaxToRender} from "../src/client/render-window.js";

describe("render window", () => {
	it("starts at 200 like upstream useMaxToRender", () => {
		expect(initialMaxToRender).toBe(200);
	});

	it("grows by one step, clamped to the total", () => {
		expect([nextMaxToRender(200, 1000), nextMaxToRender(400, 450), nextMaxToRender(450, 450)]).toStrictEqual([
			400, 450, 450,
		]);
	});

	it("honors a custom step", () => {
		expect(nextMaxToRender(10, 100, 5)).toBe(15);
	});
});
