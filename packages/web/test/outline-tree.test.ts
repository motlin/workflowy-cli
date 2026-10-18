import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import type {NodeResponse} from "../src/node-types.js";
import {cssBlock} from "./helpers/css-block.js";

const outlineState = {
	expandedIds: new Set<string>(),
	showCompleted: true,
	toggleExpand: () => {},
	expandAll: () => {},
	collapseDescendants: () => {},
	resumeEditing: () => {},
	editingId: null,
	editingClickPosition: null,
	editingNoteId: null,
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

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (selector?: (state: typeof outlineState) => unknown) =>
		selector ? selector(outlineState) : outlineState,
}));
vi.mock("../src/client/navigation.js", () => ({
	nodeRoute: (nodeId: string) => `/node/${nodeId}`,
	useNodeNavigation: () => ({navigateToNode: () => {}}),
}));
vi.mock("../src/client/hooks/use-nodes.js", () => ({
	useChildren: (parentId: string | null) => ({
		data: childrenByParent.get(parentId) ?? [],
		isLoading: false,
		error: null,
	}),
	useNode: () => ({data: undefined}),
	useCreateNode: () => ({mutate: () => {}}),
	useDeleteNode: () => ({mutate: () => {}}),
	useToggleComplete: () => ({mutate: () => {}}),
}));
vi.mock("../src/client/hooks/use-node-drag-drop.js", () => ({
	useNodeDragDrop: () => ({
		isDragging: false,
		isDragOver: false,
		dragOverPosition: null,
		handleDragStart: () => {},
		handleDragEnd: () => {},
		handleDragOver: () => {},
		handleDragLeave: () => {},
		handleDrop: () => {},
	}),
}));
vi.mock("../src/client/components/editable-text.js", async () => {
	const {createElement: h} = await import("react");
	return {
		EditableText: ({initialValue}: {initialValue: string}) =>
			h("span", {className: "innerContentContainer"}, initialValue),
	};
});
vi.mock("../src/client/components/editable-note.js", () => ({EditableNote: () => null}));
vi.mock("../src/client/components/node-context-menu.js", () => ({NodeContextMenuButton: () => null}));

const {OutlineTree} = await import("../src/client/components/outline-tree.js");

function render(): string {
	return renderToStaticMarkup(
		createElement(QueryClientProvider, {client: new QueryClient()}, createElement(OutlineTree, {parentId: null})),
	);
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
		).toStrictEqual([ROOT_CHILDREN, "font-custom project open", NESTED_CHILDREN, "font-custom project task"]);
		expect(projectAncestor?.attrs.includes("style=")).toBe(false);
	});

	it("drops the nested .children container when the parent is collapsed", () => {
		const html = render();
		expect(html.includes('class="children relative ml-')).toBe(false);
		expect(html.includes('data-item-id="bob"')).toBe(false);
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

	it("puts the descendant content padding on .children like upstream", () => {
		expect(cssBlock(styles, ".children")).toStrictEqual({
			"--wf-content-padding-top": "var(--font-descendant-padding-top)",
			"--space-for-bullet": "24px",
		});
	});
});
