import {describe, expect, it} from "vite-plus/test";
import {restorableCaret} from "../src/client/pane-caret.js";

const saved = {nodeId: "n1", field: "name" as const, offset: 4, zoomedId: "root"};

describe("restorableCaret", () => {
	it("restores a caret on a row still shown in the pane's zoom", () => {
		expect(restorableCaret(saved, {zoomedId: "root", visibleIds: ["n0", "n1"]})).toStrictEqual(saved);
	});

	it("restores a caret on the zoomed title", () => {
		const title = {...saved, nodeId: "root"};
		expect(restorableCaret(title, {zoomedId: "root", visibleIds: ["n0"]})).toStrictEqual(title);
	});

	it("falls back when nothing was saved, the row is gone, or the pane zoomed elsewhere since", () => {
		expect({
			none: restorableCaret(undefined, {zoomedId: "root", visibleIds: ["n1"]}),
			gone: restorableCaret(saved, {zoomedId: "root", visibleIds: ["n0"]}),
			rezoomed: restorableCaret(saved, {zoomedId: "other", visibleIds: ["n1"]}),
		}).toStrictEqual({none: null, gone: null, rezoomed: null});
	});
});
