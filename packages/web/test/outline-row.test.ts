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
	editingId: null,
	editingClickPosition: null,
	editingNoteId: null,
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

vi.mock("../src/client/components/editable-text.js", () => ({EditableText: () => null}));
vi.mock("../src/client/components/editable-note.js", () => ({EditableNote: () => null}));
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

function render(node: NodeResponse, hasChildren: boolean, isExpanded = false): string {
	return renderToStaticMarkup(
		createElement(
			QueryClientProvider,
			{client: new QueryClient()},
			createElement(VirtualizedOutlineNode, {node, depth: 0, isExpanded, hasChildren}),
		),
	);
}

function bulletMarkup(html: string): string {
	const start = html.indexOf('<a href="/node/');
	return html.slice(start, html.indexOf("</a>", start) + "</a>".length);
}

const BULLET_STYLE = "left:calc(var(--name-left-overhang) + 1px);width:18px;--bullet-size:18px";
const DOT_SVG =
	'<svg width="100%" height="100%" viewBox="0 0 18 18" fill="currentColor" class="zoomBulletIcon"><circle cx="9" cy="9" r="3.5"></circle></svg>';
const DIAMOND_SVG =
	'<svg width="100%" height="100%" viewBox="0 0 16 16" fill="currentColor" class="mirrorDiamondIcon"><path d="M8 4 L4 8 L8 12 L12 8 Z"></path></svg>';

function expectedBullet(id: string, classes: string, svg: string): string {
	return `<a href="/node/${id}" data-handbook="bullet.handle" data-item-id="${id}" class="${classes}" style="${BULLET_STYLE}" draggable="true"><span class="bulletHalo">${svg}</span></a>`;
}

describe("VirtualizedOutlineNode bullet markup", () => {
	it("renders a collapsed parent's bullet with the halo shown", () => {
		expect(bulletMarkup(render(makeNode({}), true))).toBe(
			expectedBullet("alice", "bullet bullet--show-halo keep-bullet", DOT_SVG),
		);
	});

	it("renders an expanded parent's bullet without the halo classes", () => {
		expect(bulletMarkup(render(makeNode({}), true, true))).toBe(expectedBullet("alice", "bullet", DOT_SVG));
	});

	it("renders a leaf's bullet without the halo classes", () => {
		expect(bulletMarkup(render(makeNode({}), false))).toBe(expectedBullet("alice", "bullet", DOT_SVG));
	});

	it("renders a mirror leaf's bullet as a diamond", () => {
		expect(bulletMarkup(render(makeNode({id: "bob", name: "Bob", isMirror: true}), false))).toBe(
			expectedBullet("bob", "bullet diamond", DIAMOND_SVG),
		);
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

describe("bullet CSS", () => {
	const css = normalizeCss(styles);

	it("drops the local bullet-svg class and ring tokens", () => {
		expect({
			bulletSvg: styles.includes(".bullet-svg"),
			bulletRing: styles.includes("--wf-bullet-ring"),
		}).toStrictEqual({bulletSvg: false, bulletRing: false});
	});

	it("contains upstream's halo rules", () => {
		const rules = [
			".bullet>.bulletHalo{display:flex;width:var(--bullet-size);height:var(--bullet-size);border-radius:50%}",
			".bullet .zoomBulletIcon{display:block}",
			".collapsed>.name>.bullet>.bulletHalo,.bullet.bullet--show-halo>.bulletHalo{background-color:var(--wf-background-quaternary)}",
			".bullet:hover>.bulletHalo,.dragging>.bullet>.bulletHalo{background-color:color-mix(in srgb,var(--wf-background-quaternary) 85%,black)}",
			".bullet.diamond>.bulletHalo,.bullet.noHalo>.bulletHalo{background-color:transparent}",
		];
		expect(rules.filter((rule) => !css.includes(normalizeCss(rule)))).toStrictEqual([]);
	});
});
