import {beforeEach, describe, expect, it, vi} from "vite-plus/test";

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}});
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
vi.stubGlobal("addEventListener", () => {});

const {goToNode, navigateToSearch, nodeUrl, planZoomFocus, resolveZoomTarget, stepNav, syncNavLocation} =
	await import("../src/client/navigation.js");
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

describe("planZoomFocus", () => {
	const ZOOMED = "11111111-1111-4111-8111-111111111111";
	const CURRENT = "22222222-2222-4222-8222-222222222222";
	const CHILD = "33333333-3333-4333-8333-333333333333";
	const PARENT = "44444444-4444-4444-8444-444444444444";

	it("zooms into the edited row and edits its first visible child", () => {
		expect(
			planZoomFocus("in", {zoomedId: ZOOMED, currentId: CURRENT, firstChildId: CHILD, parentOfZoomed: PARENT}),
		).toStrictEqual({route: nodeUrl(CURRENT), editId: CHILD});
	});

	it("zooms into a childless edited row and edits nothing", () => {
		expect(
			planZoomFocus("in", {zoomedId: ZOOMED, currentId: CURRENT, firstChildId: null, parentOfZoomed: PARENT}),
		).toStrictEqual({route: nodeUrl(CURRENT), editId: null});
	});

	it("does nothing when zooming in on the zoomed title or with no edited row", () => {
		expect({
			title: planZoomFocus("in", {
				zoomedId: ZOOMED,
				currentId: ZOOMED,
				firstChildId: CHILD,
				parentOfZoomed: PARENT,
			}),
			none: planZoomFocus("in", {zoomedId: ZOOMED, currentId: null, firstChildId: null, parentOfZoomed: PARENT}),
		}).toStrictEqual({title: null, none: null});
	});

	it("zooms out to the parent and edits the node it zoomed out of", () => {
		expect({
			parent: planZoomFocus("out", {
				zoomedId: ZOOMED,
				currentId: CURRENT,
				firstChildId: null,
				parentOfZoomed: PARENT,
			}),
			home: planZoomFocus("out", {zoomedId: ZOOMED, currentId: null, firstChildId: null, parentOfZoomed: null}),
		}).toStrictEqual({
			parent: {route: nodeUrl(PARENT), editId: ZOOMED},
			home: {route: "/", editId: ZOOMED},
		});
	});

	it("does nothing when zooming out at the root", () => {
		expect(
			planZoomFocus("out", {zoomedId: null, currentId: CURRENT, firstChildId: null, parentOfZoomed: null}),
		).toBeNull();
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

describe("navigateToSearch", () => {
	beforeEach(() => {
		useOutlineStore.setState({nav: initialNavState, zoomedNodeId: FULL_ID, urlSearchQuery: null});
	});

	it("pushes the zoomed node's URL with ?q= and records a non-deduped navigation", () => {
		const navigate = vi.fn<(to: string) => void>();
		goToNode(navigate, FULL_ID);
		navigateToSearch(navigate, "x");
		expect({urls: navigate.mock.calls, nav: useOutlineStore.getState().nav}).toStrictEqual({
			urls: [["/#/35035d443bf1"], ["/#/35035d443bf1?q=x"]],
			nav: {
				current: {id: "35035d443bf1", query: "x"},
				back: [{id: "35035d443bf1", query: null}],
				forward: [],
			},
		});
	});

	it("searches from home without an id", () => {
		useOutlineStore.setState({zoomedNodeId: null});
		const navigate = vi.fn<(to: string) => void>();
		navigateToSearch(navigate, "a b");
		expect({urls: navigate.mock.calls, current: useOutlineStore.getState().nav.current}).toStrictEqual({
			urls: [["/#?q=a%20b"]],
			current: {id: null, query: "a b"},
		});
	});

	it("an empty query clears the search back to the bare node URL", () => {
		const navigate = vi.fn<(to: string) => void>();
		navigateToSearch(navigate, "");
		expect({urls: navigate.mock.calls, current: useOutlineStore.getState().nav.current}).toStrictEqual({
			urls: [["/#/35035d443bf1"]],
			current: {id: "35035d443bf1", query: null},
		});
	});
});

describe("urlSearchQuery", () => {
	it("starts null and is set through setUrlSearchQuery", () => {
		useOutlineStore.setState({urlSearchQuery: null});
		const initial = useOutlineStore.getState().urlSearchQuery;
		useOutlineStore.getState().setUrlSearchQuery("x");
		expect({initial, after: useOutlineStore.getState().urlSearchQuery}).toStrictEqual({initial: null, after: "x"});
	});
});
