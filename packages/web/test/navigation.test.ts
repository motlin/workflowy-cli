import {beforeEach, describe, expect, it, vi} from "vite-plus/test";
import type {NodeResponse} from "../src/node-types.js";

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}});
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
vi.stubGlobal("addEventListener", () => {});

const {cleanupEmptyDayOnLeave, goToNode, navigateToSearch, nodeUrl, resolveZoomTarget, stepNav, syncNavLocation} =
	await import("../src/client/navigation.js");
const {useOutlineStore} = await import("../src/client/stores/outline.js");
const {initialNavState} = await import("../src/client/nav-stack.js");
const {encodeSidePane} = await import("../src/client/pane-url.js");

const FULL_ID = "4823cefa-5fc0-478c-88ac-35035d443bf1";

function testNode(id: string, fields: Partial<NodeResponse> = {}): NodeResponse {
	return {
		id,
		parent_id: null,
		name: "",
		note: null,
		priority: 0,
		data: {layoutMode: null},
		createdAt: null,
		modifiedAt: null,
		completedAt: null,
		hasChildren: false,
		...fields,
	};
}

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

describe("goToNode in one frame", () => {
	const A = "aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa";
	const ids = {mainPaneId: "AAAAAAAAAAA", paneId: "BBBBBBBBBBB"};

	beforeEach(() => {
		useOutlineStore.setState({nav: initialNavState, zoomedNodeId: null, sidePane: null, paneUrlIds: null});
	});

	it("zooms the store before pushing the URL, so the outline swaps without waiting for the route", () => {
		const zoomedWhenPushed: (string | null)[] = [];
		goToNode(() => {
			zoomedWhenPushed.push(useOutlineStore.getState().zoomedNodeId);
		}, A);
		expect(zoomedWhenPushed).toStrictEqual([A]);
	});

	it("carries the open side pane's panes param so the pane sync has nothing to restore", () => {
		useOutlineStore.setState({
			sidePane: {zoomedId: null, backLocations: [], forwardLocations: []},
			paneUrlIds: ids,
		});
		const navigate = vi.fn<(to: string) => void>();
		goToNode(navigate, A);
		expect(navigate.mock.calls).toStrictEqual([
			[`/#/aaaaaaaaaaaa?panes=${encodeURIComponent(encodeSidePane({...ids, location: null}) ?? "")}`],
		]);
	});

	it("carries the side pane on an in-app Back", () => {
		goToNode(() => {}, null);
		goToNode(() => {}, A);
		useOutlineStore.setState({
			sidePane: {zoomedId: null, backLocations: [], forwardLocations: []},
			paneUrlIds: ids,
		});
		const navigate = vi.fn<(to: string) => void>();
		stepNav(navigate, "back");
		expect(navigate.mock.calls).toStrictEqual([
			[`/#?panes=${encodeURIComponent(encodeSidePane({...ids, location: null}) ?? "")}`],
		]);
	});

	it("carries the side pane on a search push too", () => {
		useOutlineStore.setState({
			zoomedNodeId: A,
			sidePane: {zoomedId: null, backLocations: [], forwardLocations: []},
			paneUrlIds: ids,
		});
		const navigate = vi.fn<(to: string) => void>();
		navigateToSearch(navigate, "x");
		expect(navigate.mock.calls).toStrictEqual([
			[`/#/aaaaaaaaaaaa?q=x&panes=${encodeURIComponent(encodeSidePane({...ids, location: null}) ?? "")}`],
		]);
	});
});

describe("navigateToSearch", () => {
	beforeEach(() => {
		useOutlineStore.setState({
			nav: initialNavState,
			zoomedNodeId: FULL_ID,
			urlSearchQuery: null,
			sidePane: null,
			paneUrlIds: null,
		});
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

describe("cleanupEmptyDayOnLeave", () => {
	const DAY = "dddddddd-0000-0000-0000-dddddddddddd";
	const CHILD = "cccccccc-0000-0000-0000-cccccccccccc";
	const OTHER = "eeeeeeee-0000-0000-0000-eeeeeeeeeeee";
	const day = testNode(DAY, {
		name: '<time startYear="2026" startMonth="10" startDay="20">Tue, Oct 20, 2026</time>',
		hasChildren: true,
		calendar: {level: "day", dateId: 20_261_020, root: false, foundDates: null, dayPrefix: null},
	});

	function leave(from: NodeResponse | undefined, children: NodeResponse[] | undefined, toId: string | null) {
		const deleteNode = vi.fn<(id: string) => void>();
		cleanupEmptyDayOnLeave(from?.id ?? null, toId, {
			getNode: (id) => (id === from?.id ? from : undefined),
			getChildren: (id) => (id === from?.id ? children : undefined),
			deleteNode,
		});
		return deleteNode.mock.calls;
	}

	it("deletes the lone empty child when leaving a day for a node outside it", () => {
		expect(leave(day, [testNode(CHILD, {parent_id: DAY})], OTHER)).toStrictEqual([[CHILD]]);
	});

	it("deletes the lone empty child when leaving a day for home", () => {
		expect(leave(day, [testNode(CHILD, {parent_id: DAY, note: ""})], null)).toStrictEqual([[CHILD]]);
	});

	it("keeps a lone child that has a name, a note or children", () => {
		expect([
			leave(day, [testNode(CHILD, {name: "x"})], OTHER),
			leave(day, [testNode(CHILD, {note: "x"})], OTHER),
			leave(day, [testNode(CHILD, {hasChildren: true})], OTHER),
		]).toStrictEqual([[], [], []]);
	});

	it("keeps an empty child that has a sibling", () => {
		expect(leave(day, [testNode(CHILD), testNode(OTHER)], OTHER)).toStrictEqual([]);
	});

	it("keeps the child when navigating into it or staying on the day", () => {
		expect([leave(day, [testNode(CHILD)], CHILD), leave(day, [testNode(CHILD)], DAY)]).toStrictEqual([[], []]);
	});

	it("ignores nodes that are not day pages, read-only mirrors and uncached children", () => {
		const month = {...day, calendar: {...day.calendar!, level: "month", dateId: 20_261_000}};
		expect([
			leave(testNode(DAY), [testNode(CHILD)], OTHER),
			leave(month, [testNode(CHILD)], OTHER),
			leave(day, [testNode(CHILD, {isMirror: true})], OTHER),
			leave(day, undefined, OTHER),
			leave(undefined, undefined, OTHER),
		]).toStrictEqual([[], [], [], [], []]);
	});
});
