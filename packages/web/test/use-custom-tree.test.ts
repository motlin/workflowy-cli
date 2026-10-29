import {afterEach, describe, expect, it} from "vite-plus/test";
import {applyCustomTree} from "../src/client/hooks/use-custom-tree.js";
import type {CustomTreeResponse} from "../src/node-types.js";
import {hint} from "../src/client/keys/hint.js";
import {useCustomKeymapStore} from "../src/client/stores/custom-keymap.js";
import {useCustomThemesStore} from "../src/client/stores/custom-themes.js";
import {allThemes} from "../src/client/themes.js";

const node = (name: string, children: CustomTreeResponse["sections"][string] = []) => ({
	name,
	completed: false,
	children,
});

afterEach(() => {
	applyCustomTree({rootId: null, rootChildren: [], sections: {}});
});

describe("applyCustomTree", () => {
	it("makes a custom hotkey the hint, and a missing root restores the default", () => {
		applyCustomTree({
			rootId: "r",
			rootChildren: [],
			sections: {Hotkeys: [node("Hotkeys", [node("alt+z", [node("zoom_in")])])]},
		});
		const custom = hint("zoom_in");
		applyCustomTree({rootId: null, rootChildren: [], sections: {}});
		expect({custom, restored: hint("zoom_in")}).toStrictEqual({custom: "⌥Z", restored: "⌘."});
	});

	it("registers custom themes in the theme list and removes them when the tree goes away", () => {
		applyCustomTree({
			rootId: "r",
			rootChildren: [],
			sections: {
				Themes: [node("Themes", [node("My Theme", [node("main", [node("text-primary", [node("#111")])])])])],
			},
		});
		const names = allThemes().map((theme) => theme.name);
		applyCustomTree({rootId: null, rootChildren: [], sections: {}});
		expect({
			added: names.at(-1),
			after: allThemes().some((theme) => theme.name === "My_Theme"),
			keymap: useCustomKeymapStore.getState().overrides,
			themes: useCustomThemesStore.getState().themes,
		}).toStrictEqual({added: "My_Theme", after: false, keymap: [], themes: []});
	});
});
