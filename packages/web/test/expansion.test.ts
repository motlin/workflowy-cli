import {describe, expect, it} from "vite-plus/test";
import {
	collapseDeepestOpenLevel,
	createDoublePressDetector,
	expandOrCollapseAll,
	expandShallowestCollapsedLevel,
	pageHasCollapsed,
	subtreeIds,
} from "../src/client/expansion.js";
import type {ExpansionRow, TreeIndex} from "../src/client/expansion.js";

const ROOT = "root";
const CHILDREN: Record<string, string[]> = {
	[ROOT]: ["Alpha", "Beta"],
	Alpha: ["A1", "A2"],
	A1: ["A1a"],
	Beta: ["B1"],
};

function makeIndex(hidden: ReadonlySet<string> = new Set()): TreeIndex {
	const children = (id: string) => CHILDREN[id] ?? [];
	return {
		children,
		isVisible: (id) => !hidden.has(id),
		hasVisibleChildren: (id) => children(id).some((child) => !hidden.has(child)),
	};
}

function rowsFor(expanded: ReadonlySet<string>, index: TreeIndex = makeIndex()): ExpansionRow[] {
	const rows: ExpansionRow[] = [];
	const walk = (parentId: string, depth: number) => {
		for (const id of index.children(parentId)) {
			if (!index.isVisible(id)) {
				continue;
			}
			const hasVisibleChildren = index.hasVisibleChildren(id);
			rows.push({id, depth, hasVisibleChildren});
			if (hasVisibleChildren && expanded.has(id)) {
				walk(id, depth + 1);
			}
		}
	};
	walk(ROOT, 0);
	return rows;
}

describe("collapseDeepestOpenLevel", () => {
	it("collapses the deepest open parents one level per call", () => {
		const first = collapseDeepestOpenLevel(
			new Set(["Alpha", "A1", "Beta"]),
			rowsFor(new Set(["Alpha", "A1", "Beta"])),
		);
		expect(first).toStrictEqual(new Set(["Alpha", "Beta"]));
		const second = collapseDeepestOpenLevel(first, rowsFor(first));
		expect(second).toStrictEqual(new Set());
	});
});

describe("expandShallowestCollapsedLevel", () => {
	it("expands the shallowest collapsed parents one level per call", () => {
		const first = expandShallowestCollapsedLevel(new Set(), rowsFor(new Set()));
		expect(first).toStrictEqual(new Set(["Alpha", "Beta"]));
		const second = expandShallowestCollapsedLevel(first, rowsFor(first));
		expect(second).toStrictEqual(new Set(["A1", "Alpha", "Beta"]));
	});
});

describe("expandOrCollapseAll", () => {
	it("collapses the item and its whole subtree, leaving other ids alone", () => {
		const result = expandOrCollapseAll(new Set(["Alpha", "A1", "Beta"]), makeIndex(), "Alpha", false);
		expect(result).toStrictEqual(new Set(["Beta"]));
	});

	it("expands every parent in the subtree", () => {
		const result = expandOrCollapseAll(new Set(), makeIndex(), "Alpha", true);
		expect(result).toStrictEqual(new Set(["A1", "Alpha"]));
	});

	it("skips hidden items when expanding", () => {
		const index = makeIndex(new Set(["A1"]));
		const result = expandOrCollapseAll(new Set(), index, "Alpha", true);
		expect(result).toStrictEqual(new Set(["Alpha"]));
		expect(subtreeIds(index, "Alpha")).toStrictEqual(["Alpha", "A2"]);
	});
});

describe("pageHasCollapsed", () => {
	it("is true while any rendered parent is collapsed", () => {
		expect(pageHasCollapsed(new Set(["Alpha", "Beta"]), rowsFor(new Set(["Alpha", "Beta"])))).toBe(true);
		const all = new Set(["Alpha", "A1", "Beta"]);
		expect(pageHasCollapsed(all, rowsFor(all))).toBe(false);
	});
});

describe("createDoublePressDetector", () => {
	it("reports a double press within the window with the state at the first press", () => {
		const detector = createDoublePressDetector(250);
		expect(detector.press("x", false, 0)).toStrictEqual({double: false});
		expect(detector.press("x", true, 200)).toStrictEqual({double: true, wasOpenAtFirst: false});
	});

	it("does not report a double press outside the window", () => {
		const detector = createDoublePressDetector(250);
		expect(detector.press("x", false, 0)).toStrictEqual({double: false});
		expect(detector.press("x", true, 300)).toStrictEqual({double: false});
	});

	it("does not pair presses on different ids", () => {
		const detector = createDoublePressDetector(250);
		expect(detector.press("x", false, 0)).toStrictEqual({double: false});
		expect(detector.press("y", false, 100)).toStrictEqual({double: false});
	});
});
