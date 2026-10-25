import {describe, expect, it} from "vite-plus/test";
import {peekSwitcherText, rankSwitcher, warmSwitcher} from "../src/server/switcher-search.js";
import type {TreeSearchRow} from "../src/server/tree-search.js";

const NOW_SEC = Date.UTC(2026, 9, 1) / 1000;
const JOINED_SEC = Date.UTC(2017, 6, 14) / 1000;
const MODIFIED_MS = Date.UTC(2026, 8, 30);

function row(
	id: string,
	parentId: string | null,
	priority: number,
	name: string,
	overrides: Partial<TreeSearchRow> = {},
): TreeSearchRow {
	return {
		id,
		parentId,
		priority,
		name,
		note: null,
		createdAt: null,
		modifiedAt: MODIFIED_MS,
		completedAt: null,
		layoutMode: null,
		isMirror: false,
		isBacklink: false,
		...overrides,
	};
}

// The jump-menu sandbox fixture (dumps/jump-menu-live-results.txt):
// 🧪 Sync sandbox > Qwzx parent page > [Qwzx alpha leaf, Qwzx beta parent > [deep qwzxchild, other],
// Unrelated row (note-only match), Qwzxdone task (completed) > qwzx under done, base64 note node]
const ROWS: TreeSearchRow[] = [
	row("sandbox", null, 0, "🧪 Sync sandbox"),
	row("parent", "sandbox", 0, "Qwzx parent page"),
	row("alpha", "parent", 0, "Qwzx alpha leaf"),
	row("beta", "parent", 1, "Qwzx beta parent"),
	row("deep", "beta", 0, "deep qwzxchild"),
	row("other", "beta", 1, "other"),
	row("unrelated", "parent", 2, "Unrelated row", {note: "qwzx in note only"}),
	row("done", "parent", 3, "Qwzxdone task", {completedAt: MODIFIED_MS}),
	row("underDone", "done", 0, "qwzx under done"),
	row("base64", "sandbox", 1, "Attachment", {note: "aGVsbG8+QwzpYXI/parZm9vqwzxbar"}),
];

function rank(query: string, options: {limit?: number; offset?: number; starredIds?: string[]} = {}) {
	return rankSwitcher(ROWS, query, options.starredIds ?? [], NOW_SEC, {
		joinedSec: JOINED_SEC,
		limit: options.limit,
		offset: options.offset,
	});
}

describe("rankSwitcher", () => {
	it("ranks the qwzx fixture like upstream, dropping completed subtrees and non-word-start note hits", () => {
		const {results, hasMore} = rank("qwzx");
		expect({names: results.map((result) => result.id), hasMore}).toStrictEqual({
			names: ["parent", "beta", "alpha", "deep", "unrelated"],
			hasMore: false,
		});
	});

	it("answers each result with highlighted label, flags and root-first ancestors without Home", () => {
		const {results} = rank("qwzx");
		expect(results.find((result) => result.id === "deep")).toStrictEqual({
			id: "deep",
			labelHtml: "deep <b><u>qwzx</u></b>child",
			completed: false,
			starred: false,
			ancestors: [
				{id: "sandbox", name: "🧪 Sync sandbox"},
				{id: "parent", name: "Qwzx parent page"},
				{id: "beta", name: "Qwzx beta parent"},
			],
		});
		expect(results.find((result) => result.id === "unrelated")?.labelHtml).toBe("Unrelated row");
	});

	it("pages with offset and limit and reports hasMore", () => {
		expect(rank("qwzx", {limit: 2})).toStrictEqual({
			results: [expect.objectContaining({id: "parent"}), expect.objectContaining({id: "beta"})],
			hasMore: true,
		});
		const page = rank("qwzx", {offset: 4, limit: 2});
		expect({ids: page.results.map((result) => result.id), hasMore: page.hasMore}).toStrictEqual({
			ids: ["unrelated"],
			hasMore: false,
		});
	});

	it("multiplies a starred node's score by 20 and flags it", () => {
		const {results} = rank("qwzx", {starredIds: ["deep"]});
		expect(results.slice(0, 2).map((result) => [result.id, result.starred])).toStrictEqual([
			["deep", true],
			["parent", false],
		]);
	});

	it("requires every query word at a word start (AND, order-free)", () => {
		expect(rank("par qwz").results.map((result) => result.id)).toStrictEqual(["parent", "beta", "base64"]);
	});

	it("keeps a nested a > b result only when its ancestors match the earlier segments in order", () => {
		const ids = (query: string) => rank(query).results.map((result) => result.id);
		expect({
			one: ids("beta > qwzx"),
			two: ids("parent > beta > qwzx"),
			wrongOrder: ids("beta > parent > qwzx"),
			leaf: ids("alpha > qwzx"),
			label: rank("beta > qwzx").results[0]?.labelHtml,
		}).toStrictEqual({
			one: ["deep"],
			two: ["deep"],
			wrongOrder: [],
			leaf: [],
			label: "deep <b><u>qwzx</u></b>child",
		});
	});

	it("answers nothing for a query without words", () => {
		expect(rank("  ..  ")).toStrictEqual({results: [], hasMore: false});
	});

	it("finds accented and word-start matches through the folded prefilter and pages past word-start misses", () => {
		const rows = [
			row("cafe", null, 0, "Café <b>Crème</b>"),
			row("inside", null, 1, "Sucrèmerie"),
			row("tagged", null, 2, "Plain", {note: "crème brûlée #dessert"}),
		];
		const ranked = rankSwitcher(rows, "creme", [], NOW_SEC, {joinedSec: JOINED_SEC, limit: 1});
		expect({ids: ranked.results.map((result) => result.id), hasMore: ranked.hasMore}).toStrictEqual({
			ids: ["cafe"],
			hasMore: true,
		});
		const all = rankSwitcher(rows, "creme", [], NOW_SEC, {joinedSec: JOINED_SEC, limit: 2});
		expect({ids: all.results.map((result) => result.id), hasMore: all.hasMore}).toStrictEqual({
			ids: ["cafe", "tagged"],
			hasMore: false,
		});
	});
});

describe("warmSwitcher", () => {
	it("precomputes each row's stripped and folded text, so the first jump-menu keystroke does no per-row work", () => {
		const rows = [row("warm", null, 0, "<b>Alpha</b> Page", {note: "Beta Note"})];
		expect(peekSwitcherText(rows[0])).toBeUndefined();
		warmSwitcher(rows);
		expect(peekSwitcherText(rows[0])).toStrictEqual({
			plainName: "Alpha Page",
			plainNote: "Beta Note",
			foldedName: "alpha page",
			foldedNote: "beta note",
			fields: ["alpha page", "<b>alpha</b> page", "beta note"],
		});
	});
});
