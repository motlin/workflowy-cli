import {describe, expect, it, vi} from "vite-plus/test";
import type {NodeResponse} from "../src/node-types.js";

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}});
vi.stubGlobal("innerWidth", 1272);
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
vi.stubGlobal("addEventListener", () => {});

const {flattenTree} = await import("../src/client/hooks/use-flattened-tree.js");

function node(id: string, completedAt: number | null): NodeResponse {
	return {
		id,
		parent_id: null,
		name: id,
		note: null,
		priority: 0,
		data: {layoutMode: null},
		createdAt: null,
		modifiedAt: null,
		completedAt,
		hasChildren: false,
	};
}

describe("flattenTree", () => {
	it("keeps a completed row while its completion animates and drops other completed rows when hidden", () => {
		expect(
			flattenTree(
				[node("a", null), node("c", 1), node("d", 2)],
				new Set(),
				false,
				0,
				new Map(),
				new Set(["c"]),
			).map((row) => row.node.id),
		).toStrictEqual(["a", "c"]);
	});

	it("keeps every completed row when completed rows are shown", () => {
		expect(
			flattenTree([node("c", 1), node("d", 2)], new Set(), true, 0, new Map(), new Set()).map(
				(row) => row.node.id,
			),
		).toStrictEqual(["c", "d"]);
	});
});
