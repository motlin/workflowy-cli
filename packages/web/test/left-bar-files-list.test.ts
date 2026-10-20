import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type {NodeResponse} from "../src/node-types.js";
import type * as ExpansionsModule from "../src/client/stores/left-bar-expansions.js";

const storeState = {zoomedNodeId: null as string | null, showCompleted: false};
const expansionState = {expansions: {} as Record<string, string[]>, toggle: () => {}};

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (selector?: (state: typeof storeState) => unknown) =>
		selector === undefined ? storeState : selector(storeState),
}));
vi.mock("../src/client/stores/left-bar-expansions.js", async (importActual) => ({
	...(await importActual<typeof ExpansionsModule>()),
	useLeftBarExpansionStore: (selector: (state: typeof expansionState) => unknown) => selector(expansionState),
}));
vi.mock("react-router-dom", () => ({useNavigate: () => () => {}}));

function node(id: string, name: string, overrides: Partial<NodeResponse> = {}): NodeResponse {
	return {
		id,
		parent_id: null,
		name,
		note: null,
		priority: 0,
		data: {layoutMode: null},
		createdAt: null,
		modifiedAt: null,
		completedAt: null,
		hasChildren: true,
		...overrides,
	};
}

const children: Record<string, NodeResponse[]> = {
	root: [
		node("A", '<span class="colored c-blue">A</span>'),
		node("B", "B", {completedAt: 1}),
		node("C", "", {hasChildren: false}),
	],
	A: [node("A1", "A1", {hasChildren: false})],
};

vi.mock("../src/client/hooks/use-nodes.js", () => ({
	useChildren: (id: string | null) => ({data: id === null ? undefined : children[id]}),
}));

const {FilesListRows} = await import("../src/client/components/left-bar-files-list.js");
const {toggleExpansion} = await import("../src/client/stores/left-bar-expansions.js");

const CTX = "leftbar__home__";

function rows(): string[] {
	const html = renderToStaticMarkup(createElement(FilesListRows, {parentId: "root", depth: 0, contextKey: CTX}));
	return html
		.split("<a ")
		.slice(1)
		.map((row) => `<a ${row}`);
}

function label(row: string): string {
	return /<span class="innerContentContainer">(.*?)<\/span><\/span><\/div>/u.exec(row)?.[1] ?? "";
}

function anchorTag(row: string): string {
	return row.slice(0, row.indexOf(">") + 1);
}

function innerTag(row: string): string {
	const at = row.indexOf('<div class="flex grow');
	return row.slice(at, row.indexOf(">", at) + 1);
}

beforeEach(() => {
	storeState.zoomedNodeId = null;
	storeState.showCompleted = false;
	expansionState.expansions = {};
});

describe("FilesListRows", () => {
	it("shows only live non-empty rows with raw name HTML when nothing is expanded", () => {
		const result = rows();
		expect({
			labels: result.map(label),
			anchor: anchorTag(result[0] ?? ""),
			inner: innerTag(result[0] ?? ""),
		}).toStrictEqual({
			labels: ['<span class="colored c-blue">A</span>'],
			anchor: '<a class="flex justify-between items-center pr-m hover:cursor-pointer hover:no-underline left-bar-section-item font-custom " draggable="false" href="/#/A" style="padding-left:12px;color:var(--wf-text-tertiary)">',
			inner: '<div class="flex grow items-center min-w-0 h-[30px] pl-xs text-tertiary" style="font-weight:400">',
		});
	});

	it("renders expanded children flat with deeper padding and highlights the current node", () => {
		expansionState.expansions = {[CTX]: ["A"]};
		storeState.zoomedNodeId = "A1";
		const result = rows();
		expect(
			result.map((row) => ({
				label: label(row),
				anchor: anchorTag(row),
				inner: innerTag(row),
				arrowExpanded: row.includes("arrow expanded"),
			})),
		).toStrictEqual([
			{
				label: '<span class="colored c-blue">A</span>',
				anchor: '<a class="flex justify-between items-center pr-m hover:cursor-pointer hover:no-underline left-bar-section-item font-custom " draggable="false" href="/#/A" style="padding-left:12px;color:var(--wf-text-tertiary)">',
				inner: '<div class="flex grow items-center min-w-0 h-[30px] pl-xs text-tertiary" style="font-weight:400">',
				arrowExpanded: true,
			},
			{
				label: "A1",
				anchor: '<a class="flex justify-between items-center pr-m hover:cursor-pointer hover:no-underline left-bar-section-item font-custom " draggable="false" href="/#/A1" style="padding-left:24px;color:var(--wf-text-secondary)">',
				inner: '<div class="flex grow items-center min-w-0 h-[30px] pl-xs text-tertiary" style="font-weight:600">',
				arrowExpanded: false,
			},
		]);
	});

	it("shows completed rows struck through when show-completed is on", () => {
		storeState.showCompleted = true;
		const result = rows();
		expect({labels: result.map(label), anchor: anchorTag(result[1] ?? "")}).toStrictEqual({
			labels: ['<span class="colored c-blue">A</span>', "B"],
			anchor: '<a class="flex justify-between items-center pr-m hover:cursor-pointer hover:line-through left-bar-section-item font-custom " draggable="false" href="/#/B" style="padding-left:12px;color:var(--wf-text-tertiary);text-decoration:line-through;opacity:0.5">',
		});
	});
});

describe("FilesListRows arrow opacity", () => {
	const originalRoot = children.root;
	afterEach(() => {
		children.root = originalRoot;
	});

	function arrowStyle(row: string): string {
		return (
			/class="flex shrink-0 items-center justify-center opacity-\[var\(--opacity\)\][^"]*"[^>]*style="([^"]*)"/u.exec(
				row,
			)?.[1] ?? ""
		);
	}

	it("dims rows without visible children like upstream's noChildren and brightens the current row", () => {
		children.root = [
			node("P", "P"),
			node("L", "L", {hasChildren: false}),
			node("D", "D", {hasChildren: true, hasUncompletedChildren: false}),
			node("Q", "Q"),
			node("M", "M", {hasChildren: false}),
		];
		storeState.zoomedNodeId = "Q";
		const current = rows().map(arrowStyle);
		storeState.zoomedNodeId = "M";
		const currentLeaf = rows().map(arrowStyle)[4];
		expect({current, currentLeaf}).toStrictEqual({
			current: [
				"--opacity:0.45;--hover-opacity:1",
				"--opacity:0.15;--hover-opacity:0.45",
				"--opacity:0.15;--hover-opacity:0.45",
				"--opacity:0.65;--hover-opacity:1",
				"--opacity:0.15;--hover-opacity:0.45",
			],
			currentLeaf: "--opacity:0.2;--hover-opacity:0.65",
		});
	});

	it("counts completed children once show-completed is on", () => {
		children.root = [node("D", "D", {hasChildren: true, hasUncompletedChildren: false})];
		storeState.showCompleted = true;
		expect(rows().map(arrowStyle)).toStrictEqual(["--opacity:0.45;--hover-opacity:1"]);
	});
});

describe("toggleExpansion", () => {
	it("adds then removes an id within its context only", () => {
		const opened = toggleExpansion({other: ["X"]}, CTX, "A");
		expect({opened, closed: toggleExpansion(opened, CTX, "A")}).toStrictEqual({
			opened: {other: ["X"], [CTX]: ["A"]},
			closed: {other: ["X"], [CTX]: []},
		});
	});
});
