import {describe, expect, it, vi} from "vite-plus/test";
import {derive, historyStep, initialNavState, navReducer, useNavHistoryStore} from "../src/client/nav-history.js";
import type {NavState} from "../src/client/nav-history.js";

function pushAll(paths: string[]): NavState {
	return paths.reduce((state, path) => navReducer(state, {type: "push", path}), initialNavState);
}

describe("navReducer", () => {
	it("starts empty with nothing to go back or forward to", () => {
		expect({state: initialNavState, derived: derive(initialNavState)}).toStrictEqual({
			state: {stack: [], index: -1},
			derived: {canGoBack: false, canGoForward: false},
		});
	});

	it("push appends and enables back only", () => {
		const state = pushAll(["/a", "/b"]);
		expect({state, derived: derive(state)}).toStrictEqual({
			state: {stack: ["/a", "/b"], index: 1},
			derived: {canGoBack: true, canGoForward: false},
		});
	});

	it("pop moves to the matching entry in either direction", () => {
		const back = navReducer(pushAll(["/a", "/b"]), {type: "pop", path: "/a"});
		const forward = navReducer(back, {type: "pop", path: "/b"});
		expect({back: derive(back), forward: derive(forward), forwardState: forward}).toStrictEqual({
			back: {canGoBack: false, canGoForward: true},
			forward: {canGoBack: true, canGoForward: false},
			forwardState: {stack: ["/a", "/b"], index: 1},
		});
	});

	it("push after pop truncates forward entries", () => {
		const back = navReducer(pushAll(["/a", "/b"]), {type: "pop", path: "/a"});
		const state = navReducer(back, {type: "push", path: "/c"});
		expect({state, derived: derive(state)}).toStrictEqual({
			state: {stack: ["/a", "/c"], index: 1},
			derived: {canGoBack: true, canGoForward: false},
		});
	});

	it("pop with duplicate paths picks the entry nearest the current index", () => {
		const state = navReducer(pushAll(["/a", "/b", "/a", "/b"]), {type: "pop", path: "/a"});
		expect(state).toStrictEqual({stack: ["/a", "/b", "/a", "/b"], index: 2});
	});

	it("pop prefers the history.state idx when it names the same path", () => {
		const state = navReducer(pushAll(["/a", "/b", "/a", "/b"]), {type: "pop", path: "/a", idx: 0});
		expect(state).toStrictEqual({stack: ["/a", "/b", "/a", "/b"], index: 0});
	});

	it("pop to an unknown path falls back to the history.state idx", () => {
		const state = navReducer(pushAll(["/a", "/b"]), {type: "pop", path: "/z", idx: 0});
		expect(state).toStrictEqual({stack: ["/a", "/b"], index: 0});
	});

	it("pop to an unknown path without an idx leaves the state unchanged", () => {
		const before = pushAll(["/a", "/b"]);
		expect(navReducer(before, {type: "pop", path: "/z"})).toBe(before);
	});
});

describe("historyStep", () => {
	function fakeHistory() {
		return {back: vi.fn<() => void>(), forward: vi.fn<() => void>()};
	}

	function calls(history: ReturnType<typeof fakeHistory>) {
		return {back: history.back.mock.calls.length, forward: history.forward.mock.calls.length};
	}

	it("does nothing on an empty stack", () => {
		useNavHistoryStore.setState(initialNavState);
		const history = fakeHistory();
		historyStep(-1, history);
		historyStep(1, history);
		expect(calls(history)).toStrictEqual({back: 0, forward: 0});
	});

	it("steps only in directions the stack allows", () => {
		useNavHistoryStore.setState(navReducer(pushAll(["/a", "/b", "/c"]), {type: "pop", path: "/b"}));
		const history = fakeHistory();
		historyStep(-1, history);
		historyStep(1, history);
		expect(calls(history)).toStrictEqual({back: 1, forward: 1});
	});

	it("dispatch updates the store through the reducer", () => {
		useNavHistoryStore.setState(initialNavState);
		useNavHistoryStore.getState().dispatch({type: "push", path: "/a"});
		useNavHistoryStore.getState().dispatch({type: "push", path: "/b"});
		const {stack, index} = useNavHistoryStore.getState();
		expect({stack, index}).toStrictEqual({stack: ["/a", "/b"], index: 1});
	});
});
