import {describe, expect, it} from "vite-plus/test";
import {buildPickerRows, firstEnabledIndex} from "../src/client/location-picker-model.js";
import type {PickerRow} from "../src/client/location-picker-model.js";

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
