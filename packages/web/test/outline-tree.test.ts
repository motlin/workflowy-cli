import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import type {NodeResponse} from "../src/node-types.js";
import type {TreeSearchResult} from "../src/server/tree-search.js";
import {nodeKeys} from "../src/client/node-cache.js";
import {searchFilter} from "../src/client/search-filter.js";
import type {SearchFilter} from "../src/client/search-filter.js";
import {cssBlock, cssPreludes} from "./helpers/css-block.js";

const outlineState = {
	activePaneId: "main" as string,
	expandedIds: new Set<string>(),
	panes: [] as {id: string; zoomedId: string | null; query: string; expandedIds: Set<string>}[],
	animatingCompletionIds: new Set<string>(),
	slidingUpCompletionIds: new Set<string>(),
	draggingIds: [] as string[],
	movingIds: [] as string[],
	slidingDownCompletedIds: new Set<string>(),
	endCompletionAnimation: () => {},
	showCompleted: true,
	toggleExpand: () => {},
	resumeEditing: vi.fn<(id: string, caretOffset: number) => void>(),
	editingId: null as string | null,
	itemSelection: {entries: [], pivotId: null, retractableIds: [], counter: 0},
	editingClickPosition: null,
	editingNoteId: null,
	searchQuery: "",
};

function makeNode(overrides: Partial<NodeResponse>): NodeResponse {
	return {
		id: "alice",
		parent_id: null,
		name: "Alice",
		note: null,
		priority: 0,
		data: {layoutMode: null},
		createdAt: null,
		modifiedAt: null,
		completedAt: null,
		...overrides,
	};
}

const childrenByParent = new Map<string | null, NodeResponse[]>([
	[null, [makeNode({hasChildren: true})]],
	["alice", [makeNode({id: "bob", parent_id: "alice", name: "Bob", hasChildren: false})]],
]);

const nodesById = new Map<string, NodeResponse>();
const createMutate = vi.fn<(payload: unknown, options?: {onSuccess?: (node: {id: string}) => void}) => void>();

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (selector?: (state: typeof outlineState) => unknown) =>
		selector ? selector(outlineState) : outlineState,
	outlineActions: () => outlineState,
}));
vi.mock("../src/client/navigation.js", () => ({
	nodeUrl: (nodeId: string) => `/#/${nodeId.slice(-12)}`,
	useNodeNavigation: () => ({navigateToNode: () => {}}),
}));
vi.mock("../src/client/hooks/use-zoom-to.js", () => ({useZoomTo: () => async () => {}}));
vi.mock("../src/client/hooks/use-nodes.js", async () => {
	const {noopMutation} = await import("./helpers/stable-mutation.js");
	return {
		useExpandAll: () => () => {},
		useAncestors: () => ({data: undefined}),
		useBacklinks: () => ({data: undefined}),
		useFoundDates: () => ({data: undefined}),
		useChildren: (parentId: string | null) => ({
			data: childrenByParent.get(parentId) ?? [],
			isLoading: false,
			isPending: false,
			error: null,
		}),
		useNode: (nodeId: string) => ({data: nodesById.get(nodeId)}),
		useCreateNode: () => ({mutate: createMutate}),
		useDeleteNode: () => noopMutation,
		useToggleComplete: () => noopMutation,
	};
});
let currentSearch: SearchFilter | null = null;
vi.mock("../src/client/hooks/use-tree-search.js", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	useSearchFilter: () => currentSearch,
	usePrefetchSearchAncestors: () => {},
}));
vi.mock("../src/client/hooks/use-outline-view.js", () => ({useOutlineViewPending: () => false}));
vi.mock("../src/client/hooks/use-bullet-drag.js", () => ({useBulletDrag: () => () => {}}));
vi.mock("../src/client/components/editable-text.js", async () => {
	const {createElement: h} = await import("react");
	return {
		editableText: ({initialValue, isEditing, nodeId}: {initialValue: string; isEditing: boolean; nodeId: string}) =>
			h(
				"span",
				isEditing
					? {
							className: "innerContentContainer editing",
							"data-node-id": nodeId,
							contentEditable: true,
							suppressContentEditableWarning: true,
						}
					: {className: "innerContentContainer", "data-node-id": nodeId},
				initialValue,
			),
	};
});
vi.mock("../src/client/components/editable-note.js", async () => {
	const {createElement: h} = await import("react");
	return {
		EditableNote: ({nodeId, initialValue, isMain}: {nodeId: string; initialValue: string; isMain?: boolean}) =>
			isMain ? h("div", {className: "notes notes--main", "data-note-of": nodeId}, initialValue) : null,
	};
});
vi.mock("../src/client/components/node-context-menu.js", () => ({ItemMenuTrigger: () => null}));

const {AddChildButton, AddSiblingButton, OutlineTree} = await import("../src/client/components/outline-tree.js");
const {PaneContext} = await import("../src/client/components/pane-context.js");

function render(parentId: string | null = null, client = new QueryClient()): string {
	return renderToStaticMarkup(createElement(QueryClientProvider, {client}, createElement(OutlineTree, {parentId})));
}

interface OpenTag {
	name: string;
	attrs: string;
}

/** Walks React static markup (every element closed or self-closed) with a tag stack and returns the open-tag stack at the first tag whose attrs contain `marker`. */
function stackAt(html: string, marker: string): OpenTag[] {
	const stack: OpenTag[] = [];
	for (const match of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>/gu)) {
		const [, closing, name, attrs, selfClosing] = match;
		if (closing === "/") {
			stack.pop();
			continue;
		}
		const tag = {name, attrs};
		if (attrs.includes(marker)) {
			return [...stack, tag];
		}
		if (selfClosing !== "/") {
			stack.push(tag);
		}
	}
	throw new Error(`marker not found: ${marker}`);
}

function classOf(tag: OpenTag): string {
	return /class="([^"]*)"/u.exec(tag.attrs)?.[1] ?? "";
}

const ROOT_CHILDREN =
	"children relative [.addedToSelection_&amp;]:border-l-transparent [.item--zooming-in-progress_&amp;]:border-l-transparent";
const NESTED_CHILDREN =
	"children relative ml-[10px] pl-[25px] border-l-[length:var(--wf-border-width-s)] border-solid border-l-secondary [.addedToSelection_&amp;]:border-l-transparent [.item--zooming-in-progress_&amp;]:border-l-transparent";

describe("OutlineTree nested .children rendering", () => {
	beforeEach(() => {
		outlineState.expandedIds = new Set();
	});

	it("nests an expanded parent's children inside a bordered .children container", () => {
		outlineState.expandedIds = new Set(["alice"]);
		const stack = stackAt(render(), 'data-item-id="bob"');
		const projectAncestor = stack.reduce<OpenTag | undefined>(
			(found, tag) => (classOf(tag).startsWith("font-custom project") ? tag : found),
			undefined,
		);
		expect(
			stack.map(classOf).filter((cls) => cls.startsWith("children ") || cls.startsWith("font-custom project")),
		).toStrictEqual([
			"font-custom project selected root mainTreeRoot",
			ROOT_CHILDREN,
			"font-custom project open",
			NESTED_CHILDREN,
			"font-custom project task",
		]);
		expect(projectAncestor?.attrs.includes("style=")).toBe(false);
	});

	it("drops the nested .children container when the parent is collapsed", () => {
		const html = render();
		expect(html.includes('class="children relative ml-')).toBe(false);
		expect(html.includes('data-item-id="bob"')).toBe(false);
	});
});

describe("OutlineTree zoom root row", () => {
	beforeEach(() => {
		nodesById.clear();
	});

	it("renders the zoomed node as the root .project with its name in a .name--main row", () => {
		nodesById.set("alice", makeNode({name: "Alice"}));
		const html = render("alice");
		const expected =
			'<div class="font-custom project selected root"><div tabindex="-1" class="name name--main"><div class="notranslate content whitespace-pre-wrap" data-placeholder="Untitled"><span class="innerContentContainer" data-node-id="alice">Alice</span></div><div class="wf-menu nameButtons" style="margin-left:0"></div></div><div class="drop-line"><div class="line"></div></div><div class="children ';
		const start = html.indexOf('<div class="font-custom project selected root">');
		expect(html.slice(start, start + expected.length)).toBe(expected);
	});

	it("renders the zoomed node's title as an editor while it is being edited", () => {
		nodesById.set("alice", makeNode({name: "Alice"}));
		outlineState.editingId = "alice";
		try {
			const html = render("alice");
			const expected =
				'<div class="notranslate content whitespace-pre-wrap" data-placeholder="Untitled"><span class="innerContentContainer editing" data-node-id="alice" contentEditable="true">Alice</span></div>';
			expect(html.includes(expected)).toBe(true);
		} finally {
			outlineState.editingId = null;
		}
	});

	it("mounts the editor in an unnamed zoomed node's title while it is being edited", () => {
		nodesById.set("alice", makeNode({name: ""}));
		outlineState.editingId = "alice";
		try {
			expect(
				render("alice").includes(
					'<div class="notranslate content whitespace-pre-wrap" data-placeholder="Untitled"><span class="innerContentContainer editing" data-node-id="alice" contentEditable="true"></span></div>',
				),
			).toBe(true);
		} finally {
			outlineState.editingId = null;
		}
	});

	it("marks a completed zoomed leaf's root .project as done", () => {
		nodesById.set("alice", makeNode({hasChildren: false, completedAt: 1_760_745_600}));
		expect(render("alice").includes('<div class="font-custom project task done selected root">')).toBe(true);
	});

	it("leaves the content div empty for an unnamed zoomed node so the placeholder shows", () => {
		nodesById.set("alice", makeNode({name: ""}));
		expect(
			render("alice").includes(
				'<div class="notranslate content whitespace-pre-wrap" data-placeholder="Untitled"></div>',
			),
		).toBe(true);
	});

	it("renders the zoom root's note as notes--main after the title, before the children, and marks the root noted", () => {
		nodesById.set("alice", makeNode({name: "Delta", note: "Delta parent note"}));
		const html = render("alice");
		const expected =
			'<div class="font-custom project noted selected root"><div tabindex="-1" class="name name--main"><div class="notranslate content whitespace-pre-wrap" data-placeholder="Untitled"><span class="innerContentContainer" data-node-id="alice">Delta</span></div><div class="wf-menu nameButtons" style="margin-left:0"></div></div><div class="notes notes--main" data-note-of="alice">Delta parent note</div><div class="drop-line"><div class="line"></div></div><div class="children ';
		const start = html.indexOf('<div class="font-custom project noted selected root">');
		expect(html.slice(start, start + expected.length)).toBe(expected);
	});

	it("has no root note when the zoom root has no note and its title is not focused", () => {
		nodesById.set("alice", makeNode({name: "Delta"}));
		expect(render("alice").includes("notes--main")).toBe(false);
	});

	it("mounts an empty root note once the zoom root's title is focused", () => {
		nodesById.set("alice", makeNode({name: "Delta"}));
		outlineState.editingId = "alice";
		try {
			expect(render("alice").includes('<div class="notes notes--main" data-note-of="alice"></div>')).toBe(true);
		} finally {
			outlineState.editingId = null;
		}
	});

	it("gives the zoom root its layout's project class like a row", () => {
		const classes = ["h2", "todo", "code-block", "quote-block", "divider", "p", "h1", "h3"].map((layoutMode) => {
			nodesById.set("alice", makeNode({data: {layoutMode}}));
			return /<div class="(font-custom project[^"]*selected root[^"]*)">/u.exec(render("alice"))?.[1];
		});
		expect(classes).toStrictEqual([
			"font-custom project selected root header2",
			"font-custom project selected root checkmark",
			"font-custom project selected root code-block",
			"font-custom project selected root quote-block",
			"font-custom project selected root divider",
			"font-custom project selected root paragraph",
			"font-custom project selected root header1",
			"font-custom project selected root header3",
		]);
	});

	it("renders a to-do zoom root's checkbox before its title", () => {
		nodesById.set("alice", makeNode({name: "Delta", data: {layoutMode: "todo"}}));
		const html = render("alice");
		const expected =
			'<div tabindex="-1" class="name name--main"><button aria-label="Complete" aria-pressed="false" class="todo-checkbox" type="button">';
		const start = html.indexOf('<div tabindex="-1" class="name name--main">');
		expect(html.slice(start, start + expected.length)).toBe(expected);
	});

	it("renders a completed to-do zoom root's checkbox as checked", () => {
		nodesById.set("alice", makeNode({name: "Delta", completedAt: 1_760_745_600, data: {layoutMode: "todo"}}));
		expect(render("alice").includes('aria-pressed="true" class="todo-checkbox checked"')).toBe(true);
	});

	it("renders no checkbox on a bullets zoom root", () => {
		nodesById.set("alice", makeNode({name: "Delta"}));
		expect(render("alice").includes("todo-checkbox")).toBe(false);
	});

	it("never renders a note on the unzoomed main-tree root", () => {
		expect(render().includes("notes--main")).toBe(false);
	});

	it("marks the unzoomed root as mainTreeRoot with a title-less name--root row", () => {
		const html = render();
		const expected =
			'<div class="font-custom project selected root mainTreeRoot"><div tabindex="-1" class="name name--root"><div class="notranslate content whitespace-pre-wrap" data-placeholder="Untitled"></div>';
		const start = html.indexOf('<div class="font-custom project selected root mainTreeRoot">');
		expect(html.slice(start, start + expected.length)).toBe(expected);
	});
});

const ADD_BUTTON_MARKUP =
	'<div class="mt-m mobile:ml-[-6px] [.item--zooming-in-progress_&amp;]:hidden print:hidden"><div role="button" tabindex="0" aria-label="Add new item" class="addChildButton cursor-pointer desktop:hover:!bg-tertiary iconButton ms shape-circle"><svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="plus" class="svg-inline--fa fa-plus fa-1x " role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="currentColor" d="M240 64c0-8.8-7.2-16-16-16s-16 7.2-16 16l0 176L32 240c-8.8 0-16 7.2-16 16s7.2 16 16 16l176 0 0 176c0 8.8 7.2 16 16 16s16-7.2 16-16l0-176 176 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-176 0 0-176z"></path></svg></div></div>';

describe("OutlineTree active pane editing", () => {
	const editor = 'class="innerContentContainer editing" data-node-id="alice"';

	function renderInPane(paneId: string | null): string {
		const tree = createElement(OutlineTree, {parentId: "alice"});
		return renderToStaticMarkup(
			createElement(
				QueryClientProvider,
				{client: new QueryClient()},
				paneId === null
					? tree
					: createElement(PaneContext.Provider, {value: {id: paneId, zoom: () => {}}}, tree),
			),
		);
	}

	function editingAlice(activePaneId: string, paneId: string | null): boolean {
		nodesById.set("alice", makeNode({name: "Alice"}));
		outlineState.editingId = "alice";
		outlineState.activePaneId = activePaneId;
		try {
			return renderInPane(paneId).includes(editor);
		} finally {
			outlineState.editingId = null;
			outlineState.activePaneId = "main";
		}
	}

	it("edits the node only in the active pane, so a node shown in both panes edits in one", () => {
		expect({
			mainWhileMainActive: editingAlice("main", null),
			mainWhileSideActive: editingAlice("side", null),
			sideWhileSideActive: editingAlice("side", "side"),
			sideWhileMainActive: editingAlice("main", "side"),
		}).toStrictEqual({
			mainWhileMainActive: true,
			mainWhileSideActive: false,
			sideWhileSideActive: true,
			sideWhileMainActive: false,
		});
	});
});

describe("OutlineTree per-pane expansion", () => {
	function bobShownIn(paneId: string | null): boolean {
		const tree = createElement(OutlineTree, {parentId: null});
		return renderToStaticMarkup(
			createElement(
				QueryClientProvider,
				{client: new QueryClient()},
				paneId === null
					? tree
					: createElement(PaneContext.Provider, {value: {id: paneId, zoom: () => {}}}, tree),
			),
		).includes('data-item-id="bob"');
	}

	function shown(mainExpanded: string[], paneExpanded: string[]): {main: boolean; side: boolean} {
		outlineState.expandedIds = new Set(mainExpanded);
		outlineState.panes = [{id: "side", zoomedId: null, query: "", expandedIds: new Set(paneExpanded)}];
		try {
			return {main: bobShownIn(null), side: bobShownIn("side")};
		} finally {
			outlineState.expandedIds = new Set();
			outlineState.panes = [];
		}
	}

	it("expands a row in each pane from that pane's own expansion, like upstream's temporary mirror root", () => {
		expect({
			mainOnly: shown(["alice"], []),
			sideOnly: shown([], ["alice"]),
		}).toStrictEqual({
			mainOnly: {main: true, side: false},
			sideOnly: {main: false, side: true},
		});
	});
});

describe("OutlineTree add-child button", () => {
	beforeEach(() => {
		outlineState.expandedIds = new Set(["alice"]);
		createMutate.mockClear();
		outlineState.resumeEditing.mockClear();
	});

	it("renders upstream's markup once, as the root project's last child after the root .children", () => {
		const html = render();
		const stack = stackAt(html, 'class="mt-m ');
		expect({
			count: html.split("addChildButton").length - 1,
			parent: classOf(stack[stack.length - 2]),
			markup: html.slice(
				html.indexOf('<div class="mt-m '),
				html.indexOf('<div class="mt-m ') + ADD_BUTTON_MARKUP.length,
			),
			endsRoot: html.endsWith(`${ADD_BUTTON_MARKUP}</div></div></div>`),
		}).toStrictEqual({
			count: 1,
			parent: "font-custom project selected root mainTreeRoot",
			markup: ADD_BUTTON_MARKUP,
			endsRoot: true,
		});
	});

	it("leaves the add-child button out during a search", () => {
		outlineState.searchQuery = "apple";
		try {
			expect(render().split("addChildButton").length - 1).toBe(0);
		} finally {
			outlineState.searchQuery = "";
		}
	});

	it("creates an empty bottom child under a client id, edits it at offset 0 at once, and blurs the button", () => {
		const id = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
		vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
		const blur = vi.fn<() => void>();
		const element = AddChildButton({parentId: "alice"});
		const button = (element.props as {children: {props: {onClick: (event: unknown) => void}}}).children;
		button.props.onClick({currentTarget: {blur}});
		expect({
			calls: createMutate.mock.calls,
			resumed: outlineState.resumeEditing.mock.calls,
			blurred: blur.mock.calls.length,
		}).toStrictEqual({
			calls: [[{id, parent_id: "alice", name: "", index: 1}]],
			resumed: [[id, 0]],
			blurred: 1,
		});
	});
});

const ADD_SIBLING_MARKUP =
	'<svg viewBox="0 0 20 20" class="absolute left-[-11px] bottom-[3px] w-[20px] h-[20px] block opacity-0 hover:opacity-70 active:opacity-100 addSiblingButton"><circle cx="10.5" cy="10.5" r="9" fill="var(--wf-background-quaternary)"></circle><line x1="6" y1="10.5" x2="15" y2="10.5" stroke="var(--wf-text-quaternary)" stroke-width="1"></line><line x1="10.5" y1="6" x2="10.5" y2="15" stroke="var(--wf-text-quaternary)" stroke-width="1"></line></svg>';

describe("OutlineTree add-sibling button", () => {
	beforeEach(() => {
		outlineState.expandedIds = new Set(["alice"]);
		createMutate.mockClear();
		outlineState.resumeEditing.mockClear();
	});

	it("ends each nested .children with upstream's svg and leaves the root .children without one", () => {
		const html = render();
		const stack = stackAt(html, "addSiblingButton");
		expect({
			count: html.split("addSiblingButton").length - 1,
			parent: classOf(stack[stack.length - 2]),
			endsNested: html.includes(`${ADD_SIBLING_MARKUP}</div></div></div><div class="mt-m `),
		}).toStrictEqual({count: 1, parent: NESTED_CHILDREN, endsNested: true});
	});

	it("creates an empty sibling right after the owner, edits it at offset 0, and hides the svg until the next mouseenter", () => {
		const id = "1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
		vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
		const owner = childrenByParent.get(null)?.[0];
		if (owner === undefined) {
			throw new Error("missing owner");
		}
		const element = AddSiblingButton({owner});
		const props = element.props as {
			onClick: (event: unknown) => void;
			onMouseEnter: (event: unknown) => void;
		};
		const svg = {style: {opacity: ""}};
		props.onClick({currentTarget: svg});
		const afterClick = svg.style.opacity;
		props.onMouseEnter({currentTarget: svg});
		expect({
			calls: createMutate.mock.calls,
			resumed: outlineState.resumeEditing.mock.calls,
			afterClick,
			afterEnter: svg.style.opacity,
		}).toStrictEqual({
			calls: [[{id, parent_id: undefined, name: "", index: 1}]],
			resumed: [[id, 0]],
			afterClick: "0",
			afterEnter: "",
		});
	});
});

describe("OutlineTree row windowing", () => {
	it("renders the first rows of a long list up to the budget, then a growth sentinel and no add-child button", () => {
		const original = childrenByParent.get(null);
		const rows = Array.from({length: 250}, (_, index) =>
			makeNode({id: `n${index}`, name: `Node ${index}`, hasChildren: false}),
		);
		childrenByParent.set(null, rows);
		const client = new QueryClient();
		client.setQueryData(nodeKeys.children(null), rows);
		try {
			const html = render(null, client);
			// No viewport in tests, so the budget is one 24-row step.
			expect({
				projects: html.split('class="font-custom project task').length - 1,
				sentinels: html.split('<div class="render-sentinel"').length - 1,
				addChild: html.includes("addChildButton"),
			}).toStrictEqual({projects: 24, sentinels: 1, addChild: false});
		} finally {
			childrenByParent.set(null, original ?? []);
		}
	});
});

describe("OutlineTree search windowing", () => {
	it("mounts a viewport of rows, not every match, for a search with thousands of matches", () => {
		const original = childrenByParent.get(null);
		const topLevel = Array.from({length: 3000}, (_, index) =>
			makeNode({id: `t${index}`, name: `Top ${index}`, hasChildren: index === 0}),
		);
		const nested = Array.from({length: 3000}, (_, index) =>
			makeNode({id: `c${index}`, parent_id: "t0", name: `Child ${index}`, hasChildren: false}),
		);
		childrenByParent.set(null, topLevel);
		childrenByParent.set("t0", nested);
		const client = new QueryClient();
		client.setQueryData(nodeKeys.children(null), topLevel);
		client.setQueryData(nodeKeys.children("t0"), nested);
		const matchIds = [...topLevel, ...nested].map((node) => node.id);
		const result: TreeSearchResult = {
			matchIds,
			nameMatchIds: matchIds,
			noteMatchIds: [],
			metaMatchIds: [],
			ancestorIds: ["t0"],
			halfExpandedIds: [],
			rootHalfExpanded: false,
			completedMatchCount: 0,
			matchCount: matchIds.length,
			revealsCompleted: false,
		};
		currentSearch = searchFilter(result, new Set(), new Map());
		try {
			const html = render(null, client);
			// The zoom root plus a 24-row budget (no viewport in tests): t0 and its first 23 children.
			expect({
				projects: html.split('class="font-custom project').length - 1,
				nestedRows: html.split("Child ").length - 1,
				sentinels: html.split('<div class="render-sentinel"').length - 1,
			}).toStrictEqual({projects: 1 + 24, nestedRows: 23, sentinels: 1});
		} finally {
			currentSearch = null;
			childrenByParent.set(null, original ?? []);
			childrenByParent.delete("t0");
		}
	});
});

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8").replaceAll(
	/\/\*[\s\S]*?\*\//gu,
	"",
);

describe("outline tree styles guard", () => {
	it("drops the flat-virtualizer indent rules", () => {
		expect(/\.indent-guide-line|\.outline-tree-virtualizer|\.outline-tree-nested/u.test(styles)).toBe(false);
	});

	it("replaces .zoomed-node-title with upstream's .name--main rules", () => {
		expect({
			legacy: styles.includes(".zoomed-node-title"),
			main: cssBlock(styles, ".name.name--main"),
			rootContent: cssBlock(styles, ".root > .name > .content"),
			placeholder: cssBlock(styles, ".name--main > .content:empty::before"),
		}).toStrictEqual({
			legacy: false,
			main: {
				"font-weight": "700",
				"font-size": "var(--font-selected-name-font-size)",
				"--line-height": "var(--font-selected-name-line-height)",
				"margin-bottom": "10px",
				"margin-left": "-100px",
				"padding-left": "100px",
			},
			rootContent: {"padding-top": "0"},
			placeholder: {
				content: "attr(data-placeholder)",
				color: "var(--wf-text-tertiary)",
				width: "auto",
				"pointer-events": "none",
			},
		});
	});

	it("adds no outline-tree-container indent on top of the row's own 24px bullet space", () => {
		const preludes = cssPreludes(styles.replaceAll(/\/\*[\s\S]*?\*\//gu, "")).map((prelude) => prelude.trim());
		expect(preludes.filter((prelude) => prelude === ".outline-tree-container")).toStrictEqual([]);
	});

	it("puts the descendant content padding on .children like upstream", () => {
		expect(cssBlock(styles, ".children")).toStrictEqual({
			"--wf-content-padding-top": "var(--font-descendant-padding-top)",
			"--space-for-bullet": "24px",
		});
	});
});
