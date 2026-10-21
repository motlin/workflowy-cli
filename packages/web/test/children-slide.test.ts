import {describe, expect, it} from "vite-plus/test";
import {expansionSlide} from "../src/client/children-slide.js";

describe("expansionSlide", () => {
	it("slides when the row itself expands or collapses, in or out of a search", () => {
		expect([
			expansionSlide({expanded: false, searching: false}, {expanded: true, searching: false}),
			expansionSlide({expanded: true, searching: false}, {expanded: false, searching: false}),
			expansionSlide({expanded: false, searching: true}, {expanded: true, searching: true}),
			expansionSlide({expanded: true, searching: true}, {expanded: false, searching: true}),
		]).toStrictEqual(["down", "up", "down", "up"]);
	});

	it("does not slide when entering or leaving a search changes the expansion", () => {
		expect([
			expansionSlide({expanded: false, searching: false}, {expanded: true, searching: true}),
			expansionSlide({expanded: true, searching: true}, {expanded: false, searching: false}),
			expansionSlide({expanded: true, searching: true}, {expanded: true, searching: false}),
		]).toStrictEqual([null, null, null]);
	});
});
