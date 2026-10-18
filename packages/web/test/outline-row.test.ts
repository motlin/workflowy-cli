import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import type {NodeResponse} from "../src/node-types.js";
import type * as Navigation from "../src/client/navigation.js";

const outlineState = {
	expandedIds: new Set<string>(),
	animatingCompletionIds: new Set<string>(),
	slidingUpCompletionIds: new Set<string>(),
	endCompletionAnimation: () => {},
	showCompleted: true,
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

vi.mock("../src/client/navigation.js", async (importOriginal) => ({
	...(await importOriginal<typeof Navigation>()),
	useNodeNavigation: () => ({navigateToNode: () => {}}),
}));
vi.mock("../src/client/hooks/use-zoom-to.js", () => ({useZoomTo: () => async () => {}}));
vi.mock("../src/client/hooks/use-nodes.js", () => ({
	useBacklinks: () => ({data: undefined}),
	useChildren: () => ({data: [], isLoading: false, error: null}),
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
vi.mock("../src/client/components/node-context-menu.js", () => ({ItemMenuTrigger: () => null}));

const {OutlineRow} = await import("../src/client/components/outline-node.js");
const {ExpandArrow} = await import("../src/client/components/expand-arrow.js");

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
	outlineState.expandedIds = isExpanded ? new Set([node.id]) : new Set();
	return renderToStaticMarkup(
		createElement(
			QueryClientProvider,
			{client: new QueryClient()},
			createElement(OutlineRow, {node: {...node, hasChildren}}),
		),
	);
}

function bulletMarkup(html: string): string {
	const start = html.indexOf('<a href="/#/');
	return html.slice(start, html.indexOf("</a>", start) + "</a>".length);
}

const BULLET_STYLE = "left:calc(var(--name-left-overhang) + 1px);width:18px;--bullet-size:18px";
const DOT_SVG =
	'<svg width="100%" height="100%" viewBox="0 0 18 18" fill="currentColor" class="zoomBulletIcon"><circle cx="9" cy="9" r="3.5"></circle></svg>';
const DIAMOND_SVG =
	'<svg width="100%" height="100%" viewBox="0 0 16 16" fill="currentColor" class="mirrorDiamondIcon"><path d="M8 4 L4 8 L8 12 L12 8 Z"></path></svg>';

function expectedBullet(id: string, classes: string, svg: string): string {
	return `<a href="/#/${id.slice(-12)}" data-handbook="bullet.handle" data-item-id="${id}" class="${classes}" style="${BULLET_STYLE}" draggable="true"><span class="bulletHalo">${svg}</span></a>`;
}

describe("OutlineRow bullet markup", () => {
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

	it("links the bullet to the upstream short-id hash URL", () => {
		const id = "4823cefa-5fc0-478c-88ac-35035d443bf1";
		expect(bulletMarkup(render(makeNode({id}), false))).toBe(
			`<a href="/#/35035d443bf1" data-handbook="bullet.handle" data-item-id="${id}" class="bullet" style="${BULLET_STYLE}" draggable="true"><span class="bulletHalo">${DOT_SVG}</span></a>`,
		);
	});
});

const EXPAND_CLASS =
	"expand absolute top-0 w-[20px] h-[var(--line-height)] pt-[var(--wf-content-padding-top)] flex items-center justify-center cursor-pointer print:hidden [body.moving_&amp;]:hidden left-[calc(var(--name-left-overhang)_-_22px)]";
const EXPAND_ATTRS = `data-handbook="expand.toggle" class="${EXPAND_CLASS}" style="color:var(--wf-text-quinary)"`;
const EXPAND_LEAF = `<button type="button" tabindex="-1" aria-hidden="true" ${EXPAND_ATTRS}></button>`;
const EXPAND_SVG =
	'<div><svg width="20" height="20" viewBox="0 0 20 20" class="block transition-transform duration-200 ease-base [.open&gt;_.name_&amp;]:rotate-90 [.open.halfExpanded&gt;_.name_&amp;]:rotate-45"><path d="M13.75 9.56879C14.0833 9.76124 14.0833 10.2424 13.75 10.4348L8.5 13.4659C8.16667 13.6584 7.75 13.4178 7.75 13.0329L7.75 6.97072C7.75 6.58582 8.16667 6.34525 8.5 6.5377L13.75 9.56879Z" stroke="none" fill="currentColor"></path></svg></div>';
const NAME_BUTTONS = '<div class="wf-menu nameButtons" style="margin-left:0"></div>';
const DROP_LINE = '<div class="drop-line"><div class="line"></div></div>';

function expectedRow(projectClass: string, nameClass: string, content: string): string {
	return `<div class="${projectClass}"><div tabindex="-1" class="${nameClass}" role="presentation">${expectedBullet("alice", "bullet", DOT_SVG)}<div class="notranslate content whitespace-pre-wrap">${content}</div>${NAME_BUTTONS}${EXPAND_LEAF}</div>${DROP_LINE}</div>`;
}

describe("OutlineRow name and content markup", () => {
	it("renders a leaf's project, name, content, and empty name buttons in upstream order", () => {
		expect(render(makeNode({}), false)).toBe(
			expectedRow("font-custom project task", "name", '<span class="innerContentContainer">Alice</span>'),
		);
	});

	it("marks an empty-name leaf and omits its text span", () => {
		expect(render(makeNode({name: ""}), false)).toBe(expectedRow("font-custom project task", "name empty", ""));
	});

	it("marks a completed leaf's project as done", () => {
		expect(render(makeNode({completedAt: 1_792_195_200_000}), false)).toBe(
			expectedRow("font-custom project task done", "name", '<span class="innerContentContainer">Alice</span>'),
		);
	});
});

function expandMarkup(html: string): string {
	const start = html.indexOf('<button type="button"');
	return html.slice(start, html.indexOf("</button>", start) + "</button>".length);
}

describe("expand arrow", () => {
	it("renders an expanded parent's arrow with the svg after the name buttons", () => {
		const html = render(makeNode({}), true, true);
		expect({
			markup: expandMarkup(html),
			afterNameButtons: html.indexOf(NAME_BUTTONS) < html.indexOf(EXPAND_ATTRS),
		}).toStrictEqual({
			markup: `<button type="button" aria-expanded="true" aria-label="Collapse" ${EXPAND_ATTRS}>${EXPAND_SVG}</button>`,
			afterNameButtons: true,
		});
	});

	it("renders a collapsed parent's arrow as expandable", () => {
		expect(expandMarkup(render(makeNode({}), true))).toBe(
			`<button type="button" aria-expanded="false" aria-label="Expand" ${EXPAND_ATTRS}>${EXPAND_SVG}</button>`,
		);
	});

	it("toggles a parent on click and ignores clicks on a leaf", () => {
		const toggleExpand = vi.fn<(nodeId: string) => void>();
		const event = {preventDefault: () => {}, stopPropagation: () => {}};
		const click = (hasChildren: boolean) => {
			(
				ExpandArrow({nodeId: "alice", hasChildren, isExpanded: false, onToggle: toggleExpand}).props as {
					onClick: (e: typeof event) => void;
				}
			).onClick(event);
		};
		click(false);
		expect(toggleExpand.mock.calls).toStrictEqual([]);
		click(true);
		expect(toggleExpand.mock.calls).toStrictEqual([["alice"]]);
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

describe("name and content CSS", () => {
	const css = normalizeCss(styles);

	it("drops the local completed-name rule", () => {
		expect(styles.includes(".name.completed")).toBe(false);
	});

	it("contains upstream's name, content, done, and nameButtons rules", () => {
		const rules = [
			".name{position:relative;display:flex;margin-left:calc(-1 * var(--name-left-overhang));padding-left:calc(var(--name-left-overhang) + 24px);font-size:var(--font-default-font-size);--line-height:var(--font-default-line-height)}",
			".name>.content{flex:1 1 auto;padding-right:10px;display:flex;line-height:var(--line-height);padding-top:var(--wf-content-padding-top);padding-bottom:var(--wf-content-padding-bottom);min-height:var(--font-default-line-height)}",
			".content .innerContentContainer{width:-moz-available}",
			".done>.name>.content{text-decoration:line-through}",
			".done .name>.content,.name>.content.done{opacity:37%}",
			".nameButtons{display:flex;position:absolute;left:100%;min-height:28px;flex-direction:row;align-items:center;top:0;gap:var(--wf-space-m);padding:0 var(--wf-space-s)}",
			".nameButtons:empty{display:none}",
		];
		expect(rules.filter((rule) => !css.includes(normalizeCss(rule)))).toStrictEqual([]);
	});
});

describe("expand arrow CSS", () => {
	const css = normalizeCss(styles);

	it("drops the local expand rules and offset tokens", () => {
		expect(
			[".expand:hover", ".expand.expanded", ".expand-svg", ".leaf .expand", "--expand-collapse-left"].filter(
				(text) => styles.includes(text),
			),
		).toStrictEqual([]);
	});

	it("contains upstream's expand rules", () => {
		const rules = [
			".expand{position:absolute;top:0;left:calc(var(--name-left-overhang) - 22px);width:20px;height:var(--line-height);padding:var(--wf-content-padding-top) 0 0;display:flex;align-items:center;justify-content:center;cursor:pointer;border:none;background:none;box-sizing:content-box}",
			".name:not(.name--root):hover>.expand{opacity:1 !important}",
			".name:hover>.expand{color:var(--wf-text-quaternary)!important}",
			".header1:not(.root)>.name>.expand,.header2:not(.root)>.name>.expand,.header3:not(.root)>.name>.expand,.paragraph:not(.root)>.name>.expand{color:var(--wf-text-quinary)}",
			".expand svg{display:block;transition:transform 0.2s ease}",
			".open>.name>.expand svg{transform:rotate(90deg)}",
			".open.halfExpanded>.name>.expand svg{transform:rotate(45deg)}",
			"body.moving .expand{display:none}",
		];
		expect(rules.filter((rule) => !css.includes(normalizeCss(rule)))).toStrictEqual([]);
	});
});
