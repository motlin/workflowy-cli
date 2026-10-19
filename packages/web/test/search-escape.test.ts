import {describe, expect, it} from "vite-plus/test";
import {escapeAction} from "../src/client/search-escape.js";

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
