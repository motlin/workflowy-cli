import {describe, expect, it} from "vite-plus/test";
import {computeTreeSearch} from "../src/server/tree-search.js";
import type {TreeSearchRow} from "../src/server/tree-search.js";

const NOW = Date.UTC(2026, 9, 19, 12);

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
		modifiedAt: null,
		completedAt: null,
		layoutMode: null,
		isMirror: false,
		...overrides,
	};
}

// SF root > [Fruit apple (note) > [Green apple pie, Banana split, Cherry tart > deep apple leaf],
// Vegetables > [Carrot zebra, Potato], Done apple item (completed), Plain item #fruitTag]
// Rows are deliberately out of document order to prove the result is ordered by parent then priority.
const ROWS: TreeSearchRow[] = [
	row("plain", "root", 3, "Plain item #fruitTag"),
	row("veg", "root", 1, "Vegetables"),
	row("root", "outside", 0, "SF root"),
	row("deep", "cherry", 0, "deep apple leaf"),
	row("fruit", "root", 0, "Fruit apple", {note: "zebra note here"}),
	row("done", "root", 2, "Done apple item", {completedAt: NOW - 1000}),
	row("cherry", "fruit", 2, "Cherry tart"),
	row("banana", "fruit", 1, "Banana split"),
	row("green", "fruit", 0, "Green apple pie"),
	row("potato", "veg", 1, "Potato"),
	row("carrot", "veg", 0, "Carrot zebra"),
	row("outsider", "outside", 1, "apple outside the zoom"),
];

const EMPTY = {
	matchIds: [],
	nameMatchIds: [],
	noteMatchIds: [],
	metaMatchIds: [],
	ancestorIds: [],
	halfExpandedIds: [],
	rootHalfExpanded: false,
	completedMatchCount: 0,
	matchCount: 0,
	revealsCompleted: false,
};

describe("computeTreeSearch", () => {
	it("apple matches names in document order with ancestors and half-expanded rows", () => {
		expect(computeTreeSearch(ROWS, "root", "apple", NOW)).toStrictEqual({
			matchIds: ["fruit", "green", "deep", "done"],
			nameMatchIds: ["fruit", "green", "deep", "done"],
			noteMatchIds: [],
			metaMatchIds: [],
			ancestorIds: ["fruit", "cherry"],
			halfExpandedIds: ["fruit"],
			rootHalfExpanded: true,
			completedMatchCount: 1,
			matchCount: 4,
			revealsCompleted: false,
		});
	});

	it("zebra matches a note and a name", () => {
		expect(computeTreeSearch(ROWS, "root", "zebra", NOW)).toStrictEqual({
			matchIds: ["fruit", "carrot"],
			nameMatchIds: ["carrot"],
			noteMatchIds: ["fruit"],
			metaMatchIds: [],
			ancestorIds: ["veg"],
			halfExpandedIds: ["veg"],
			rootHalfExpanded: true,
			completedMatchCount: 0,
			matchCount: 2,
			revealsCompleted: false,
		});
	});

	it("never matches the root itself", () => {
		expect(computeTreeSearch(ROWS, "root", "sf", NOW)).toStrictEqual(EMPTY);
	});

	it("requires whole words before the last token", () => {
		expect(computeTreeSearch(ROWS, "root", "app pie", NOW)).toStrictEqual(EMPTY);
	});

	it("does not match HTML markup", () => {
		const rows = [row("root", null, 0, "root"), row("red", "root", 0, '<span class="colored c-red">x</span>')];
		expect(computeTreeSearch(rows, "root", "span", NOW)).toStrictEqual(EMPTY);
	});

	it("has:note is an operator-only meta match", () => {
		expect(computeTreeSearch(ROWS, "root", "has:note", NOW)).toStrictEqual({
			...EMPTY,
			matchIds: ["fruit"],
			metaMatchIds: ["fruit"],
			rootHalfExpanded: true,
			matchCount: 1,
		});
	});

	it("is:complete reveals completed and counts matches under a completed ancestor", () => {
		const rows = [...ROWS, row("done-kid", "done", 0, "kid", {completedAt: NOW - 500})];
		expect(computeTreeSearch(rows, "root", "is:complete", NOW)).toStrictEqual({
			...EMPTY,
			matchIds: ["done", "done-kid"],
			metaMatchIds: ["done", "done-kid"],
			ancestorIds: ["done"],
			rootHalfExpanded: true,
			completedMatchCount: 2,
			matchCount: 2,
			revealsCompleted: true,
		});
	});

	it("-is:complete excludes children of a completed node", () => {
		const rows = [
			row("root", null, 0, "root"),
			row("done", "root", 0, "done", {completedAt: NOW}),
			row("kid", "done", 0, "kid"),
		];
		expect(computeTreeSearch(rows, "root", "-is:complete", NOW).matchIds).toStrictEqual([]);
	});

	it("searches the whole tree when rootId is null", () => {
		expect(computeTreeSearch(ROWS, null, "outside", NOW)).toStrictEqual(EMPTY);
		const topLevel = [row("a", null, 1, "apple top"), row("b", null, 0, "banana"), row("c", "b", 0, "apple child")];
		expect(computeTreeSearch(topLevel, null, "apple", NOW)).toStrictEqual({
			...EMPTY,
			matchIds: ["c", "a"],
			nameMatchIds: ["c", "a"],
			ancestorIds: ["b"],
			matchCount: 2,
		});
	});

	it("returns the empty result for an empty query", () => {
		expect(computeTreeSearch(ROWS, "root", "   ", NOW)).toStrictEqual(EMPTY);
	});
});
