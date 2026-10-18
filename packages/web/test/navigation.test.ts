import {beforeEach, describe, expect, it, vi} from "vite-plus/test";

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}});
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
vi.stubGlobal("addEventListener", () => {});

const {goToNode, nodeUrl, resolveZoomTarget, stepNav, syncNavLocation} = await import("../src/client/navigation.js");
const {useOutlineStore} = await import("../src/client/stores/outline.js");
const {initialNavState} = await import("../src/client/nav-stack.js");

const FULL_ID = "4823cefa-5fc0-478c-88ac-35035d443bf1";

describe("resolveZoomTarget", () => {
	const lookup = (id: string) => (id === "35035d443bf1" ? FULL_ID : null);

	it("treats a missing id as home", () => {
		expect(resolveZoomTarget(null, lookup)).toBe("home");
	});

	it("returns a full uuid as is", () => {
		expect(resolveZoomTarget(FULL_ID, () => null)).toBe(FULL_ID);
	});

	it("resolves a 12-hex short id through the lookup", () => {
		expect(resolveZoomTarget("35035d443bf1", lookup)).toBe(FULL_ID);
	});

	it("returns null for an unknown short id", () => {
		expect(resolveZoomTarget("ffffffffffff", lookup)).toBeNull();
	});
});

describe("nodeUrl", () => {
	it("routes to the upstream short-id hash URL", () => {
		expect(nodeUrl(FULL_ID)).toBe("/#/35035d443bf1");
	});
});

describe("in-app navigation stacks", () => {
	const A = "aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa";
	const B = "bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb";

	beforeEach(() => {
		useOutlineStore.setState({nav: initialNavState});
	});

	function visitAB() {
		const navigate = vi.fn<(to: string) => void>();
		goToNode(navigate, A);
		goToNode(navigate, B);
		return navigate;
	}

	it("goToNode records the move and pushes the node URL", () => {
		const navigate = visitAB();
		expect({urls: navigate.mock.calls, nav: useOutlineStore.getState().nav}).toStrictEqual({
			urls: [["/#/aaaaaaaaaaaa"], ["/#/bbbbbbbbbbbb"]],
			nav: {current: {id: "bbbbbbbbbbbb", query: null}, back: [{id: "aaaaaaaaaaaa", query: null}], forward: []},
		});
	});

	it("stepNav back pops the stack and pushes a new browser entry", () => {
		visitAB();
		const navigate = vi.fn<(to: string) => void>();
		stepNav(navigate, "back");
		expect({urls: navigate.mock.calls, nav: useOutlineStore.getState().nav}).toStrictEqual({
			urls: [["/#/aaaaaaaaaaaa"]],
			nav: {current: {id: "aaaaaaaaaaaa", query: null}, back: [], forward: [{id: "bbbbbbbbbbbb", query: null}]},
		});
	});

	it("stepNav does nothing when the stack in that direction is empty", () => {
		visitAB();
		const navigate = vi.fn<(to: string) => void>();
		stepNav(navigate, "forward");
		expect(navigate.mock.calls).toStrictEqual([]);
	});

	it("stepNav home goes to the root URL", () => {
		const navigate = vi.fn<(to: string) => void>();
		goToNode(navigate, null);
		goToNode(navigate, A);
		stepNav(navigate, "back");
		expect(navigate.mock.calls.at(-1)).toStrictEqual(["/"]);
	});

	it("syncNavLocation ignores the URL the app just pushed, even in full-uuid form", () => {
		visitAB();
		const before = useOutlineStore.getState().nav;
		syncNavLocation(`#/${B}`, false);
		expect(useOutlineStore.getState().nav).toBe(before);
	});

	it("syncNavLocation records a link click as a navigation and a popstate as current only", () => {
		visitAB();
		syncNavLocation("#/cccccccccccc", false);
		syncNavLocation("#/aaaaaaaaaaaa", true);
		expect(useOutlineStore.getState().nav).toStrictEqual({
			current: {id: "aaaaaaaaaaaa", query: null},
			back: [
				{id: "aaaaaaaaaaaa", query: null},
				{id: "bbbbbbbbbbbb", query: null},
			],
			forward: [],
		});
	});
});
