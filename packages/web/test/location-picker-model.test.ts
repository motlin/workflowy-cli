import {describe, expect, it} from "vite-plus/test";
import {buildPickerRows, firstEnabledIndex, reducePicker} from "../src/client/location-picker-model.js";
import type {PickerRow, PickerState} from "../src/client/location-picker-model.js";

const NAMES: Record<string, string> = {hub: "Qzpick Hub", cal: "📆 Calendar", mover: "Mover"};

function labelOf(id: string): string {
	return NAMES[id] ?? id;
}

function results(count: number): {id: string; labelHtml: string}[] {
	return Array.from({length: count}, (_, i) => ({id: `r${i + 1}`, labelHtml: `<b><u>Qzpick</u></b> ${i + 1}`}));
}

function resultRow(i: number): PickerRow {
	return {kind: "result", id: `r${i}`, labelHtml: `<b><u>Qzpick</u></b> ${i}`, disabled: false, icon: null};
}

function createRows(query: string, disabled: boolean): PickerRow[] {
	return [
		{
			kind: "create-default",
			labelHtml: `New "${query}" in: <b>Qzpick Hub</b>`,
			disabled,
			icon: "plus",
		},
		{kind: "create-elsewhere", labelHtml: `New "${query}" in…`, disabled, icon: "arrow-up"},
	];
}

const BASE = {
	results: [],
	recentIds: [],
	starredIds: [],
	forItemId: "mover",
	expanded: false,
	recentLabel: "Qzpick Hub",
	labelOf,
};

describe("buildPickerRows", () => {
	it("cuts a query's results to 5, adds More results and two enabled create rows", () => {
		expect(buildPickerRows({...BASE, query: "qzpick", results: results(9)})).toStrictEqual([
			resultRow(1),
			resultRow(2),
			resultRow(3),
			resultRow(4),
			resultRow(5),
			{kind: "more", labelHtml: "More results", disabled: false, icon: "ellipsis"},
			...createRows("qzpick", false),
		]);
	});

	it("shows every result without More results once expanded", () => {
		expect(buildPickerRows({...BASE, query: "qzpick", results: results(9), expanded: true})).toStrictEqual([
			...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(resultRow),
			...createRows("qzpick", false),
		]);
	});

	it("drops forItem from results but keeps exactly 5 without More results", () => {
		const five = [{id: "mover", labelHtml: "Mover"}, ...results(5)];
		expect(buildPickerRows({...BASE, query: "qzpick", results: five})).toStrictEqual([
			...[1, 2, 3, 4, 5].map(resultRow),
			...createRows("qzpick", false),
		]);
	});

	it("lists recent then unlisted starred rows and disabled create rows for an empty query", () => {
		expect(
			buildPickerRows({
				...BASE,
				query: "",
				recentIds: ["hub", "mover", "hub"],
				starredIds: ["cal", "hub", "mover"],
			}),
		).toStrictEqual([
			{kind: "recent", id: "hub", labelHtml: "Qzpick Hub", disabled: false, icon: "clock"},
			{kind: "starred", id: "cal", labelHtml: "📆 Calendar", disabled: false, icon: "star"},
			...createRows("", true),
		]);
	});

	it("shows the help row and enabled create rows when nothing matches", () => {
		const rows = buildPickerRows({...BASE, query: "zq", results: []});
		expect(rows).toStrictEqual([
			{kind: "help", labelHtml: "No matching locations found", disabled: true, icon: null},
			...createRows("zq", false),
		]);
		expect(firstEnabledIndex(rows)).toBe(1);
	});

	it("HTML-escapes the query in the create labels", () => {
		const rows = buildPickerRows({...BASE, query: `<a&"b>`, results: []});
		expect(rows.slice(1).map((row) => row.labelHtml)).toStrictEqual([
			`New "&lt;a&amp;&quot;b&gt;" in: <b>Qzpick Hub</b>`,
			`New "&lt;a&amp;&quot;b&gt;" in…`,
		]);
	});

	it("omits the create rows when the searcher has no action", () => {
		expect(buildPickerRows({...BASE, query: "qzpick", results: results(1), action: false})).toStrictEqual([
			resultRow(1),
		]);
	});
});

describe("firstEnabledIndex", () => {
	it("is -1 when every row is disabled", () => {
		expect(firstEnabledIndex(buildPickerRows({...BASE, query: ""}))).toBe(-1);
	});
});

const STEP1: PickerState = {step: 1, query: "qzpick", expanded: false, active: 0, name: ""};

describe("reducePicker", () => {
	const rows = buildPickerRows({...BASE, query: "qzpick", results: results(9)});

	it("selects the active row on Tab, Shift+Tab and Enter", () => {
		const state = {...STEP1, active: 1};
		const expected = {state, effect: {type: "action", id: "r2"}};
		expect(reducePicker(state, {type: "key", key: "Tab"}, rows)).toStrictEqual(expected);
		expect(reducePicker(state, {type: "key", key: "Tab", shiftKey: true}, rows)).toStrictEqual(expected);
		expect(reducePicker(state, {type: "key", key: "Enter"}, rows)).toStrictEqual(expected);
	});

	it("does nothing on Enter when no row is active", () => {
		const state = {...STEP1, query: "", active: -1};
		expect(reducePicker(state, {type: "key", key: "Enter"}, buildPickerRows({...BASE, query: ""}))).toStrictEqual({
			state,
			effect: {type: "none"},
		});
	});

	it("indexes enabled rows only, skipping the disabled help row", () => {
		const helpRows = buildPickerRows({...BASE, query: "zq", results: []});
		expect(reducePicker({...STEP1, query: "zq"}, {type: "select", index: 0}, helpRows)).toStrictEqual({
			state: {...STEP1, query: "zq"},
			effect: {type: "sub-action", name: "zq"},
		});
	});

	it("expands on More results and keeps the active index", () => {
		expect(reducePicker(STEP1, {type: "select", index: 5}, rows)).toStrictEqual({
			state: {...STEP1, expanded: true, active: 5},
			effect: {type: "none"},
		});
	});

	it("enters step 2 with the query as the name on create-elsewhere", () => {
		expect(reducePicker(STEP1, {type: "select", index: 7}, rows)).toStrictEqual({
			state: {step: 2, name: "qzpick", query: "", expanded: false, active: 0},
			effect: {type: "none"},
		});
	});

	it("creates under the chosen location in step 2", () => {
		const state: PickerState = {step: 2, name: "qzpick", query: "hub", expanded: false, active: 0};
		const step2Rows = buildPickerRows({
			...BASE,
			query: "hub",
			results: [{id: "hub", labelHtml: "Hub"}],
			action: false,
		});
		expect(reducePicker(state, {type: "key", key: "Enter"}, step2Rows)).toStrictEqual({
			state,
			effect: {type: "sub-action", id: "hub", name: "qzpick"},
		});
	});

	it("resets the active row and collapses on every filter change", () => {
		expect(reducePicker({...STEP1, expanded: true, active: 4}, {type: "query", query: "qz"}, rows)).toStrictEqual({
			state: {...STEP1, query: "qz"},
			effect: {type: "none"},
		});
	});

	it("returns from step 2 to step 1 with an empty query on Escape", () => {
		const state: PickerState = {step: 2, name: "qzpick", query: "hub", expanded: true, active: 2};
		expect(reducePicker(state, {type: "key", key: "Escape"}, rows)).toStrictEqual({
			state: {step: 1, query: "", expanded: false, active: 0, name: ""},
			effect: {type: "none"},
		});
	});

	it("closes on Escape in step 1 and when focus leaves", () => {
		expect(reducePicker(STEP1, {type: "key", key: "Escape"}, rows)).toStrictEqual({
			state: STEP1,
			effect: {type: "close"},
		});
		expect(reducePicker(STEP1, {type: "focus-leave"}, rows)).toStrictEqual({state: STEP1, effect: {type: "close"}});
	});
});
