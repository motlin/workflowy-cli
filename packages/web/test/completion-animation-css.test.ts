import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vite-plus/test";
import {cssBlock} from "./helpers/css-block.js";

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");

describe("completion slideUp CSS", () => {
	it("contains upstream's slideUp declarations on .project.completing-slide-up", () => {
		expect(cssBlock(styles, ".project.completing-slide-up")).toStrictEqual({
			"transform-origin": "0 0",
			"will-change": "transform, opacity",
			transition: "opacity 120ms, transform 120ms",
			opacity: "0",
			transform: "scale(0.2, 0)",
		});
	});
});
