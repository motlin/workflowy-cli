import {describe, expect, it} from "vite-plus/test";
import {BACK_STACK_CAP, initialNavState, locFromHash, navReducer} from "../src/client/nav-stack.js";
import type {Loc, NavState} from "../src/client/nav-stack.js";

function loc(id: string | null, query: string | null = null): Loc {
	return {id, query};
}

function navigateAll(ids: string[], from: NavState = initialNavState): NavState {
	return ids.reduce((state, id) => navReducer(state, {type: "navigate", loc: loc(id)}), from);
}

describe("navReducer", () => {
	it("starts with no current location and empty stacks", () => {
		expect(initialNavState).toStrictEqual({current: null, back: [], forward: []});
	});

	it("navigate a, b, c then back moves c to forward", () => {
		const state = navReducer(navigateAll(["a", "b", "c"]), {type: "back"});
		expect(state).toStrictEqual({current: loc("b"), back: [loc("a")], forward: [loc("c")]});
	});

	it("forward mirrors back", () => {
		const back = navReducer(navigateAll(["a", "b", "c"]), {type: "back"});
		expect(navReducer(back, {type: "forward"})).toStrictEqual({
			current: loc("c"),
			back: [loc("a"), loc("b")],
			forward: [],
		});
	});

	it("navigate after back clears forward", () => {
		const back = navReducer(navigateAll(["a", "b", "c"]), {type: "back"});
		expect(navReducer(back, {type: "navigate", loc: loc("d")})).toStrictEqual({
			current: loc("d"),
			back: [loc("a"), loc("b")],
			forward: [],
		});
	});

	it("navigate to the current location returns the same object", () => {
		const state = navigateAll(["a", "b"]);
		expect(navReducer(state, {type: "navigate", loc: loc("b")})).toBe(state);
	});

	it("navigate to the same id with a new query is not deduped", () => {
		const state = navReducer(navigateAll(["a"]), {type: "navigate", loc: loc("a", "x")});
		expect(state).toStrictEqual({current: loc("a", "x"), back: [loc("a")], forward: []});
	});

	it("caps the back stack, dropping the oldest entries", () => {
		const ids = Array.from({length: BACK_STACK_CAP + 2}, (_, i) => `n${i}`);
		const state = navigateAll(ids);
		expect({cap: BACK_STACK_CAP, length: state.back.length, oldest: state.back[0]}).toStrictEqual({
			cap: 100,
			length: 100,
			oldest: loc("n1"),
		});
	});

	it("popstate sets current without touching the stacks", () => {
		const before = navReducer(navigateAll(["a", "b", "c"]), {type: "back"});
		expect(navReducer(before, {type: "popstate", loc: loc("x")})).toStrictEqual({
			current: loc("x"),
			back: [loc("a")],
			forward: [loc("c")],
		});
	});

	it("back and forward on empty stacks return the same object", () => {
		const state = navigateAll(["a"]);
		expect(navReducer(state, {type: "back"})).toBe(state);
		expect(navReducer(state, {type: "forward"})).toBe(state);
	});
});

describe("locFromHash", () => {
	it("keys locations by short id and keeps the query", () => {
		expect({
			home: locFromHash(""),
			full: locFromHash("#/4823cefa-5fc0-478c-88ac-35035d443bf1"),
			query: locFromHash("#/35035d443bf1?q=x"),
		}).toStrictEqual({
			home: loc(null),
			full: loc("35035d443bf1"),
			query: loc("35035d443bf1", "x"),
		});
	});
});
