import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vite-plus/test";
import {ZOOM_MS, zoomAnimationAllowed, zoomOffset, zoomPhases} from "../src/client/zoom-animation.js";

const tw = readFileSync(fileURLToPath(new URL("../src/client/wf-tailwind.css", import.meta.url)), "utf8");

describe("zoom animation", () => {
	it("animates for 200ms", () => {
		expect(ZOOM_MS).toBe(200);
	});

	it("offsets the moving row toward the other row, less the bullet indent and plus the title drop", () => {
		expect(zoomOffset({left: 76, top: 150}, {left: 40, top: 60})).toStrictEqual({dx: -72, dy: -70});
	});

	it("skips on mobile, a board on either side, and reduced motion", () => {
		const base = {mobile: false, board: false, reducedMotion: false};
		expect([
			zoomAnimationAllowed(base),
			zoomAnimationAllowed({...base, mobile: true}),
			zoomAnimationAllowed({...base, board: true}),
			zoomAnimationAllowed({...base, reducedMotion: true}),
		]).toStrictEqual([true, false, false, false]);
	});

	it("zooming in moves the row out by the offset and brings the children in from it", () => {
		expect(zoomPhases(false, {dx: -72, dy: -70})).toStrictEqual({
			row: {from: {opacity: "1", transform: ""}, to: {opacity: "0", transform: "translate(-72px, -70px)"}},
			children: {from: {opacity: "0", transform: "translate(-72px, -70px)"}, to: {opacity: "1", transform: ""}},
			siblings: {from: {opacity: "1", transform: ""}, to: {opacity: "0", transform: ""}},
			title: {from: {opacity: "1", transform: ""}, to: {opacity: "0", transform: ""}},
		});
	});

	it("zooming out brings the row back from the offset and sends the children out to it", () => {
		expect(zoomPhases(true, {dx: 10, dy: 20})).toStrictEqual({
			row: {from: {opacity: "0", transform: "translate(10px, 20px)"}, to: {opacity: "1", transform: ""}},
			children: {from: {opacity: "1", transform: ""}, to: {opacity: "0", transform: "translate(10px, 20px)"}},
			siblings: {from: {opacity: "0", transform: ""}, to: {opacity: "1", transform: ""}},
			title: {from: {opacity: "0", transform: ""}, to: {opacity: "1", transform: ""}},
		});
	});

	it("keeps upstream's zooming utility rules verbatim", () => {
		expect([
			tw.includes(
				".item--zooming-in-progress .\\[\\.item--zooming-in-progress_\\&\\]\\:hidden {\n  display: none\n}",
			),
			tw.includes(
				".item--zooming-in-progress .\\[\\.item--zooming-in-progress_\\&\\]\\:border-l-transparent {\n  border-left-color: transparent\n}",
			),
		]).toStrictEqual([true, true]);
	});
});
