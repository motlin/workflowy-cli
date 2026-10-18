import {describe, expect, it} from "vite-plus/test";
import {menuKeyboard} from "../src/client/components/flyout/menu-keyboard.js";
import type {
	MenuKeyboardEvent,
	MenuKeyboardOptions,
	MenuKeyboardResult,
	MenuKeyboardState,
} from "../src/client/components/flyout/menu-keyboard.js";

const fresh: MenuKeyboardState = {index: -1, hidden: false, keyboardMode: false};
const at = (index: number): MenuKeyboardState => ({index, hidden: false, keyboardMode: true});
const defaults: MenuKeyboardOptions = {count: 3, cyclic: false, selectOnTab: true, stopPropagation: false};
const key = (k: string, extra: Partial<MenuKeyboardEvent> = {}): MenuKeyboardEvent => ({
	key: k,
	ctrlKey: false,
	shiftKey: false,
	composing: false,
	...extra,
});
const moved = (state: MenuKeyboardState, stopImmediate = false): MenuKeyboardResult => ({
	state,
	action: "move",
	preventDefault: true,
	stopImmediate,
});
const selected = (state: MenuKeyboardState, preventDefault = true, stopImmediate = false): MenuKeyboardResult => ({
	state,
	action: "select",
	preventDefault,
	stopImmediate,
});
const none = (state: MenuKeyboardState, preventDefault = false, stopImmediate = false): MenuKeyboardResult => ({
	state,
	action: "none",
	preventDefault,
	stopImmediate,
});

const cases: [string, MenuKeyboardState, MenuKeyboardEvent, Partial<MenuKeyboardOptions>, MenuKeyboardResult][] = [
	["ArrowDown from -1 selects the first item", fresh, key("ArrowDown"), {}, moved(at(0))],
	["Ctrl+N from -1 selects the first item", fresh, key("n", {ctrlKey: true}), {}, moved(at(0))],
	["ArrowDown advances", at(0), key("ArrowDown"), {}, moved(at(1))],
	["ArrowDown clamps at the last item", at(2), key("ArrowDown"), {}, moved(at(2))],
	["cyclic ArrowDown wraps to the first item", at(2), key("ArrowDown"), {cyclic: true}, moved(at(0))],
	["ArrowUp from -1 selects the last item", fresh, key("ArrowUp"), {}, moved(at(2))],
	["Ctrl+P from -1 selects the last item", fresh, key("p", {ctrlKey: true}), {}, moved(at(2))],
	["ArrowUp moves back", at(2), key("ArrowUp"), {}, moved(at(1))],
	[
		"ArrowUp below 0 hides the selection",
		at(0),
		key("ArrowUp"),
		{},
		moved({index: -1, hidden: true, keyboardMode: false}),
	],
	["cyclic ArrowUp wraps to the last item", at(0), key("ArrowUp"), {cyclic: true}, moved(at(2))],
	["count 0 ArrowDown highlights nothing (index 0 of no items)", fresh, key("ArrowDown"), {count: 0}, moved(at(0))],
	[
		"count 0 ArrowUp from -1 hides",
		fresh,
		key("ArrowUp"),
		{count: 0},
		moved({index: -1, hidden: true, keyboardMode: true}),
	],
	[
		"stopPropagation stops arrows when an item is selected",
		at(0),
		key("ArrowDown"),
		{stopPropagation: true},
		moved(at(1), true),
	],
	["stopPropagation does not stop arrows from -1", fresh, key("ArrowDown"), {stopPropagation: true}, moved(at(0))],
	[
		"stopPropagation does not stop arrows while hidden",
		{index: 1, hidden: true, keyboardMode: true},
		key("ArrowDown"),
		{stopPropagation: true},
		moved(at(2)),
	],
	["Ctrl+other key does nothing", at(0), key("ArrowDown", {ctrlKey: true}), {}, none(at(0))],
	["composing ignores ArrowDown", at(0), key("ArrowDown", {composing: true}), {}, none(at(0))],
	["composing ignores ArrowUp", at(1), key("ArrowUp", {composing: true}), {}, none(at(1))],
	["Enter selects the current index", at(1), key("Enter"), {}, selected(at(1))],
	["Enter stops propagation when asked", at(1), key("Enter"), {stopPropagation: true}, selected(at(1), true, true)],
	["Enter at -1 does nothing", fresh, key("Enter"), {}, none(fresh)],
	["composing ignores Enter", at(1), key("Enter", {composing: true}), {}, none(at(1))],
	["Tab selects by default", at(1), key("Tab"), {}, selected(at(1))],
	["Tab at -1 prevents default but selects nothing", fresh, key("Tab"), {}, none(fresh, true)],
	["Tab without selectOnTab moves down", at(0), key("Tab"), {selectOnTab: false}, moved(at(1))],
	["Shift+Tab without selectOnTab moves up", at(1), key("Tab", {shiftKey: true}), {selectOnTab: false}, moved(at(0))],
	[
		"Tab without selectOnTab stops propagation whenever asked",
		fresh,
		key("Tab"),
		{selectOnTab: false, stopPropagation: true},
		moved(at(0), true),
	],
	["composing ignores Tab", at(1), key("Tab", {composing: true}), {}, none(at(1))],
	["other keys do nothing", at(1), key("a"), {}, none(at(1))],
];

describe("menuKeyboard", () => {
	it.each(cases)("%s", (_name, state, event, opts, expected) => {
		expect(menuKeyboard(state, event, {...defaults, ...opts})).toStrictEqual(expected);
	});
});
