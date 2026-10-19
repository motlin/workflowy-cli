import {describe, expect, it} from "vite-plus/test";
import type {Star} from "@workflowy/shared";
import type {SwitcherResult} from "../src/server/switcher-search.js";
import {buildSwitcherRows} from "../src/client/switcher-rows.js";
import type {StarredEntry} from "../src/client/switcher-rows.js";

function star(nodeId: string | null, query: string | null = null, name: string | null = null): Star {
	const key = (nodeId ?? "None") + (query ? `_${query}` : "");
	return {key, nodeId, query, name, position: 0};
}

function entry(overrides: Partial<StarredEntry> & {star: Star}): StarredEntry {
	return {name: "", note: "", completed: false, ancestors: [], ...overrides};
}

function result(id: string, labelHtml: string): SwitcherResult {
	return {id, labelHtml, completed: false, starred: false, ancestors: []};
}

const IDLE = {status: "idle", results: []} as const;

describe("buildSwitcherRows", () => {
	it("lists every starred location in the given order for an empty filter", () => {
		const starred = [
			entry({star: star("b"), name: "Beta", ancestors: [{id: "p", name: "Parent"}]}),
			entry({star: star("a", "#todo", "Todos"), name: "Alpha"}),
		];
		expect(buildSwitcherRows(starred, IDLE, "")).toStrictEqual({
			rows: [
				{
					key: "b",
					id: "b",
					nodeId: "b",
					query: null,
					labelHtml: "Beta",
					completed: false,
					starred: true,
					ancestors: [{id: "p", name: "Parent"}],
				},
				{
					key: "a_#todo",
					id: "a",
					nodeId: "a",
					query: "#todo",
					labelHtml: "Todos",
					completed: false,
					starred: true,
					ancestors: [{id: "a", name: "Alpha"}],
				},
			],
			emptyText: null,
			indexing: false,
		});
	});

	it("shows the starred-pages hint with no stars and an empty filter", () => {
		expect(buildSwitcherRows([], IDLE, "")).toStrictEqual({
			rows: [],
			emptyText: "Your starred pages will appear here.",
			indexing: false,
		});
	});

	it("reports a failed search", () => {
		expect(buildSwitcherRows([], {status: "error", results: []}, "qwzx")).toStrictEqual({
			rows: [],
			emptyText: "Search is unavailable right now.",
			indexing: false,
		});
	});

	it("shows the indexing message while the first request is pending", () => {
		expect(buildSwitcherRows([], {status: "pending", results: []}, "qwzx")).toStrictEqual({
			rows: [],
			emptyText: "Indexing your data! One sec …",
			indexing: true,
		});
	});

	it("reports no matches once the search is done", () => {
		expect(buildSwitcherRows([], {status: "done", results: []}, "qwzx")).toStrictEqual({
			rows: [],
			emptyText: "No matches found. Try adjusting your search.",
			indexing: false,
		});
	});

	it("puts matching starred entries first and drops their server duplicates", () => {
		const starred = [entry({star: star("s"), name: "qwzx starred"}), entry({star: star("t"), name: "other"})];
		const server = {
			status: "done",
			results: [result("r", "<b><u>qwzx</u></b> plain"), result("s", "<b><u>qwzx</u></b> starred")],
		} as const;
		expect(buildSwitcherRows(starred, server, "qwzx")).toStrictEqual({
			rows: [
				{
					key: "s",
					id: "s",
					nodeId: "s",
					query: null,
					labelHtml: "<b><u>qwzx</u></b> starred",
					completed: false,
					starred: true,
					ancestors: [],
				},
				{
					key: "r",
					id: "r",
					nodeId: "r",
					query: null,
					labelHtml: "<b><u>qwzx</u></b> plain",
					completed: false,
					starred: false,
					ancestors: [],
				},
			],
			emptyText: null,
			indexing: false,
		});
	});

	it("labels a starred Home page as Home with no crumbs", () => {
		expect(buildSwitcherRows([entry({star: star(null)})], IDLE, "").rows).toStrictEqual([
			{
				key: "None",
				id: "",
				nodeId: null,
				query: null,
				labelHtml: "Home",
				completed: false,
				starred: true,
				ancestors: [],
			},
		]);
	});
});
