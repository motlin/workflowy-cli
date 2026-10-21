import {describe, expect, it} from "vite-plus/test";
import {
	createPaneId,
	decodePanes,
	decodeSidePane,
	encodePanes,
	encodeSidePane,
	paneRuntimeState,
	reconcilePaneUrl,
	restoredActivePane,
	sameSidePane,
	withPanesFragment,
} from "../src/client/pane-url.js";

const MAIN = "AAAAAAAAAAA";
const SIDE = "BBBBBBBBBBB";

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

describe("encodeSidePane / decodeSidePane", () => {
	it("encodes the side pane zoom as its short id", () => {
		const encoded = encodeSidePane({
			mainPaneId: MAIN,
			paneId: SIDE,
			location: "4823cefa-5fc0-478c-88ac-35035d443bf1",
		});
		expect(decodePanes(encoded)).toStrictEqual({
			kind: "valid",
			state: [
				[MAIN, "item-tree"],
				[SIDE, "item-tree", ["35035d443bf1"]],
			],
		});
	});

	it("encodes a Home zoom as upstream's None", () => {
		const encoded = encodeSidePane({mainPaneId: MAIN, paneId: SIDE, location: null});
		expect(decodePanes(encoded)).toStrictEqual({
			kind: "valid",
			state: [
				[MAIN, "item-tree"],
				[SIDE, "item-tree", ["None"]],
			],
		});
	});

	it("decodes the first extra item-tree pane, with None as Home and an optional query", () => {
		const home = encodePanes([
			[MAIN, "item-tree"],
			[SIDE, "item-tree", ["None"]],
		]);
		const item = encodePanes([
			[MAIN, "item-tree"],
			[SIDE, "item-tree", ["35035d443bf1", "todo"]],
		]);
		expect({home: decodeSidePane(home), item: decodeSidePane(item)}).toStrictEqual({
			home: {mainPaneId: MAIN, paneId: SIDE, location: null, query: null},
			item: {mainPaneId: MAIN, paneId: SIDE, location: "35035d443bf1", query: "todo"},
		});
	});

	it.each([
		["absent", undefined],
		["invalid", "v2."],
		["main pane only", encodePanes([[MAIN, "item-tree"]])],
		[
			"an unknown pane type",
			encodePanes([
				[MAIN, "item-tree"],
				[SIDE, "board", ["None"]],
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
		expect(decodeSidePane(value)).toBeNull();
	});
});

describe("sameSidePane", () => {
	it("compares pane ids and the zoom's short id", () => {
		const a = {mainPaneId: MAIN, paneId: SIDE, location: "4823cefa-5fc0-478c-88ac-35035d443bf1"};
		expect({
			same: sameSidePane(a, {mainPaneId: MAIN, paneId: SIDE, location: "35035d443bf1"}),
			otherZoom: sameSidePane(a, {mainPaneId: MAIN, paneId: SIDE, location: null}),
			otherId: sameSidePane(a, {mainPaneId: MAIN, paneId: "CCCCCCCCCCC", location: "35035d443bf1"}),
			bothNull: sameSidePane(null, null),
			oneNull: sameSidePane(a, null),
		}).toStrictEqual({same: true, otherZoom: false, otherId: false, bothNull: true, oneNull: false});
	});
});

describe("reconcilePaneUrl", () => {
	const pane = {mainPaneId: MAIN, paneId: SIDE, location: "35035d443bf1"};

	it.each([
		["nothing anywhere", null, null, false, "none"],
		["URL and store agree", pane, pane, false, "none"],
		["the URL names a pane the store lacks (reload)", pane, null, true, "apply"],
		["the URL names another zoom (Back)", {...pane, location: null}, pane, true, "apply"],
		["Back reaches an entry without panes", null, pane, true, "close"],
		["an in-app link drops the param while the pane is open", null, pane, false, "restore-url"],
	] as const)("%s", (_label, url, store, isPop, expected) => {
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

describe("paneRuntimeState / restoredActivePane", () => {
	it("persists the active pane and both panes at half width, like pane-workspace-runtime:v1", () => {
		expect(paneRuntimeState({mainPaneId: MAIN, paneId: SIDE}, true)).toStrictEqual({
			activePaneId: SIDE,
			panes: [
				{id: MAIN, type: "item-tree", widthPercent: 50},
				{id: SIDE, type: "item-tree", widthPercent: 50},
			],
		});
	});

	it("persists the main pane as active", () => {
		expect(paneRuntimeState({mainPaneId: MAIN, paneId: SIDE}, false).activePaneId).toBe(MAIN);
	});

	it("restores the side pane as active only when the stored state names the URL's panes", () => {
		const ids = {mainPaneId: MAIN, paneId: SIDE};
		const stored = JSON.stringify(paneRuntimeState(ids, true));
		expect({
			match: restoredActivePane(stored, ids),
			mainActive: restoredActivePane(JSON.stringify(paneRuntimeState(ids, false)), ids),
			otherPanes: restoredActivePane(stored, {mainPaneId: MAIN, paneId: "CCCCCCCCCCC"}),
			missing: restoredActivePane(null, ids),
			garbage: restoredActivePane("{", ids),
		}).toStrictEqual({match: true, mainActive: false, otherPanes: false, missing: false, garbage: false});
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
