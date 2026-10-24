import {describe, expect, it} from "vite-plus/test";
import {escapeAction, escapeReturnTarget} from "../src/client/search-escape.js";

describe("escapeAction", () => {
	it("cancels a committed or typed search, blurs an empty focused box, else focuses search", () => {
		expect([
			escapeAction({searchQuery: "a", searchInput: "", inputFocused: false}),
			escapeAction({searchQuery: "", searchInput: "a", inputFocused: true}),
			escapeAction({searchQuery: "", searchInput: "a", inputFocused: false}),
			escapeAction({searchQuery: "", searchInput: "", inputFocused: true}),
			escapeAction({searchQuery: "", searchInput: "", inputFocused: false}),
		]).toStrictEqual(["cancel", "cancel", "cancel", "blur", "focus"]);
	});
});

describe("escapeReturnTarget", () => {
	it("returns to the zoom title at offset 0 when zoomed, else the first visible row", () => {
		expect([
			escapeReturnTarget({zoomedNodeId: "X", firstVisibleId: "A1"}),
			escapeReturnTarget({zoomedNodeId: null, firstVisibleId: "Alpha"}),
			escapeReturnTarget({zoomedNodeId: null, firstVisibleId: undefined}),
		]).toStrictEqual([{id: "X", offset: 0}, {id: "Alpha", offset: 0}, null]);
	});
});
