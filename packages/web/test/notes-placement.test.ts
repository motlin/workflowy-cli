import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import type {NodeResponse} from "../src/node-types.js";

const outlineState = {
	toggleExpand: () => {},
	expandAll: () => {},
	collapseDescendants: () => {},
	resumeEditing: () => {},
	stopEditingNote: () => {},
	editingId: null,
	editingClickPosition: null,
	editingNoteId: null as string | null,
};

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (selector?: (state: typeof outlineState) => unknown) =>
		selector ? selector(outlineState) : outlineState,
}));
vi.mock("../src/client/navigation.js", () => ({
	nodeRoute: (nodeId: string) => `/node/${nodeId}`,
	useNodeNavigation: () => ({navigateToNode: () => {}}),
}));
vi.mock("../src/client/hooks/use-nodes.js", () => ({
	useDeleteNode: () => ({mutate: () => {}}),
	useToggleComplete: () => ({mutate: () => {}}),
	useUpdateNode: () => ({mutate: () => {}}),
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
vi.mock("../src/client/components/node-context-menu.js", () => ({NodeContextMenuButton: () => null}));

const {VirtualizedOutlineNode} = await import("../src/client/components/outline-node.js");

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

function render(node: NodeResponse): string {
	return renderToStaticMarkup(
		createElement(
			QueryClientProvider,
			{client: new QueryClient()},
			createElement(VirtualizedOutlineNode, {node, depth: 0, isExpanded: false, hasChildren: false}),
		),
	);
}

function projectClass(html: string): string | undefined {
	return /^<div class="([^"]*)"/u.exec(html)?.[1];
}

describe("note placement", () => {
	it("renders the note as a sibling .notes between .name and .drop-line", () => {
		const html = render(makeNode({note: "Bob"}));
		expect({
			placed: html.includes(
				'</button></div><div class="notes"><div class="notranslate content text-tertiary whitespace-pre-wrap overflow-hidden"><span class="innerContentContainer">Bob</span></div></div><div class="drop-line">',
			),
			projectClass: projectClass(html),
		}).toStrictEqual({placed: true, projectClass: "font-custom project task noted"});
	});

	it("renders no .notes for an empty note", () => {
		const html = render(makeNode({note: ""}));
		expect({hasNotes: html.includes('class="notes"'), projectClass: projectClass(html)}).toStrictEqual({
			hasNotes: false,
			projectClass: "font-custom project task",
		});
	});

	it("marks the row noted while its empty note is being edited", () => {
		outlineState.editingNoteId = "alice";
		try {
			const html = render(makeNode({note: ""}));
			expect({hasNotes: html.includes('<div class="notes">'), projectClass: projectClass(html)}).toStrictEqual({
				hasNotes: true,
				projectClass: "font-custom project task noted",
			});
		} finally {
			outlineState.editingNoteId = null;
		}
	});
});

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");

function normalizeCss(css: string): string {
	return css
		.replaceAll(/\/\*[\s\S]*?\*\//gu, "")
		.replaceAll(/\s*([{}:;,>()])\s*/gu, "$1")
		.replaceAll(/\s+/gu, " ")
		.replaceAll(";}", "}");
}

describe("notes CSS", () => {
	const css = normalizeCss(styles);

	it("drops the local outline-node-note rules", () => {
		expect(styles.includes(".outline-node-note")).toBe(false);
	});

	it("contains upstream's notes rules", () => {
		const rules = [
			".notes{display:none;margin-bottom:10px;padding-top:4px;margin-top:5px}",
			".noted>.notes{display:block}",
			".children .notes{margin-top:0;margin-bottom:2px;padding-top:0}",
			".children .notes:not(.notes--main){margin-left:calc(var(--name-left-overhang) * -1);padding-left:calc(var(--name-left-overhang) + 24px)}",
			".notes>.content{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;font-size:var(--font-default-font-size);line-height:var(--font-default-line-height)}",
			".children .notes>.content{font-size:var(--font-descendant-note-font-size);line-height:17px;max-height:30px}",
		];
		expect(rules.filter((rule) => !css.includes(normalizeCss(rule)))).toStrictEqual([]);
	});
});
