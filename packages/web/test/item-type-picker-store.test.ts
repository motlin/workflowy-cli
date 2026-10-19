import {describe, expect, it, vi} from "vite-plus/test";
import {ITEM_TYPES} from "../src/client/layout-types.js";
import type {ItemType} from "../src/client/layout-types.js";
import type {ItemTypeSelectDeps} from "../src/client/item-type-select.js";

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}, removeItem: () => {}});
vi.stubGlobal("innerWidth", 1272);
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
vi.stubGlobal("addEventListener", () => {});

const {useOutlineStore} = await import("../src/client/stores/outline.js");
const {pickerItemTypes, selectItemType, toggleBoardOrTable} = await import("../src/client/item-type-select.js");

function itemType(key: string): ItemType {
	const type = ITEM_TYPES.find((candidate) => candidate.key === key);
	if (type === undefined) {
		throw new Error(`No item type ${key}`);
	}
	return type;
}

interface Calls {
	updates: {nodeId: string; layoutMode: string}[];
	expanded: string[][];
}

function recordingDeps(children: Record<string, string[]>, layoutModes: Record<string, string | null> = {}) {
	const calls: Calls = {updates: [], expanded: []};
	const deps: ItemTypeSelectDeps = {
		update: (nodeId, layoutMode) => {
			calls.updates.push({nodeId, layoutMode});
		},
		expandAll: (ids) => {
			calls.expanded.push([...ids]);
		},
		childIds: (nodeId) => children[nodeId] ?? [],
		layoutMode: (nodeId) => layoutModes[nodeId] ?? null,
	};
	return {calls, deps};
}

describe("item type picker store", () => {
	it("stores the picker's nodes and position, and clears it on hide", () => {
		expect(useOutlineStore.getState().itemTypePicker).toBeNull();
		useOutlineStore.getState().showItemTypePicker({nodeIds: ["alice"], position: {top: 46, left: 1131}});
		expect(useOutlineStore.getState().itemTypePicker).toStrictEqual({
			nodeIds: ["alice"],
			position: {top: 46, left: 1131},
		});
		useOutlineStore.getState().hideItemTypePicker();
		expect(useOutlineStore.getState().itemTypePicker).toBeNull();
	});
});

describe("pickerItemTypes", () => {
	it("offers only Bullets and Board at Home, and all twelve types elsewhere", () => {
		expect(pickerItemTypes(["home"]).map((type) => type.label)).toStrictEqual(["Bullets", "Board"]);
		expect(pickerItemTypes(["alice"])).toStrictEqual(ITEM_TYPES);
	});
});

describe("selectItemType", () => {
	it("writes Board and expands every child of the node", () => {
		const {calls, deps} = recordingDeps({alice: ["bob", "carol"]});
		selectItemType(itemType("board"), ["alice"], deps);
		expect(calls).toStrictEqual({
			updates: [{nodeId: "alice", layoutMode: "board"}],
			expanded: [["bob", "carol"]],
		});
	});

	it("writes Board at Home through the home node id", () => {
		const {calls, deps} = recordingDeps({home: ["r1"]});
		selectItemType(itemType("board"), ["home"], deps);
		expect(calls).toStrictEqual({
			updates: [{nodeId: "home", layoutMode: "board"}],
			expanded: [["r1"]],
		});
	});

	it("writes a plain type without expanding", () => {
		const {calls, deps} = recordingDeps({alice: ["bob"]});
		selectItemType(itemType("h2"), ["alice"], deps);
		expect(calls).toStrictEqual({updates: [{nodeId: "alice", layoutMode: "h2"}], expanded: []});
	});

	it("toggles Divider on the first node through the layout toggle plan", () => {
		const on = recordingDeps({});
		selectItemType(itemType("divider"), ["alice", "bob"], on.deps);
		const off = recordingDeps({}, {alice: "divider"});
		selectItemType(itemType("divider"), ["alice"], off.deps);
		expect([on.calls, off.calls]).toStrictEqual([
			{updates: [{nodeId: "alice", layoutMode: "divider"}], expanded: []},
			{updates: [{nodeId: "alice", layoutMode: "bullets"}], expanded: []},
		]);
	});
});

describe("toggleBoardOrTable", () => {
	it("sets Board without toggling off and expands the children", () => {
		const on = recordingDeps({alice: ["bob", "carol"]});
		toggleBoardOrTable("toggle_board", "alice", on.deps);
		const again = recordingDeps({alice: ["bob"]}, {alice: "board"});
		toggleBoardOrTable("toggle_board", "alice", again.deps);
		expect([on.calls, again.calls]).toStrictEqual([
			{updates: [{nodeId: "alice", layoutMode: "board"}], expanded: [["bob", "carol"]]},
			{updates: [{nodeId: "alice", layoutMode: "board"}], expanded: [["bob"]]},
		]);
	});

	it("toggles Table: on expands the rows, off writes bullets", () => {
		const on = recordingDeps({alice: ["bob"]});
		toggleBoardOrTable("toggle_table", "alice", on.deps);
		const off = recordingDeps({alice: ["bob"]}, {alice: "table"});
		toggleBoardOrTable("toggle_table", "alice", off.deps);
		expect([on.calls, off.calls]).toStrictEqual([
			{updates: [{nodeId: "alice", layoutMode: "table"}], expanded: [["bob"]]},
			{updates: [{nodeId: "alice", layoutMode: "bullets"}], expanded: []},
		]);
	});
});
