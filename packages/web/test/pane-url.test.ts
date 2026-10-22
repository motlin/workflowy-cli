import {describe, expect, it} from "vite-plus/test";
import {
	createPaneId,
	decodePanes,
	decodeWorkspace,
	encodePanes,
	encodeWorkspace,
	paneRuntimeState,
	reconcilePaneUrl,
	restoredRuntime,
	sameWorkspace,
	storeWorkspaceUrl,
	withPanesFragment,
} from "../src/client/pane-url.js";
import type {PaneUrlAction, WorkspaceUrl} from "../src/client/pane-url.js";

const MAIN = "AAAAAAAAAAA";
const SIDE = "BBBBBBBBBBB";
const THIRD = "DDDDDDDDDDD";

function base64url(text: string): string {
	return Buffer.from(text, "utf8").toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

describe("encodePanes", () => {
	it("prefixes v2. to base64url JSON of the pane state, like upstream $92", () => {
		const state = [
			[MAIN, "item-tree"],
			[SIDE, "item-tree", ["35035d443bf1"]],
		];
		expect(encodePanes(state)).toBe(`v2.${base64url(JSON.stringify(state))}`);
	});

	it("encodes non-ASCII search queries as UTF-8", () => {
		const state = [
			[MAIN, "item-tree"],
			[SIDE, "item-tree", ["None", "café ✓"]],
		];
		expect(encodePanes(state)).toBe(`v2.${base64url(JSON.stringify(state))}`);
	});
});

describe("decodePanes", () => {
	it("is absent for a missing value", () => {
		expect(decodePanes(undefined)).toStrictEqual({kind: "absent"});
	});

	it("round-trips an encoded state", () => {
		const state: [string, string, ...unknown[]][] = [
			[MAIN, "item-tree"],
			[SIDE, "item-tree", ["35035d443bf1", "q"]],
		];
		expect(decodePanes(encodePanes(state))).toStrictEqual({kind: "valid", state});
	});

	it.each([
		["no v2. prefix", "v1.W10"],
		["an empty payload", "v2."],
		["non-base64url characters", "v2.ab+c"],
		["an impossible base64 length", "v2.abcde"],
		["non-JSON", `v2.${base64url("{")}`],
		["a non-array", `v2.${base64url("{}")}`],
		["an empty array", `v2.${base64url("[]")}`],
		["a main entry of the wrong length", `v2.${base64url(JSON.stringify([[MAIN]]))}`],
		["a main entry that is not item-tree", `v2.${base64url(JSON.stringify([[MAIN, "board"]]))}`],
		["a malformed main pane id", `v2.${base64url(JSON.stringify([["short", "item-tree"]]))}`],
		[
			"a pane entry of the wrong length",
			`v2.${base64url(
				JSON.stringify([
					[MAIN, "item-tree"],
					[SIDE, "item-tree"],
				]),
			)}`,
		],
		[
			"a malformed pane id",
			`v2.${base64url(
				JSON.stringify([
					[MAIN, "item-tree"],
					["bad!", "item-tree", []],
				]),
			)}`,
		],
		[
			"a duplicate pane id",
			`v2.${base64url(
				JSON.stringify([
					[MAIN, "item-tree"],
					[MAIN, "item-tree", []],
				]),
			)}`,
		],
		[
			"an empty pane type",
			`v2.${base64url(
				JSON.stringify([
					[MAIN, "item-tree"],
					[SIDE, "", []],
				]),
			)}`,
		],
	])("is invalid for %s", (_label, value) => {
		expect(decodePanes(value)).toStrictEqual({kind: "invalid"});
	});

	it("is invalid past upstream's 65536-character cap", () => {
		expect(decodePanes(`v2.${"a".repeat(65_536)}`)).toStrictEqual({kind: "invalid"});
	});
});

describe("encodeWorkspace / decodeWorkspace", () => {
	it("encodes each pane's zoom as its short id, main first", () => {
		const encoded = encodeWorkspace({
			mainPaneId: MAIN,
			panes: [
				{paneId: SIDE, location: "4823cefa-5fc0-478c-88ac-35035d443bf1"},
				{paneId: THIRD, location: "7f3e2a1b9c0d"},
			],
		});
		expect(decodePanes(encoded)).toStrictEqual({
			kind: "valid",
			state: [
				[MAIN, "item-tree"],
				[SIDE, "item-tree", ["35035d443bf1"]],
				[THIRD, "item-tree", ["7f3e2a1b9c0d"]],
			],
		});
	});

	it("encodes a Home zoom as upstream's None", () => {
		const encoded = encodeWorkspace({mainPaneId: MAIN, panes: [{paneId: SIDE, location: null}]});
		expect(decodePanes(encoded)).toStrictEqual({
			kind: "valid",
			state: [
				[MAIN, "item-tree"],
				[SIDE, "item-tree", ["None"]],
			],
		});
	});

	it("writes a pane's search query after its zoom, like upstream's [shortId, searchQuery], leaving empty ones out", () => {
		const encoded = encodeWorkspace({
			mainPaneId: MAIN,
			panes: [
				{paneId: SIDE, location: null, query: "#todo"},
				{paneId: THIRD, location: null, query: ""},
			],
		});
		expect(decodePanes(encoded)).toStrictEqual({
			kind: "valid",
			state: [
				[MAIN, "item-tree"],
				[SIDE, "item-tree", ["None", "#todo"]],
				[THIRD, "item-tree", ["None"]],
			],
		});
	});

	it("decodes every extra item-tree pane, with None as Home and an optional query", () => {
		const value = encodePanes([
			[MAIN, "item-tree"],
			[SIDE, "item-tree", ["None"]],
			[THIRD, "item-tree", ["35035d443bf1", "todo"]],
		]);
		expect(decodeWorkspace(value)).toStrictEqual({
			mainPaneId: MAIN,
			panes: [
				{paneId: SIDE, location: null, query: null},
				{paneId: THIRD, location: "35035d443bf1", query: "todo"},
			],
		});
	});

	it.each([
		["absent", undefined],
		["invalid", "v2."],
		["main pane only", encodePanes([[MAIN, "item-tree"]])],
		[
			"an unknown pane type after a valid pane",
			encodePanes([
				[MAIN, "item-tree"],
				[SIDE, "item-tree", ["None"]],
				[THIRD, "board", ["None"]],
			]),
		],
		[
			"a non-array urlState",
			encodePanes([
				[MAIN, "item-tree"],
				[SIDE, "item-tree", "None"],
			]),
		],
		[
			"a non-string id",
			encodePanes([
				[MAIN, "item-tree"],
				[SIDE, "item-tree", [7]],
			]),
		],
		[
			"a non-string query",
			encodePanes([
				[MAIN, "item-tree"],
				[SIDE, "item-tree", ["None", 7]],
			]),
		],
		[
			"an empty id",
			encodePanes([
				[MAIN, "item-tree"],
				[SIDE, "item-tree", [""]],
			]),
		],
	])("is null for %s", (_label, value) => {
		expect(decodeWorkspace(value)).toBeNull();
	});
});

describe("sameWorkspace", () => {
	const zoomed = {paneId: SIDE, location: "4823cefa-5fc0-478c-88ac-35035d443bf1"};

	it("compares pane ids in order and each zoom's short id", () => {
		const a = {mainPaneId: MAIN, panes: [zoomed, {paneId: THIRD, location: null}]};
		expect({
			same: sameWorkspace(a, {
				mainPaneId: MAIN,
				panes: [
					{paneId: SIDE, location: "35035d443bf1"},
					{paneId: THIRD, location: null},
				],
			}),
			otherZoom: sameWorkspace(a, {
				mainPaneId: MAIN,
				panes: [
					{paneId: SIDE, location: null},
					{paneId: THIRD, location: null},
				],
			}),
			reordered: sameWorkspace(a, {mainPaneId: MAIN, panes: [{paneId: THIRD, location: null}, zoomed]}),
			fewer: sameWorkspace(a, {mainPaneId: MAIN, panes: [zoomed]}),
			otherMain: sameWorkspace(a, {...a, mainPaneId: THIRD}),
			bothNull: sameWorkspace(null, null),
			oneNull: sameWorkspace(a, null),
		}).toStrictEqual({
			same: true,
			otherZoom: false,
			reordered: false,
			fewer: false,
			otherMain: false,
			bothNull: true,
			oneNull: false,
		});
	});

	it("tells pane searches apart, with no query the same as an empty one", () => {
		const a = {paneId: SIDE, location: null};
		const ws = (pane: {paneId: string; location: null; query?: string | null}) => ({
			mainPaneId: MAIN,
			panes: [pane],
		});
		expect({
			otherQuery: sameWorkspace(ws({...a, query: "x"}), ws({...a, query: "y"})),
			addedQuery: sameWorkspace(ws(a), ws({...a, query: "x"})),
			emptyQuery: sameWorkspace(ws({...a, query: null}), ws({...a, query: ""})),
		}).toStrictEqual({otherQuery: false, addedQuery: false, emptyQuery: true});
	});
});

describe("storeWorkspaceUrl", () => {
	it("names every open pane in order with its committed search query", () => {
		expect(
			storeWorkspaceUrl(
				[
					{id: SIDE, zoomedId: "alice", query: "todo"},
					{id: THIRD, zoomedId: null, query: ""},
				],
				MAIN,
			),
		).toStrictEqual({
			mainPaneId: MAIN,
			panes: [
				{paneId: SIDE, location: "alice", query: "todo"},
				{paneId: THIRD, location: null, query: null},
			],
		});
	});

	it("is null with no pane open", () => {
		expect(storeWorkspaceUrl([], null)).toBeNull();
	});
});

describe("reconcilePaneUrl", () => {
	const ws: WorkspaceUrl = {mainPaneId: MAIN, panes: [{paneId: SIDE, location: "35035d443bf1"}]};

	it.each<[string, WorkspaceUrl | null, WorkspaceUrl | null, boolean, PaneUrlAction]>([
		["nothing anywhere", null, null, false, "none"],
		["URL and store agree", ws, ws, false, "none"],
		["the URL names panes the store lacks (reload)", ws, null, true, "apply"],
		[
			"the URL names another zoom (Back)",
			{mainPaneId: MAIN, panes: [{paneId: SIDE, location: null}]},
			ws,
			true,
			"apply",
		],
		[
			"the URL names one more pane (Forward)",
			{mainPaneId: MAIN, panes: [...ws.panes, {paneId: THIRD, location: null}]},
			ws,
			true,
			"apply",
		],
		["Back reaches an entry without panes", null, ws, true, "close"],
		["an in-app link drops the param while panes are open", null, ws, false, "restore-url"],
	])("%s", (_label, url, store, isPop, expected) => {
		expect(reconcilePaneUrl({url, store, isPop})).toBe(expected);
	});
});

describe("createPaneId", () => {
	it("makes an 11-character base64url id from 8 random bytes", () => {
		const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x01, 0x02, 0x03, 0x04]);
		expect(createPaneId(() => bytes)).toBe(Buffer.from(bytes).toString("base64url"));
	});

	it("makes a well-formed id from crypto by default", () => {
		expect(createPaneId()).toMatch(/^[A-Za-z0-9_-]{11}$/u);
	});
});

describe("paneRuntimeState / restoredRuntime", () => {
	it("persists the active pane and each pane's share of the widths, like pane-workspace-runtime:v1", () => {
		expect(paneRuntimeState([MAIN, SIDE], SIDE, [636, 636])).toStrictEqual({
			activePaneId: SIDE,
			panes: [
				{id: MAIN, type: "item-tree", widthPercent: 50},
				{id: SIDE, type: "item-tree", widthPercent: 50},
			],
		});
	});

	it("rounds resized shares like upstream's paneWidthPercent", () => {
		expect(paneRuntimeState([MAIN, SIDE, THIRD], MAIN, [400, 350, 450])).toStrictEqual({
			activePaneId: MAIN,
			panes: [
				{id: MAIN, type: "item-tree", widthPercent: 33.3333},
				{id: SIDE, type: "item-tree", widthPercent: 29.1667},
				{id: THIRD, type: "item-tree", widthPercent: 37.5},
			],
		});
	});

	it("restores the stored active pane and width shares only when the record names every one of the URL's panes", () => {
		const ids = [MAIN, SIDE, THIRD];
		const stored = JSON.stringify(paneRuntimeState(ids, THIRD, [400, 350, 450]));
		expect({
			match: restoredRuntime(stored, ids),
			mainActive: restoredRuntime(JSON.stringify(paneRuntimeState(ids, MAIN, [350, 350, 350])), ids),
			subset: restoredRuntime(stored, [MAIN, THIRD]),
			otherPanes: restoredRuntime(stored, [MAIN, SIDE, "CCCCCCCCCCC"]),
			activeNotInUrl: restoredRuntime(stored, [MAIN, SIDE]),
			missing: restoredRuntime(null, ids),
			garbage: restoredRuntime("{", ids),
		}).toStrictEqual({
			match: {activePaneId: THIRD, widthPercents: [33.3333, 29.1667, 37.5]},
			mainActive: {activePaneId: MAIN, widthPercents: [33.3333, 33.3333, 33.3333]},
			subset: {activePaneId: THIRD, widthPercents: [33.3333, 37.5]},
			otherPanes: null,
			activeNotInUrl: null,
			missing: null,
			garbage: null,
		});
	});

	it("leaves a stored width without a usable share to the fallback width", () => {
		const stored = JSON.stringify({activePaneId: MAIN, panes: [{id: MAIN}, {id: SIDE, widthPercent: "wide"}]});
		expect(restoredRuntime(stored, [MAIN, SIDE])).toStrictEqual({activePaneId: MAIN, widthPercents: [null, null]});
	});
});

describe("withPanesFragment", () => {
	it("sets the panes param after the main location and its query", () => {
		expect(withPanesFragment("#/4823cefa-5fc0-478c-88ac-35035d443bf1?q=x", "v2.abc")).toBe(
			"/#/35035d443bf1?q=x&panes=v2.abc",
		);
	});

	it("sets it at Home", () => {
		expect(withPanesFragment("", "v2.abc")).toBe("/#?panes=v2.abc");
	});

	it("drops the param, keeping other fragments", () => {
		expect(withPanesFragment("#/35035d443bf1?view=board&panes=v2.abc", null)).toBe("/#/35035d443bf1?view=board");
	});

	it("drops it back to plain Home", () => {
		expect(withPanesFragment("#?panes=v2.abc", null)).toBe("/");
	});
});
