import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vite-plus/test";
import {cssBlock} from "./helpers/css-block.js";

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8").replaceAll(
	/\/\*[\s\S]*?\*\//gu,
	"",
);

const preludes = (styles.match(/[^{}]+(?=\{)/gu) ?? []).map((prelude) => prelude.trim());

describe("add-child button styles", () => {
	it("drops the legacy container and keeps only upstream's svg sizing rule", () => {
		expect({
			legacyContainer: preludes.filter((prelude) => prelude.includes(".add-button-container")),
			addChildSelectors: preludes.filter((prelude) => prelude.includes(".addChildButton")),
			svg: cssBlock(styles, ".addChildButton svg"),
		}).toStrictEqual({
			legacyContainer: [],
			addChildSelectors: [".addChildButton svg"],
			svg: {width: "14px", height: "16px"},
		});
	});
});
